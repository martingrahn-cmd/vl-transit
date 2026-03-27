/**
 * VL Transit API — Cloudflare Worker
 * 
 * Ersätter Express-servern:
 * - Proxar GTFS-RT protobuf → JSON
 * - Serverar statisk GTFS-data från KV
 * - Kombinerar tidtabell + realtid för avgångar
 * - Cachar realtidsdata (5s)
 */
import { decodeFeedMessage } from './gtfs-rt.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// ─── Cached KV reads ────────────────────────────────────

const kvCache = {};
const KV_TTL = 300_000; // 5 min in-memory cache

async function kvGet(kv, key) {
  const cached = kvCache[key];
  if (cached && Date.now() - cached.ts < KV_TTL) return cached.data;

  const data = await kv.get(key, 'json');
  if (data) kvCache[key] = { data, ts: Date.now() };
  return data;
}

// ─── Fetch + decode GTFS-RT ─────────────────────────────

const rtCache = {};
const RT_TTL = 5000; // 5 seconds

async function fetchRT(env, feedName) {
  const cached = rtCache[feedName];
  if (cached && Date.now() - cached.ts < RT_TTL) return cached.data;

  const url = `https://opendata.samtrafiken.se/gtfs-rt/${env.GTFS_OPERATOR}/${feedName}.pb?key=${env.TRAFIKLAB_REALTIME_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Trafiklab ${res.status}`);

  const buffer = await res.arrayBuffer();
  const feed = decodeFeedMessage(buffer);

  rtCache[feedName] = { data: feed, ts: Date.now() };
  return feed;
}

// ─── Route: /api/health ─────────────────────────────────

async function handleHealth(env) {
  return json({
    status: 'ok',
    runtime: 'cloudflare-worker',
    operator: env.GTFS_OPERATOR,
    realtimeKey: !!env.TRAFIKLAB_REALTIME_KEY,
  });
}

// ─── Route: /api/gtfs/summary ───────────────────────────

async function handleSummary(env) {
  const data = await kvGet(env.GTFS_KV, 'meta:summary');
  if (!data) return json({ error: 'GTFS ej uppladdad till KV' }, 404);
  return json(data);
}

// ─── Route: /api/gtfs/shapes ────────────────────────────

async function handleShapes(env, routeId) {
  const shapes = await kvGet(env.GTFS_KV, 'meta:shapes');
  if (!shapes) return json({ error: 'Shapes ej uppladdade till KV' }, 404);

  if (routeId) {
    return json({ [routeId]: shapes[routeId] || [] });
  }
  return json(shapes);
}

// ─── Route: /api/gtfs/stops/search ──────────────────────

async function handleStopSearch(env, query) {
  if (!query || query.length < 2) return json([]);
  const stops = await kvGet(env.GTFS_KV, 'meta:stopsearch');
  if (!stops) return json([]);

  const q = query.toLowerCase();
  const results = stops.filter(s => s.name.toLowerCase().includes(q)).slice(0, 30);
  return json(results);
}

// ─── Route: /api/realtime/vehicles ──────────────────────

