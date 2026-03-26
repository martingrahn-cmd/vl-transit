# VL Realtid — TODO

Förbättringar för Västmanland Länstrafik realtidsvisualisering.
Live: https://martingrahn-cmd.github.io/vl-transit/
API: https://vl-transit-api.martingrahn.workers.dev/

## Arkitektur

- **Frontend:** React + Vite → GitHub Pages (auto-deploy via Actions)
- **API:** Cloudflare Worker → proxar GTFS-RT protobuf, serverar KV-data
- **Data:** GTFS Regional (Trafiklab) → förprocessad JSON i Cloudflare KV
- **Repo:** https://github.com/martingrahn-cmd/vl-transit

## Karta

- [ ] **1. Ruttlinjer på kartan** — Rendera shapes.txt som polylines per linje (färgkodade). Ladda upp shapes till KV grupperat per route_id. Visa/dölj per linje. Prioritet: HÖG
- [ ] **2. Klicka buss → visa dess rutt** — Vid klick på ett fordon, highlighta hela rutten (shape) + markera nästa hållplats. Kräver trip→shape_id-mapping i KV.
- [ ] **3. Dark mode-karta** — Byt till mörk kartlayer (t.ex. CartoDB dark_all eller Stadia Dark) som matchar avgångstavlans mörka tema. Lägg till layer-väljare.
- [ ] **4. Buss-ikoner med riktningspil** — Rotera bus-markern baserat på `bearing` så man ser åt vilket håll bussen kör. CSS transform rotate.
- [ ] **5. Klustrade hållplatser** — Vid utzoomning klustras de 1000+ hållplatserna till prickar med antal. Använd react-leaflet-cluster eller Leaflet.markercluster.
- [ ] **6. Klicka hållplats → visa avgångar** — Vid klick på en hållplats på kartan, visa en popup med nästa avgångar (återanvänd departures-API:et).

## Avgångstavla

- [ ] **7. Planerade tider som fallback** — Visa "kl HH:MM" bredvid "X min" i den grupperade vyn så man ser faktisk avgångstid, inte bara nedräkning.
- [ ] **8. Auto-complete sökning** — Debounced sökresultat med highlight av matchande text. Visa senast sökta hållplatser (localStorage).
- [ ] **9. Favorithållplatser** — Spara 3-5 favoriter i localStorage. Visa som snabbknappar ovanför sökfältet. T.ex. "Västerås C", "Norra Gryta", "Björnögården".
- [ ] **10. URL-routing per hållplats** — `#/departures/9021019360046000` så man kan dela/bokmärka en specifik avgångstavla. Uppdatera URL vid byte av hållplats.
- [ ] **11. Mer tidtabellsdata** — Visa även tidtabell för resten av dagen, inte bara 90 min framåt. Expanderbart per linje.

## Trafikinfo

- [ ] **12. Trafikstörningar (ServiceAlerts)** — Hämta /api/realtime/alerts, visa som banderoll högst upp. Färgkoda: röd=allvarlig, gul=information. Worker-endpointen finns redan.
- [ ] **13. Förseningsindikator per linje** — I linjelistan, visa genomsnittlig försening per linje just nu (aggregera från TripUpdates). Grön/gul/röd prick.

## UX & Design

- [ ] **14. Fullscreen-fix** — Kartan sträcker inte ut vertikalt korrekt i Safari. Testa med `position:fixed` + `inset:0` som alternativ till Fullscreen API. Testa på iOS Safari.
- [ ] **15. Mobil-responsivitet** — Tabbar som swipebara, karta 100vh på mobil, avgångstavla med större touch targets. Testa på iPhone/iPad.
- [ ] **16. PWA** — Lägg till manifest.json + service worker för "Add to Home Screen". Casha GTFS-summary lokalt för snabbare start. Offline-meddelande om nätverket går ner.
- [ ] **17. Loading states** — Skeleton-loading för avgångstavlan medan data hämtas. Smooth fade-in för fordon som dyker upp på kartan.

## Infrastruktur

- [ ] **18. Automatisk GTFS-uppdatering** — Cloudflare Cron Trigger som laddar ner ny GTFS-data varje natt kl 07:00 och uppdaterar KV. Kräver att download+parse-logiken flyttas till workern eller en separat scheduled worker.
- [ ] **19. Felhantering och retry** — Exponential backoff vid API-fel. Visa tydligt felmeddelande om workern inte svarar. Fallback till cached data om realtid är nere.
- [ ] **20. Analytics** — Enkel räknare (KV-baserad eller Cloudflare Analytics) för att se hur många som använder appen. Vilka hållplatser som söks mest. Ingen extern tracking.

## Noteringar för Claude Code

- Projektet använder Vite + React (JSX, ESM).
- API-anrop wrappas med `apiUrl()` från `src/lib/api.js`.
- I dev: `npm run dev` startar Express-server (port 3001) + Vite (port 5173) med proxy.
- I prod: frontenden på GitHub Pages pratar med `https://vl-transit-api.martingrahn.workers.dev`.
- Workern deployas med `cd worker && npx wrangler deploy`.
- KV-data laddas upp med `node scripts/upload-kv.js` (kräver `npm run download-gtfs` först).
- GTFS-data för Västmanland: operator = `vastmanland`, statisk nyckel i `.env`.
- Trafiklab API-nycklar: GTFS Regional Static (Bronze, 50 req/mån), GTFS Regional Realtime (Bronze, 30 000 req/mån).
- GitHub Actions deployer frontenden automatiskt vid push till main.
- `VITE_API_URL` sätts som repo-variabel i GitHub Settings → Variables → Actions.
