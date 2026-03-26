/**
 * Express-server som:
 * 1. Serverar parsad GTFS-data som JSON
 * 2. Proxar GTFS-RT (protobuf) realtidsdata
 * 3. Cachar data intelligent
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const app = express();
const PORT = process.env.PORT || 3001;
const OPERATOR = process.env.GTFS_OPERATOR || 'vastmanland';
const RT_KEY = process.env.TRAFIKLAB_REALTIME_KEY;
const DATA_DIR = path.resolve('server/gtfs-data/json');

app.use(cors());
app.use(express.json());

// ─── GTFS Lookups (loaded at startup) ───────────────────

let tripToRoute = {};   // tripId → routeId
let routeLookup = {};   // routeId → { short, long, type, color }
let tripHeadsign = {};  // tripId → headsign
let tripLastStopId = {};// tripId → lastStopId (för att filtrera bort ankomster)
let tripService = {};   // tripId → serviceId
let calendarDates = {}; // date(YYYYMMDD) → Set of serviceIds
let stopDepsIndex = {}; // parentStopId → [{t, d, s, p}]
let stopChildren = {};  // parentStopId → [childStopId, ...]
let stopLookup = {};    // stopId → { name, parent, platform }

function loadGTFSLookups() {
  try {
    const trips = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'trips.json'), 'utf-8'));
    tripToRoute = {};
    tripHeadsign = {};
    trips.forEach(t => {
      tripToRoute[t.trip_id] = t.route_id;
      if (t.trip_headsign) tripHeadsign[t.trip_id] = t.trip_headsign;
    });
    console.log(`  Laddade ${Object.keys(tripToRoute).length} trip→route mappningar`);

    // Ladda förberäknade headsigns (sista stoppet per trip)
    try {
      const hs = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'trip_headsigns.json'), 'utf-8'));
      let added = 0;
      for (const [tid, name] of Object.entries(hs)) {
        if (!tripHeadsign[tid]) { tripHeadsign[tid] = name; added++; }
      }
      console.log(`  Laddade ${added} headsigns från sista-stopp-data`);
    } catch { console.log('  ⚠ trip_headsigns.json saknas — kör npm run download-gtfs'); }

    // Ladda sista stopp per trip (för att filtrera ankomster)
    try {
      tripLastStopId = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'trip_last_stops.json'), 'utf-8'));
      console.log(`  Laddade ${Object.keys(tripLastStopId).length} trip→sista-stopp mappningar`);
    } catch { console.log('  ⚠ trip_last_stops.json saknas — kör npm run download-gtfs'); }
  } catch { console.log('  ⚠ trips.json saknas — kör npm run download-gtfs'); }

  try {
    const routes = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'routes.json'), 'utf-8'));
    routeLookup = {};
    routes.forEach(r => {
      routeLookup[r.route_id] = {
        short: r.route_short_name,
        long: r.route_long_name,
        type: parseInt(r.route_type),
        color: r.route_color ? `#${r.route_color}` : null,
      };
    });
    console.log(`  Laddade ${Object.keys(routeLookup).length} routes`);
  } catch { console.log('  ⚠ routes.json saknas'); }

  try {
    const stops = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'stops.json'), 'utf-8'));
    stopChildren = {};
    stopLookup = {};
    stops.forEach(s => {
      stopLookup[s.stop_id] = {
        name: s.stop_name,
        parent: s.parent_station || null,
        platform: s.platform_code || null,
      };
      if (s.parent_station) {
        if (!stopChildren[s.parent_station]) stopChildren[s.parent_station] = [];
        stopChildren[s.parent_station].push(s.stop_id);
      }
    });
    console.log(`  Laddade ${Object.keys(stopLookup).length} stops, ${Object.keys(stopChildren).length} stop areas`);
  } catch { console.log('  ⚠ stops.json saknas'); }

  // Ladda stopp-avgångsindex
  try {
    stopDepsIndex = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'stop_departures.json'), 'utf-8'));
    console.log(`  Laddade stopp-index: ${Object.keys(stopDepsIndex).length} hållplatser`);
  } catch { console.log('  ⚠ stop_departures.json saknas — kör npm run download-gtfs'); }

  // Ladda trip → service mapping
  try {
    tripService = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'trip_services.json'), 'utf-8'));
    console.log(`  Laddade ${Object.keys(tripService).length} trip→service mappningar`);
  } catch { console.log('  ⚠ trip_services.json saknas'); }

  // Ladda calendar_dates
  try {
    const cdRaw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'calendar_dates.json'), 'utf-8'));
    calendarDates = {};
    for (const cd of cdRaw) {
      if (cd.exception_type === '1') { // Tillagd service
        if (!calendarDates[cd.date]) calendarDates[cd.date] = new Set();
        calendarDates[cd.date].add(cd.service_id);
      }
    }
    console.log(`  Laddade calendar_dates: ${Object.keys(calendarDates).length} dagar`);
  } catch { console.log('  ⚠ calendar_dates.json saknas'); }
}

loadGTFSLookups();

// ─── GTFS Static API ────────────────────────────────────

app.get('/api/gtfs/summary', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'summary.json'), 'utf-8'));
    res.json(data);
  } catch {
    res.status(404).json({ error: 'GTFS-data ej nedladdad. Kör: npm run download-gtfs' });
  }
});

app.get('/api/gtfs/stops', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'stops.json'), 'utf-8'));
    res.json(data);
  } catch {
    res.status(404).json({ error: 'stops.json saknas' });
  }
});

app.get('/api/gtfs/routes', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'routes.json'), 'utf-8'));
    res.json(data);
  } catch {
    res.status(404).json({ error: 'routes.json saknas' });
  }
});

app.get('/api/gtfs/shapes', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'shapes.json'), 'utf-8'));
    res.json(data);
  } catch {
    res.status(404).json({ error: 'shapes.json saknas' });
  }
});

app.get('/api/gtfs/trips', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'trips.json'), 'utf-8'));
    // Filtrera per route_id om angett
    const routeId = req.query.route_id;
    if (routeId) {
      return res.json(data.filter(t => t.route_id === routeId));
    }
    res.json(data);
  } catch {
    res.status(404).json({ error: 'trips.json saknas' });
  }
});

app.get('/api/gtfs/stop_times', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'stop_times.json'), 'utf-8'));
    const tripId = req.query.trip_id;
    if (tripId) {
      return res.json(data.filter(st => st.trip_id === tripId));
    }
    // Om ingen trip_id, returnera bara antalet (hela filen är stor)
    res.json({ count: data.length, hint: 'Använd ?trip_id=xxx för att filtrera' });
  } catch {
    res.status(404).json({ error: 'stop_times.json saknas' });
  }
});

// ─── GTFS Realtime Proxy ────────────────────────────────

// Cache för realtidsdata
const rtCache = {
  vehicles: { data: null, ts: 0 },
  trips: { data: null, ts: 0 },
  alerts: { data: null, ts: 0 },
};
const RT_CACHE_MS = 5000; // 5 sekunder cache

async function fetchRealtimeFeed(feedType) {
  const feedMap = {
    vehicles: 'VehiclePositions',
    trips: 'TripUpdates',
    alerts: 'ServiceAlerts',
  };

  const feedName = feedMap[feedType];
  if (!feedName) throw new Error(`Okänd feed: ${feedType}`);

  // Kolla cache
  const cached = rtCache[feedType];
  if (cached.data && Date.now() - cached.ts < RT_CACHE_MS) {
    return cached.data;
  }

  const url = `https://opendata.samtrafiken.se/gtfs-rt/${OPERATOR}/${feedName}.pb?key=${RT_KEY}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Trafiklab ${res.status}: ${res.statusText}`);
  }

  const buffer = await res.arrayBuffer();
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(buffer)
  );

  // Konvertera till JSON
  const json = GtfsRealtimeBindings.transit_realtime.FeedMessage.toObject(feed, {
    longs: Number,
    enums: String,
    defaults: true,
  });

  // Cacha
  rtCache[feedType] = { data: json, ts: Date.now() };
  return json;
}

app.get('/api/realtime/vehicles', async (req, res) => {
  if (!RT_KEY) {
    return res.status(500).json({ error: 'TRAFIKLAB_REALTIME_KEY saknas i .env' });
  }
  try {
    // Hämta BÅDA feeds parallellt
    const [vehicleFeed, tripFeed] = await Promise.all([
      fetchRealtimeFeed('vehicles'),
      fetchRealtimeFeed('trips'),
    ]);

    // Steg 1: Bygg vehicleId → { tripId, routeId } från TripUpdates
    const vehicleTrips = {};
    for (const entity of (tripFeed.entity || [])) {
      const tu = entity.tripUpdate;
      if (!tu) continue;
      const vehId = tu.vehicle?.id;
      const tripId = tu.trip?.tripId;
      if (vehId && tripId) {
        // Slå upp routeId via GTFS trips.json
        const routeId = tu.trip?.routeId || tripToRoute[tripId] || null;
        vehicleTrips[vehId] = { tripId, routeId };
      }
    }

    // Steg 2: Berika varje fordon med trip/route-info
    const vehicles = (vehicleFeed.entity || []).map(e => {
      const v = e.vehicle || {};
      const pos = v.position || {};
      const trip = v.trip || {};
      const vehicleId = v.vehicle?.id || e.id;

      // Försök matcha: direkt från feed → via TripUpdates → null
      const enriched = vehicleTrips[vehicleId] || {};
      const tripId = trip.tripId || enriched.tripId || null;
      const routeId = trip.routeId || enriched.routeId || (tripId ? tripToRoute[tripId] : null) || null;
      const route = routeId ? routeLookup[routeId] : null;

      return {
        id: e.id,
        vehicleId,
        label: v.vehicle?.label || null,
        lat: pos.latitude,
        lon: pos.longitude,
        bearing: pos.bearing || null,
        speed: pos.speed || null,
        tripId,
        routeId,
        routeShort: route?.short || null,
        routeLong: route?.long || null,
        routeColor: route?.color || null,
        directionId: trip.directionId ?? null,
        timestamp: v.timestamp || null,
      };
    }).filter(v => v.lat && v.lon);

    const withRoute = vehicles.filter(v => v.routeId);

    res.json({
      timestamp: vehicleFeed.header?.timestamp || null,
      count: vehicles.length,
      withRoute: withRoute.length,
      vehicles,
    });
  } catch (err) {
    console.error('RT vehicles error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/realtime/trips', async (req, res) => {
  if (!RT_KEY) {
    return res.status(500).json({ error: 'TRAFIKLAB_REALTIME_KEY saknas i .env' });
  }
  try {
    const feed = await fetchRealtimeFeed('trips');
    res.json({
      timestamp: feed.header?.timestamp || null,
      count: (feed.entity || []).length,
      entities: feed.entity || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/realtime/alerts', async (req, res) => {
  if (!RT_KEY) {
    return res.status(500).json({ error: 'TRAFIKLAB_REALTIME_KEY saknas i .env' });
  }
  try {
    const feed = await fetchRealtimeFeed('alerts');
    res.json({
      timestamp: feed.header?.timestamp || null,
      count: (feed.entity || []).length,
      entities: feed.entity || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Departures API (static timetable + realtime overlay) ──────

// Hjälpfunktion: parsa "HH:MM:SS" till sekunder sedan midnatt
function timeToSeconds(timeStr) {
  const [h, m, s] = timeStr.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

// Hjälpfunktion: dagens datum som YYYYMMDD
function todayStr() {
  const d = new Date();
  return d.getFullYear().toString() +
    (d.getMonth() + 1).toString().padStart(2, '0') +
    d.getDate().toString().padStart(2, '0');
}

app.get('/api/realtime/departures/:stopId', async (req, res) => {
  try {
    const stopId = req.params.stopId;
    const now = new Date();
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const today = todayStr();

    // Aktiva service_ids idag
    const activeServices = calendarDates[today] || new Set();

    // Hitta parent-stopp
    const parentId = stopLookup[stopId]?.parent || stopId;

    // Hämta alla statiska avgångar för denna hållplats
    const staticDeps = stopDepsIndex[parentId] || [];

    // Hämta realtidsdata om tillgänglig
    let rtDelays = {};  // tripId → { delay, time }
    if (RT_KEY) {
      try {
        const feed = await fetchRealtimeFeed('trips');
        // Bygg set av matchande stopp-IDs
        const matchStops = new Set();
        matchStops.add(parentId);
        (stopChildren[parentId] || []).forEach(c => matchStops.add(c));

        for (const entity of (feed.entity || [])) {
          const tu = entity.tripUpdate;
          if (!tu?.stopTimeUpdate) continue;
          const tripId = tu.trip?.tripId;

          for (const stu of tu.stopTimeUpdate) {
            if (!matchStops.has(stu.stopId)) continue;
            const delay = stu.departure?.delay || stu.arrival?.delay || 0;
            rtDelays[tripId] = { delay, time: stu.departure?.time || stu.arrival?.time };
            break;
          }
        }
      } catch (err) {
        console.warn('RT fetch for departures:', err.message);
      }
    }

    // Filtrera och bygg avgångslista
    const deps = [];
    const windowStart = nowSec - 120;  // 2 min sedan
    const windowEnd = nowSec + 5400;   // 90 min framåt

    for (const entry of staticDeps) {
      // Kolla att turen kör idag
      const serviceId = tripService[entry.t];
      if (!activeServices.has(serviceId)) continue;

      // Kolla att det inte är sista stoppet (ankomst)
      const lastStop = tripLastStopId[entry.t];
      if (lastStop) {
        const lastParent = stopLookup[lastStop]?.parent;
        const entryParent = stopLookup[entry.p]?.parent;
        if (entry.p === lastStop ||
            (lastParent && lastParent === entryParent) ||
            (lastParent && entry.p === lastParent) ||
            (entryParent && lastStop === entryParent)) {
          continue;
        }
      }

      const depSec = timeToSeconds(entry.d);
      if (depSec < windowStart || depSec > windowEnd) continue;

      const routeId = tripToRoute[entry.t];
      const route = routeId ? routeLookup[routeId] : null;
      const headsign = tripHeadsign[entry.t] || route?.long || route?.short || '—';

      // Realtidsförseningsoverlay
      const rt = rtDelays[entry.t];
      const delay = rt?.delay || 0;
      const minsAway = Math.round((depSec + delay - nowSec) / 60);

      if (minsAway < -2) continue;

      deps.push({
        tripId: entry.t,
        routeShort: route?.short || '?',
        routeLong: route?.long || '',
        routeColor: route?.color || null,
        headsign,
        scheduledTime: entry.d,  // "17:44:00"
        delay,
        minsAway,
        platform: stopLookup[entry.p]?.platform || null,
        realtime: !!rt,
      });
    }

    deps.sort((a, b) => a.minsAway - b.minsAway);

    res.json({
      stopId,
      stopName: stopLookup[parentId]?.name || stopLookup[stopId]?.name || 'Okänd',
      today,
      activeServices: activeServices.size,
      realtimeTrips: Object.keys(rtDelays).length,
      departures: deps.slice(0, 50),
    });
  } catch (err) {
    console.error('Departures error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Stop search ────────────────────────────────────────

app.get('/api/gtfs/stops/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  if (q.length < 2) return res.json([]);

  try {
    const stops = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'stops.json'), 'utf-8'));
    // Returnera bara stop areas (location_type=1) eller standalone stops
    const results = stops
      .filter(s =>
        (s.location_type === '1' || (!s.parent_station && s.location_type !== '2')) &&
        s.stop_name.toLowerCase().includes(q) &&
        s.stop_lat && s.stop_lon
      )
      .slice(0, 30)
      .map(s => ({
        id: s.stop_id,
        name: s.stop_name,
        lat: parseFloat(s.stop_lat),
        lon: parseFloat(s.stop_lon),
      }));
    res.json(results);
  } catch {
    res.json([]);
  }
});

// ─── Health check ───────────────────────────────────────

app.get('/api/health', (req, res) => {
  const hasGTFS = fs.existsSync(path.join(DATA_DIR, 'summary.json'));
  res.json({
    status: 'ok',
    operator: OPERATOR,
    gtfsData: hasGTFS,
    realtimeKey: !!RT_KEY,
  });
});

// ─── Start ──────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚌 VL Transit Server`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Operator: ${OPERATOR}`);
  console.log(`   GTFS-data: ${fs.existsSync(path.join(DATA_DIR, 'summary.json')) ? '✅' : '❌ Kör npm run download-gtfs'}`);
  console.log(`   Realtime: ${RT_KEY ? '✅' : '❌ Saknar TRAFIKLAB_REALTIME_KEY'}\n`);
});