async function handleVehicles(env) {
  if (!env.TRAFIKLAB_REALTIME_KEY) return json({ error: 'Saknar RT-nyckel' }, 500);

  const [vehicleFeed, tripFeed] = await Promise.all([
    fetchRT(env, 'VehiclePositions'),
    fetchRT(env, 'TripUpdates'),
  ]);

  const trip2route = await kvGet(env.GTFS_KV, 'lookup:trip2route') || {};
  const routes = await kvGet(env.GTFS_KV, 'lookup:routes') || {};
  const headsigns = await kvGet(env.GTFS_KV, 'lookup:headsigns') || {};

  // vehicleId → { tripId, routeId } from TripUpdates
  const vehicleTrips = {};
  for (const entity of tripFeed.entities) {
    const tu = entity.tripUpdate;
    if (!tu) continue;
    const vehId = tu.vehicle?.id;
    const tripId = tu.trip?.tripId;
    if (vehId && tripId) {
      vehicleTrips[vehId] = {
        tripId,
        routeId: tu.trip?.routeId || trip2route[tripId] || null,
      };
    }
  }

  const vehicles = vehicleFeed.entities
    .filter(e => e.vehiclePosition?.position)
    .map(e => {
      const vp = e.vehiclePosition;
      const pos = vp.position;
      const vehicleId = vp.vehicle?.id || e.id;
      const enriched = vehicleTrips[vehicleId] || {};
      const tripId = vp.trip?.tripId || enriched.tripId || null;
      const routeId = vp.trip?.routeId || enriched.routeId || (tripId ? trip2route[tripId] : null);
      const route = routeId ? routes[routeId] : null;

      return {
        id: e.id,
        vehicleId,
        lat: pos.latitude,
        lon: pos.longitude,
        bearing: pos.bearing || null,
        speed: pos.speed || null,
        tripId,
        routeId,
        routeShort: route?.short || null,
        routeLong: route?.long || null,
        routeColor: route?.color || null,
        headsign: tripId ? headsigns[tripId] : null,
        timestamp: vp.timestamp || null,
      };
    })
    .filter(v => v.lat && v.lon);

  const withRoute = vehicles.filter(v => v.routeId).length;

  return json({
    timestamp: vehicleFeed.timestamp,
    count: vehicles.length,
    withRoute,
    vehicles,
  });
}

// ─── Route: /api/realtime/departures/:stopId ────────────

function timeToSeconds(timeStr) {
  const [h, m, s] = timeStr.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

function swedishNow() {
  const str = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });
  // "2026-03-27 22:52:10"
  const [date, time] = str.split(' ');
  return { date: date.replace(/-/g, ''), time };
}

function todayStr() {
  return swedishNow().date;
}

