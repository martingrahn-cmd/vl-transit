import React, { useEffect, useState, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Marker, Polyline, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { apiUrl } from '../lib/api';

const VASTERAS_CENTER = [59.6099, 16.5448];
const DEFAULT_ZOOM = 13;

const TILE_LAYERS = {
  light: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://osm.org/copyright">OpenStreetMap</a>',
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
  },
};

function routeColor(routeId) {
  const colors = [
    '#E63946', '#457B9D', '#2A9D8F', '#E9C46A', '#F4845F',
    '#6A4C93', '#1982C4', '#8AC926', '#FF595E', '#118AB2',
  ];
  let hash = 0;
  for (const c of String(routeId)) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

// #4 — Buss-ikon med riktningspil
function createBusIcon(routeShort, color, bearing) {
  const arrow = bearing != null
    ? `<div class="bus-bearing" style="transform:rotate(${bearing}deg)">&#9650;</div>`
    : '';
  return L.divIcon({
    className: '',
    html: `<div class="bus-marker" style="background:${color}">${routeShort || '?'}${arrow}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function FitBounds({ vehicles }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (vehicles.length > 0 && !fitted.current) {
      const bounds = vehicles.map(v => [v.lat, v.lon]);
      if (bounds.length > 1) map.fitBounds(bounds, { padding: [30, 30] });
      fitted.current = true;
    }
  }, [vehicles, map]);
  return null;
}

function MapResizer({ fullscreen }) {
  const map = useMap();
  useEffect(() => {
    const t1 = setTimeout(() => map.invalidateSize(), 50);
    const t2 = setTimeout(() => map.invalidateSize(), 200);
    const t3 = setTimeout(() => map.invalidateSize(), 500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [fullscreen, map]);
  return null;
}

// #6 — Hållplats-popup med avgångar
function StopPopupContent({ stopId }) {
  const [deps, setDeps] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDeps(null);
    setError(null);
    fetch(apiUrl(`/api/realtime/departures/${stopId}`))
      .then(r => r.json())
      .then(data => setDeps(data))
      .catch(() => setError('Kunde inte hämta avgångar'));
  }, [stopId]);

  if (error) return <span style={{ color: '#f66' }}>{error}</span>;
  if (!deps) return <span>Laddar avgångar...</span>;
  if (deps.departures.length === 0) return <span>Inga avgångar just nu</span>;

  return (
    <div style={{ maxHeight: 200, overflowY: 'auto', minWidth: 180 }}>
      <strong>{deps.stopName}</strong>
      <table style={{ width: '100%', fontSize: 12, marginTop: 4, borderCollapse: 'collapse' }}>
        <tbody>
          {deps.departures.slice(0, 8).map((d, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{
                fontWeight: 700, color: '#fff', textAlign: 'center',
                background: d.routeColor || '#888', borderRadius: 3,
                padding: '2px 5px', minWidth: 28,
              }}>
                {d.routeShort}
              </td>
              <td style={{ padding: '3px 6px' }}>{d.headsign}</td>
              <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {d.minsAway <= 0 ? 'Nu' : `${d.minsAway} min`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RealtimeMap({ gtfs }) {
  const [vehicles, setVehicles] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [withRoute, setWithRoute] = useState(0);
  const [hideUnknown, setHideUnknown] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [shapes, setShapes] = useState(null);
  const [selectedVehicle, setSelectedVehicle] = useState(null); // #2 — valt fordon
  const [fullscreen, setFullscreen] = useState(false);
  const wrapperRef = useRef(null);

  // Hämta shapes (en gång)
  useEffect(() => {
    fetch(apiUrl('/api/gtfs/shapes'))
      .then(r => r.json())
      .then(data => setShapes(data))
      .catch(err => console.warn('Shapes:', err.message));
  }, []);

  useEffect(() => {
    let active = true;
    async function fetchVehicles() {
      try {
        const res = await fetch(apiUrl('/api/realtime/vehicles'));
        const data = await res.json();
        if (!active) return;
        if (data.vehicles) {
          setVehicles(data.vehicles);
          setVehicleCount(data.count);
          setWithRoute(data.withRoute || 0);
          setLastUpdate(new Date());
        }
      } catch (err) {
        console.warn('Realtidsdata:', err.message);
      }
    }
    fetchVehicles();
    const interval = setInterval(fetchVehicles, 5000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    }
  }, []);

  useEffect(() => {
    const handler = () => {
      const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
      setFullscreen(isFS);
    };
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    };
  }, []);

  const displayVehicles = hideUnknown
    ? vehicles.filter(v => v.routeId)
    : vehicles;

  const stopAreas = gtfs.stops.filter(s => s.type === 1 || s.type === 0);

  // #2 — Hitta shapes för valt fordon
  const selectedRouteShapes = selectedVehicle?.routeId && shapes
    ? shapes[selectedVehicle.routeId] || []
    : [];

  const tile = darkMode ? TILE_LAYERS.dark : TILE_LAYERS.light;

  const labelStyle = {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none',
  };

  return (
    <div ref={wrapperRef} className={fullscreen ? 'fullscreen-wrapper' : ''}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: fullscreen ? '8px 14px' : '0 0 10px',
        background: fullscreen ? 'var(--bg)' : 'transparent',
        flexWrap: 'wrap',
        flexShrink: 0,
      }}>
        <label style={labelStyle}>
          <input type="checkbox" checked={hideUnknown}
            onChange={e => setHideUnknown(e.target.checked)}
            style={{ accentColor: 'var(--vl-blue)' }} />
          Dölj okända
        </label>

        <label style={labelStyle}>
          <input type="checkbox" checked={showRoutes}
            onChange={e => setShowRoutes(e.target.checked)}
            style={{ accentColor: 'var(--vl-blue)' }} />
          Ruttlinjer
        </label>

        <label style={labelStyle}>
          <input type="checkbox" checked={darkMode}
            onChange={e => setDarkMode(e.target.checked)}
            style={{ accentColor: 'var(--vl-blue)' }} />
          Mörkt tema
        </label>

        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Visar {displayVehicles.length} av {vehicleCount}
        </span>

        <button onClick={toggleFullscreen} style={{
          marginLeft: 'auto', padding: '6px 12px', fontSize: 12,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', color: 'var(--text)',
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
          {fullscreen ? '✕ Avsluta fullskärm' : '⛶ Fullskärm'}
        </button>
      </div>

      {/* Map */}
      <div className="map-container">
        <MapContainer
          center={VASTERAS_CENTER}
          zoom={DEFAULT_ZOOM}
          scrollWheelZoom={true}
          style={{ height: fullscreen ? 'calc(100vh - 80px)' : '500px', width: '100%' }}
        >
          {/* #3 — Dark/light tile layer */}
          <TileLayer key={tile.url} attribution={tile.attribution} url={tile.url} />

          <MapResizer fullscreen={fullscreen} />

          {/* #1 — Ruttlinjer (alla) */}
          {showRoutes && shapes && !selectedVehicle && gtfs.routes && gtfs.routes.map(route => {
            const routeShapes = shapes[route.id];
            if (!routeShapes || routeShapes.length === 0) return null;
            const color = route.color || routeColor(route.id);
            return routeShapes.map((coords, i) => (
              <Polyline
                key={`${route.id}-${i}`}
                positions={coords}
                pathOptions={{ color, weight: 3, opacity: 0.5 }}
              >
                <Popup>
                  <strong>Linje {route.short}</strong>
                  {route.long && <><br />{route.long}</>}
                </Popup>
              </Polyline>
            ));
          })}

          {/* #2 — Highlightad rutt för valt fordon */}
          {selectedVehicle && selectedRouteShapes.map((coords, i) => (
            <Polyline
              key={`sel-${i}`}
              positions={coords}
              pathOptions={{
                color: selectedVehicle.routeColor || routeColor(selectedVehicle.routeId),
                weight: 5,
                opacity: 0.9,
              }}
            />
          ))}

          {/* #5 — Klustrade hållplatser med #6 avgångar-popup */}
          <MarkerClusterGroup
            chunkedLoading
            maxClusterRadius={40}
            spiderfyOnMaxZoom
            showCoverageOnHover={false}
            iconCreateFunction={(cluster) => {
              const count = cluster.getChildCount();
              return L.divIcon({
                html: `<div class="stop-cluster">${count}</div>`,
                className: '',
                iconSize: [30, 30],
              });
            }}
          >
            {stopAreas.map(stop => (
              <CircleMarker
                key={stop.id}
                center={[stop.lat, stop.lon]}
                radius={5}
                pathOptions={{
                  fillColor: darkMode ? '#4da6ff' : '#0054A6',
                  fillOpacity: 0.6,
                  stroke: true,
                  color: darkMode ? '#222' : '#fff',
                  weight: 1,
                }}
              >
                <Popup>
                  <StopPopupContent stopId={stop.id} />
                </Popup>
              </CircleMarker>
            ))}
          </MarkerClusterGroup>

          {/* Bussar */}
          {displayVehicles.map(v => {
            const color = v.routeColor || routeColor(v.routeId || v.vehicleId);
            const routeShort = v.routeShort || '?';
            const hasRoute = !!v.routeId;
            const isSelected = selectedVehicle?.id === v.id;

            return (
              <Marker
                key={v.id}
                position={[v.lat, v.lon]}
                icon={createBusIcon(routeShort, hasRoute ? color : '#888', v.bearing)}
                zIndexOffset={isSelected ? 1000 : 0}
                eventHandlers={{
                  click: () => {
                    // #2 — Toggle: klicka igen för att avmarkera
                    setSelectedVehicle(prev => prev?.id === v.id ? null : v);
                  },
                }}
              >
                <Popup>
                  <strong>{hasRoute ? `Linje ${routeShort}` : 'Okänt fordon'}</strong>
                  {v.headsign && <><br />Mot {v.headsign}</>}
                  {v.routeLong && <><br /><small>{v.routeLong}</small></>}
                  <br />
                  <small>
                    Fordon: {v.vehicleId}<br />
                    Hastighet: {v.speed ? `${(v.speed * 3.6).toFixed(0)} km/h` : '—'}<br />
                    Riktning: {v.bearing ? `${v.bearing.toFixed(0)}°` : '—'}
                  </small>
                </Popup>
              </Marker>
            );
          })}

          <FitBounds vehicles={displayVehicles} />
        </MapContainer>

        <div className="map-info" style={{ flexShrink: 0 }}>
          <span>
            {displayVehicles.length} fordon
            {hideUnknown && ` (${vehicleCount - withRoute} dolda)`}
            {lastUpdate && ` · ${lastUpdate.toLocaleTimeString('sv-SE')}`}
          </span>
          {selectedVehicle && (
            <span
              style={{ cursor: 'pointer', color: 'var(--vl-blue)' }}
              onClick={() => setSelectedVehicle(null)}
            >
              ✕ Avmarkera linje {selectedVehicle.routeShort}
            </span>
          )}
          <span>{gtfs.stats.parentStops} hållplatser</span>
        </div>
      </div>
    </div>
  );
}
