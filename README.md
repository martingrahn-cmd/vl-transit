# VL Realtid 🚌

Realtidsvisualisering av Västmanland Länstrafik (VL) med data från [Trafiklab](https://trafiklab.se).

Tre vyer:
- **Realtidskarta** — Live-positioner för alla VL-bussar på en Leaflet/OSM-karta
- **Avgångstavla** — Digital avgångstavla med realtidsinfo per hållplats
- **Linjenät** — Alla VL-linjer med metadata från GTFS

## Tech stack

- **Frontend:** React + Vite + Leaflet + react-leaflet
- **Backend:** Express (GTFS-proxy + protobuf-dekoder)
- **Data:** Trafiklab GTFS Regional (Static + Realtime)

## Snabbstart

### 1. Klona och installera

```bash
git clone <repo-url>
cd vl-transit
npm install
```

### 2. Konfigurera API-nycklar

Kopiera `.env.example` till `.env` och fyll i dina Trafiklab-nycklar:

```bash
cp .env.example .env
```

Du behöver:
- **GTFS Regional Static** (Bronze räcker — 50 req/mån)
- **GTFS Regional Realtime** (Bronze räcker — 30 000 req/mån)

Skaffa nycklar gratis på [developer.trafiklab.se](https://developer.trafiklab.se).

### 3. Ladda ner GTFS-data

```bash
npm run download-gtfs
```

Detta laddar ner och parsar VL:s GTFS Static-data (~hållplatser, linjer, turer).

### 4. Starta appen

```bash
npm run dev
```

Öppnar:
- Frontend: [http://localhost:5173](http://localhost:5173)
- API-server: [http://localhost:3001](http://localhost:3001)

## API-endpoints

| Endpoint | Beskrivning |
|---|---|
| `GET /api/health` | Hälsokontroll |
| `GET /api/gtfs/summary` | Sammanfattning av GTFS-data |
| `GET /api/gtfs/stops` | Alla hållplatser |
| `GET /api/gtfs/routes` | Alla linjer |
| `GET /api/gtfs/trips?route_id=` | Turer (filterbara) |
| `GET /api/realtime/vehicles` | Live GPS-positioner |
| `GET /api/realtime/trips` | Trip updates (förseningar) |
| `GET /api/realtime/alerts` | Trafikstörningar |

## Arkitektur

```
┌─────────────────────┐     ┌──────────────────────┐
│  React Frontend     │────►│  Express Server      │
│  (Vite dev server)  │     │  (port 3001)         │
│                     │     │                      │
│  - Leaflet karta    │     │  /api/gtfs/*         │
│  - Avgångstavla     │     │  └─ Serverar parsad   │
│  - Linjelista       │     │     GTFS JSON-data   │
│                     │     │                      │
│                     │     │  /api/realtime/*      │
│                     │     │  └─ Proxar protobuf   │
│                     │     │     från Trafiklab    │
└─────────────────────┘     └──────────┬───────────┘
                                       │
                            ┌──────────▼───────────┐
                            │  Trafiklab API       │
                            │  opendata.           │
                            │  samtrafiken.se      │
                            └──────────────────────┘
```

## Datakälla

Data tillhandahålls av [Trafiklab](https://trafiklab.se) under CC0 1.0-licens.

- **GTFS Regional Static** — Uppdateras dagligen kl 03-07
- **GTFS Regional Realtime** — VehiclePositions uppdateras var 2:a sekund, TripUpdates var 15:e sekund

## Utveckling

```bash
# Bara frontend
npm run client

# Bara server
npm run server

# Båda parallellt
npm run dev

# Tvinga ny nedladdning av GTFS
npm run download-gtfs -- --force
```

## Framtida idéer

- [ ] Shape-rendering (ruttgeometri på kartan)
- [ ] Filtrera kartan per linje
- [ ] Historik/analys med KoDa API
- [ ] PWA för mobil
- [ ] Deploy till Cloudflare Workers/Pages