function nowSeconds() {
  const { time } = swedishNow();
  const [h, m, s] = time.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

async function handleDepartures(env, stopId, params) {
  // Hämta alla lookups parallellt
  const [stops, stopChildren, depEntries, routes, trip2route, headsigns, lastStops, tripServices, calendar] =
    await Promise.all([
      kvGet(env.GTFS_KV, 'lookup:stops'),
      kvGet(env.GTFS_KV, 'lookup:stopchildren'),
      kvGet(env.GTFS_KV, `deps:${stopId}`),
      kvGet(env.GTFS_KV, 'lookup:routes'),
      kvGet(env.GTFS_KV, 'lookup:trip2route'),
      kvGet(env.GTFS_KV, 'lookup:headsigns'),
      kvGet(env.GTFS_KV, 'lookup:laststops'),
      kvGet(env.GTFS_KV, 'lookup:tripservices'),
      kvGet(env.GTFS_KV, `calendar:${todayStr()}`),
    ]);

  if (!stops) return json({ error: 'GTFS ej uppladdad till KV' }, 404);

  // Hitta parent-stopp
  const parentId = stops[stopId]?.parent || stopId;
  const entries = depEntries || (await kvGet(env.GTFS_KV, `deps:${parentId}`)) || [];

  // Aktiva services idag
  const activeServices = new Set(calendar || []);

  // Realtidsdata
  let rtDelays = {};
  if (env.TRAFIKLAB_REALTIME_KEY) {
    try {
      const feed = await fetchRT(env, 'TripUpdates');
      const matchStops = new Set([parentId, ...(stopChildren?.[parentId] || [])]);

      for (const entity of feed.entities) {
        const tu = entity.tripUpdate;
        if (!tu?.stopTimeUpdate) continue;
        for (const stu of tu.stopTimeUpdate) {
          if (!matchStops.has(stu.stopId)) continue;
          rtDelays[tu.trip?.tripId] = {
            delay: stu.departure?.delay || stu.arrival?.delay || 0,
          };
          break;
        }
      }
    } catch (err) {
      console.error('RT fetch:', err.message);
    }
  }

  // Bygg avgångslista
  const nowSec = nowSeconds();
  const hours = Math.min(parseInt(params?.get('hours')) || 1.5, 18);
  const windowEnd = nowSec + hours * 3600;
  const maxResults = hours > 2 ? 200 : 50;
  const deps = [];

  for (const entry of entries) {
    // Kör idag?
    const serviceId = tripServices?.[entry.t];
    if (!activeServices.has(serviceId)) continue;

    // Inte sista stoppet?
    const lastStop = lastStops?.[entry.t];
    if (lastStop) {
      const lastParent = stops[lastStop]?.parent;
      const entryParent = stops[entry.p]?.parent;
      if (entry.p === lastStop ||
          (lastParent && lastParent === entryParent) ||
          (lastParent && entry.p === lastParent) ||
          (entryParent && lastStop === entryParent)) {
        continue;
      }
    }

    const depSec = timeToSeconds(entry.d);
    if (depSec < nowSec - 900 || depSec > windowEnd) continue;

    const routeId = trip2route?.[entry.t];
    const route = routeId ? routes?.[routeId] : null;
    const rt = rtDelays[entry.t];
    const delay = rt?.delay || 0;
    const minsAway = Math.round((depSec + delay - nowSec) / 60);
    if (minsAway < -2) continue;

    deps.push({
      tripId: entry.t,
      routeShort: route?.short || '?',
      routeColor: route?.color || null,
      headsign: headsigns?.[entry.t] || route?.long || route?.short || '—',
      scheduledTime: entry.d,
      delay,
      minsAway,
      platform: stops[entry.p]?.platform || null,
      realtime: !!rt,
    });
  }

  deps.sort((a, b) => a.minsAway - b.minsAway);

  return json({
    stopId,
    stopName: stops[parentId]?.name || stops[stopId]?.name || 'Okänd',
    today: todayStr(),
    activeServices: activeServices.size,
    realtimeTrips: Object.keys(rtDelays).length,
    departures: deps.slice(0, maxResults),
  });
}

// ─── Route: /api/realtime/alerts ────────────────────────

async function handleAlerts(env) {
  if (!env.TRAFIKLAB_REALTIME_KEY) return json({ error: 'Saknar RT-nyckel' }, 500);
  const feed = await fetchRT(env, 'ServiceAlerts');
  return json({
    timestamp: feed.timestamp,
    count: feed.entities.length,
    entities: feed.entities,
  });
}

// ─── Router ─────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/api/health') return await handleHealth(env);
      if (path === '/api/gtfs/summary') return await handleSummary(env);
      if (path === '/api/gtfs/shapes') return await handleShapes(env);
      if (path === '/api/gtfs/stops/search') return await handleStopSearch(env, url.searchParams.get('q'));

      const shapeMatch = path.match(/^\/api\/gtfs\/shapes\/(.+)$/);
      if (shapeMatch) return await handleShapes(env, shapeMatch[1]);
      if (path === '/api/realtime/vehicles') return await handleVehicles(env);
      if (path === '/api/realtime/alerts') return await handleAlerts(env);

      const depMatch = path.match(/^\/api\/realtime\/departures\/(.+)$/);
      if (depMatch) return await handleDepartures(env, depMatch[1], url.searchParams);

      return json({ error: 'Okänd endpoint', endpoints: [
        '/api/health',
        '/api/gtfs/summary',
        '/api/gtfs/shapes',
        '/api/gtfs/shapes/:routeId',
        '/api/gtfs/stops/search?q=...',
        '/api/realtime/vehicles',
        '/api/realtime/departures/:stopId',
        '/api/realtime/alerts',
      ]}, 404);
    } catch (err) {
      console.error('Worker error:', err);
      return json({ error: err.message }, 500);
    }
  },
};
