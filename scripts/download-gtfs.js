/**
 * Laddar ner och parsar GTFS Static-data från Trafiklab
 * Kör: node scripts/download-gtfs.js
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream, createReadStream } from 'fs';
import { parse } from 'csv-parse';

const OPERATOR = process.env.GTFS_OPERATOR || 'vastmanland';
const API_KEY = process.env.TRAFIKLAB_STATIC_KEY;
const DATA_DIR = path.resolve('server/gtfs-data');
const ZIP_PATH = path.join(DATA_DIR, `${OPERATOR}.zip`);

if (!API_KEY) {
  console.error('❌ Saknar TRAFIKLAB_STATIC_KEY i .env');
  process.exit(1);
}

async function downloadGTFS() {
  const url = `https://opendata.samtrafiken.se/gtfs/${OPERATOR}/${OPERATOR}.zip?key=${API_KEY}`;
  console.log(`📦 Laddar ner GTFS-data för ${OPERATOR}...`);

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const fileStream = createWriteStream(ZIP_PATH);
  await pipeline(res.body, fileStream);
  console.log(`✅ Sparad: ${ZIP_PATH} (${(fs.statSync(ZIP_PATH).size / 1024 / 1024).toFixed(1)} MB)`);
}

async function extractAndParse() {
  console.log('📂 Extraherar zip...');
  const { Open } = await import('unzipper');
  const dir = await Open.file(ZIP_PATH);

  const jsonDir = path.join(DATA_DIR, 'json');
  fs.mkdirSync(jsonDir, { recursive: true });

  // Filer vi behöver
  const needed = ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'shapes.txt', 'calendar_dates.txt', 'agency.txt'];

  for (const entry of dir.files) {
    const name = path.basename(entry.path);
    if (!needed.includes(name)) continue;

    console.log(`  Parsar ${name}...`);
    const records = [];

    await new Promise((resolve, reject) => {
      entry.stream()
        .pipe(parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
          bom: true,
        }))
        .on('data', (row) => records.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    const jsonFile = path.join(jsonDir, name.replace('.txt', '.json'));
    fs.writeFileSync(jsonFile, JSON.stringify(records));
    console.log(`  ✅ ${name} → ${records.length} rader`);
  }

  // Bygg sammanfattning
  buildSummary(jsonDir);
}

function buildSummary(jsonDir) {
  console.log('\n📊 Bygger sammanfattning...');

  const routes = JSON.parse(fs.readFileSync(path.join(jsonDir, 'routes.json'), 'utf-8'));
  const stops = JSON.parse(fs.readFileSync(path.join(jsonDir, 'stops.json'), 'utf-8'));
  const trips = JSON.parse(fs.readFileSync(path.join(jsonDir, 'trips.json'), 'utf-8'));

  // Filtrera stopp (bara parent stops / stop_areas för kartvyn)
  const parentStops = stops.filter(s =>
    s.location_type === '1' || // stop area
    (!s.parent_station && s.location_type !== '2') // standalone stop
  );

  // Skapa optimerad ruttsammanfattning
  const routeSummary = routes.map(r => ({
    id: r.route_id,
    short: r.route_short_name,
    long: r.route_long_name,
    type: parseInt(r.route_type),
    color: r.route_color ? `#${r.route_color}` : null,
    textColor: r.route_text_color ? `#${r.route_text_color}` : null,
  }));

  // Skapa optimerad stoppsammanfattning (bara med koordinater)
  const stopSummary = parentStops
    .filter(s => s.stop_lat && s.stop_lon)
    .map(s => ({
      id: s.stop_id,
      name: s.stop_name,
      lat: parseFloat(s.stop_lat),
      lon: parseFloat(s.stop_lon),
      type: parseInt(s.location_type) || 0,
      parent: s.parent_station || null,
    }));

  // Räkna trips per route
  const tripsPerRoute = {};
  trips.forEach(t => {
    tripsPerRoute[t.route_id] = (tripsPerRoute[t.route_id] || 0) + 1;
  });

  // Bygg headsigns (sista stoppet per trip) — viktig för riktning
  console.log('  Beräknar headsigns från stop_times (sista stoppet per tur)...');
  const stopTimes = JSON.parse(fs.readFileSync(path.join(jsonDir, 'stop_times.json'), 'utf-8'));
  const stopNameMap = {};
  stops.forEach(s => {
    // Använd parent-stoppets namn om det finns (renare — "Norra Gryta" istf "Norra Gryta B")
    if (!s.parent_station) {
      stopNameMap[s.stop_id] = s.stop_name;
    } else {
      const parent = stops.find(p => p.stop_id === s.parent_station);
      stopNameMap[s.stop_id] = parent ? parent.stop_name : s.stop_name;
    }
  });

  // Hitta sista stoppet per trip
  const tripLastStop = {};  // tripId → { seq, stopId }
  for (const st of stopTimes) {
    const seq = parseInt(st.stop_sequence);
    const existing = tripLastStop[st.trip_id];
    if (!existing || seq > existing.seq) {
      tripLastStop[st.trip_id] = { seq, stopId: st.stop_id };
    }
  }

  const tripHeadsigns = {};
  for (const [tripId, info] of Object.entries(tripLastStop)) {
    tripHeadsigns[tripId] = stopNameMap[info.stopId] || 'Okänd';
  }

  const headsignPath = path.join(jsonDir, 'trip_headsigns.json');
  fs.writeFileSync(headsignPath, JSON.stringify(tripHeadsigns));
  console.log(`  ✅ Headsigns: ${Object.keys(tripHeadsigns).length} turer med riktning`);

  // Spara sista stopp-ID per trip (för att filtrera bort ankomster)
  const tripLastStopIds = {};
  for (const [tripId, info] of Object.entries(tripLastStop)) {
    tripLastStopIds[tripId] = info.stopId;
  }
  const lastStopPath = path.join(jsonDir, 'trip_last_stops.json');
  fs.writeFileSync(lastStopPath, JSON.stringify(tripLastStopIds));
  console.log(`  ✅ Sista stopp: ${Object.keys(tripLastStopIds).length} turer`);

  // Bygg stopp-avgångsindex: parentStopId → [{tripId, time, seq}]
  console.log('  Bygger stopp-avgångsindex...');
  const stopDepartures = {};  // parentStopId → entries

  // Mappa child stop → parent stop
  const childToParent = {};
  stops.forEach(s => {
    if (s.parent_station) childToParent[s.stop_id] = s.parent_station;
  });

  for (const st of stopTimes) {
    if (!st.departure_time) continue;
    // Hitta parent-stopp
    const parentId = childToParent[st.stop_id] || st.stop_id;
    if (!stopDepartures[parentId]) stopDepartures[parentId] = [];
    stopDepartures[parentId].push({
      t: st.trip_id,
      d: st.departure_time,     // "17:44:00"
      s: parseInt(st.stop_sequence),
      p: st.stop_id,            // faktiskt stopp-ID (för platform)
    });
  }

  // Sortera per avgångstid
  for (const entries of Object.values(stopDepartures)) {
    entries.sort((a, b) => a.d.localeCompare(b.d));
  }

  const stopDepsPath = path.join(jsonDir, 'stop_departures.json');
  fs.writeFileSync(stopDepsPath, JSON.stringify(stopDepartures));
  console.log(`  ✅ Stopp-index: ${Object.keys(stopDepartures).length} hållplatser med avgångar`);

  // Bygg trip → service_id mapping
  console.log('  Bygger trip→service mappning...');
  const tripService = {};
  trips.forEach(t => { tripService[t.trip_id] = t.service_id; });
  const tripServicePath = path.join(jsonDir, 'trip_services.json');
  fs.writeFileSync(tripServicePath, JSON.stringify(tripService));
  console.log(`  ✅ Trip→service: ${Object.keys(tripService).length} turer`);

  const summary = {
    operator: process.env.GTFS_OPERATOR,
    generated: new Date().toISOString(),
    stats: {
      routes: routes.length,
      stops: stops.length,
      parentStops: parentStops.length,
      trips: trips.length,
    },
    routes: routeSummary,
    stops: stopSummary,
    tripsPerRoute,
  };

  const summaryPath = path.join(jsonDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`✅ Sammanfattning sparad: ${summaryPath}`);
  console.log(`   ${routes.length} linjer, ${stopSummary.length} hållplatser (med koordinater), ${trips.length} turer`);
}

async function main() {
  try {
    // Kolla om data redan finns (< 24h gammal)
    if (fs.existsSync(ZIP_PATH)) {
      const age = Date.now() - fs.statSync(ZIP_PATH).mtimeMs;
      const hours = age / 1000 / 60 / 60;
      if (hours < 24) {
        console.log(`⏭️  GTFS-data är ${hours.toFixed(1)}h gammal, skippar nedladdning (< 24h)`);
        console.log('   Kör med --force för att tvinga ny nedladdning');
        if (!process.argv.includes('--force')) {
          await extractAndParse();
          return;
        }
      }
    }

    await downloadGTFS();
    await extractAndParse();
    console.log('\n🎉 Klar! Starta appen med: npm run dev');
  } catch (err) {
    console.error('❌ Fel:', err.message);
    process.exit(1);
  }
}

main();
