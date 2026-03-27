/**
 * Laddar upp förprocessad GTFS-data till Cloudflare KV
 * Kör: node scripts/upload-kv.js
 * 
 * Förutsätter att du kört npm run download-gtfs först
 * och att wrangler är inloggad (wrangler login)
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const DATA_DIR = path.resolve('server/gtfs-data/json');
const WORKER_DIR = path.resolve('worker');
const KV_NAMESPACE = 'GTFS_KV';

function readJSON(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
}

// Wrangler KV put (bulk via JSON file)
function kvPutBulk(pairs) {
  const tmpFile = path.join(WORKER_DIR, '.kv-bulk.json');
  fs.writeFileSync(tmpFile, JSON.stringify(pairs));
  try {
    execSync(`cd ${WORKER_DIR} && npx wrangler kv bulk put .kv-bulk.json --remote --binding=${KV_NAMESPACE}`, {
      stdio: 'inherit',
    });
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

async function main() {
  console.log('📤 Laddar upp GTFS-data till Cloudflare KV...\n');

  // Kolla att data finns
  if (!fs.existsSync(path.join(DATA_DIR, 'summary.json'))) {
    console.error('❌ GTFS-data saknas. Kör: npm run download-gtfs');
    process.exit(1);
  }

  const pairs = [];

  // 1. Summary
  console.log('  meta:summary');
  pairs.push({ key: 'meta:summary', value: fs.readFileSync(path.join(DATA_DIR, 'summary.json'), 'utf-8') });

  // 2. Routes lookup
  console.log('  lookup:routes');
  const routes = readJSON('routes.json');
  const routeLookup = {};
  routes.forEach(r => {
    routeLookup[r.route_id] = {
      short: r.route_short_name,
      long: r.route_long_name,
      type: parseInt(r.route_type),
      color: r.route_color ? `#${r.route_color}` : null,
    };
  });
  pairs.push({ key: 'lookup:routes', value: JSON.stringify(routeLookup) });

  // 3. Trip → Route
  console.log('  lookup:trip2route');
  const trips = readJSON('trips.json');
  const trip2route = {};
  trips.forEach(t => { trip2route[t.trip_id] = t.route_id; });
  pairs.push({ key: 'lookup:trip2route', value: JSON.stringify(trip2route) });

  // 4. Headsigns
  console.log('  lookup:headsigns');
  const headsigns = readJSON('trip_headsigns.json');
  pairs.push({ key: 'lookup:headsigns', value: JSON.stringify(headsigns) });

  // 5. Last stops
  console.log('  lookup:laststops');
  const lastStops = readJSON('trip_last_stops.json');
  pairs.push({ key: 'lookup:laststops', value: JSON.stringify(lastStops) });

  // 6. Trip services
  console.log('  lookup:tripservices');
  const tripServices = readJSON('trip_services.json');
  pairs.push({ key: 'lookup:tripservices', value: JSON.stringify(tripServices) });

  // 7. Stops lookup
  console.log('  lookup:stops');
  const stops = readJSON('stops.json');
  const stopLookup = {};
  const stopChildren = {};
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
  pairs.push({ key: 'lookup:stops', value: JSON.stringify(stopLookup) });

  // 8. Stop children
  console.log('  lookup:stopchildren');
  pairs.push({ key: 'lookup:stopchildren', value: JSON.stringify(stopChildren) });

  // 9. Stop search data
  console.log('  meta:stopsearch');
  const searchStops = stops
    .filter(s =>
      (s.location_type === '1' || (!s.parent_station && s.location_type !== '2')) &&
      s.stop_lat && s.stop_lon
    )
    .map(s => ({
      id: s.stop_id,
      name: s.stop_name,
      lat: parseFloat(s.stop_lat),
      lon: parseFloat(s.stop_lon),
    }));
  pairs.push({ key: 'meta:stopsearch', value: JSON.stringify(searchStops) });

  // 10. Shapes by route
  console.log('  meta:shapes');
  try {
    const shapesData = fs.readFileSync(path.join(DATA_DIR, 'shapes_by_route.json'), 'utf-8');
    pairs.push({ key: 'meta:shapes', value: shapesData });
  } catch {
    console.log('  ⚠ shapes_by_route.json saknas — kör npm run download-gtfs');
  }

  // Upload bulk (lookups)
  console.log(`\n  Laddar upp ${pairs.length} lookup-nycklar...`);
  kvPutBulk(pairs);

  // 10. Calendar dates (per dag)
  console.log('\n  Calendar dates...');
  const calDates = readJSON('calendar_dates.json');
  const dateMap = {};
  for (const cd of calDates) {
    if (cd.exception_type === '1') {
      if (!dateMap[cd.date]) dateMap[cd.date] = [];
      dateMap[cd.date].push(cd.service_id);
    }
  }
  const calPairs = Object.entries(dateMap).map(([date, services]) => ({
    key: `calendar:${date}`,
    value: JSON.stringify(services),
  }));
  console.log(`  ${calPairs.length} dagar`);
  if (calPairs.length > 0) kvPutBulk(calPairs);

  // 11. Stop departures (per hållplats — kan vara många)
  console.log('\n  Stop departures (per hållplats)...');
  const stopDeps = readJSON('stop_departures.json');
  const depKeys = Object.keys(stopDeps);
  console.log(`  ${depKeys.length} hållplatser att ladda upp`);

  // Chunka i batchar om max 10000 (KV bulk limit)
  const CHUNK_SIZE = 9000;
  const depPairs = depKeys.map(stopId => ({
    key: `deps:${stopId}`,
    value: JSON.stringify(stopDeps[stopId]),
  }));

  for (let i = 0; i < depPairs.length; i += CHUNK_SIZE) {
    const chunk = depPairs.slice(i, i + CHUNK_SIZE);
    console.log(`  Batch ${Math.floor(i / CHUNK_SIZE) + 1}: ${chunk.length} nycklar...`);
    kvPutBulk(chunk);
  }

  console.log('\n🎉 Klar! GTFS-data uppladdad till Cloudflare KV.');
  console.log('   Deploya workern: cd worker && npx wrangler deploy');
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
