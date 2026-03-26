import React, { useEffect, useState, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { apiUrl } from '../lib/api';

const VASTERAS_CENTER = [59.6099, 16.5448];
const DEFAULT_ZOOM = 13;

function routeColor(routeId) {
  const colors = [
    '#E63946', '#457B9D', '#2A9D8F', '#E9C46A', '#F4845F',
    '#6A4C93', '#1982C4', '#8AC926', '#FF595E', '#118AB2',
  ];
  let hash = 0;
  for (const c of String(routeId)) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function createBusIcon(routeShort, color) {
  return L.divIcon({
    className: '',
    html: `<div class="bus-marker" style="background:${color}">${routeShort || '?'}</div>`,
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
    // Multiple invalidations to handle the transition
    const t1 = setTimeout(() => map.invalidateSize(), 50);
    const t2 = setTimeout(() => map.invalidateSize(), 200);
    const t3 = setTimeout(() => map.invalidateSize(), 500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [fullscreen, map]);
  return null;
}

export default function RealtimeMap({ gtfs }) {
  const [vehicles, setVehicles] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [withRoute, setWithRoute] = useState(0);
  const [hideUnknown, setHideUnknown] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const wrapperRef = useRef(null);

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
        <label style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none',
        }}>
          <input
            type="checkbox"
            checked={hideUnknown}
            onChange={e => setHideUnknown(e.target.checked)}
            style={{ accentColor: 'var(--vl-blue)' }}
          />
          Dölj okända fordon
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
          <TileLayer
            attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapResizer fullscreen={fullscreen} />

          {stopAreas.slice(0, 200).map(stop => (
            <CircleMarker
              key={stop.id}
              center={[stop.lat, stop.lon]}
              radius={3}
              pathOptions={{
                fillColor: '#0054A6', fillOpacity: 0.4,
                stroke: true, color: '#fff', weight: 1,
              }}
            >
              <Popup>
                <strong>{stop.name}</strong><br />
                <small>ID: {stop.id}</small>
              </Popup>
            </CircleMarker>
          ))}

          {displayVehicles.map(v => {
            const color = v.routeColor || routeColor(v.routeId || v.vehicleId);
            const routeShort = v.routeShort || '?';
            const hasRoute = !!v.routeId;

            return (
              <Marker
                key={v.id}
                position={[v.lat, v.lon]}
                icon={createBusIcon(routeShort, hasRoute ? color : '#888')}
              >
                <Popup>
                  <strong>{hasRoute ? `Linje ${routeShort}` : 'Okänt fordon'}</strong>
                  {v.routeLong && <><br />{v.routeLong}</>}
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
          <span>{gtfs.stats.parentStops} hållplatser</span>
        </div>
      </div>
    </div>
  );
}
