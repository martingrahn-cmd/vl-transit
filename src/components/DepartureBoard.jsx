import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiUrl } from '../lib/api';

const ROUTE_COLORS = ['#E63946', '#457B9D', '#2A9D8F', '#E9C46A', '#F4845F', '#6A4C93', '#1982C4'];
function fallbackColor(str) {
  let hash = 0;
  for (const c of String(str)) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return ROUTE_COLORS[Math.abs(hash) % ROUTE_COLORS.length];
}

export default function DepartureBoard({ gtfs }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedStop, setSelectedStop] = useState(null);
  const [departures, setDepartures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [clock, setClock] = useState('');
  const [viewMode, setViewMode] = useState('grouped'); // 'grouped' | 'list'

  // Klocka
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('sv-SE'));
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, []);

  // Auto-välj Västerås Central vid start
  useEffect(() => {
    const central = gtfs.stops.find(s =>
      s.name.toLowerCase().includes('västerås') &&
      (s.name.toLowerCase().includes('central') || s.name.toLowerCase().includes('resecentr'))
    );
    if (central) setSelectedStop(central);
  }, [gtfs.stops]);

  // Sök hållplatser
  useEffect(() => {
    if (searchQuery.length < 2) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(apiUrl(`/api/gtfs/stops/search?q=${encodeURIComponent(searchQuery)}`));
        setSearchResults(await res.json());
      } catch { setSearchResults([]); }
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Hämta avgångar
  const fetchDepartures = useCallback(async () => {
    if (!selectedStop) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/realtime/departures/${selectedStop.id}`));
      const data = await res.json();
      setDepartures(data.departures || []);
    } catch (err) {
      console.warn('Avgångar:', err.message);
      setDepartures([]);
    }
    setLoading(false);
  }, [selectedStop]);

  useEffect(() => {
    fetchDepartures();
    const interval = setInterval(fetchDepartures, 15000);
    return () => clearInterval(interval);
  }, [fetchDepartures]);

  function selectStop(stop) {
    setSelectedStop(stop);
    setSearchQuery('');
    setSearchResults([]);
  }

  function formatTime(timeStr) {
    if (!timeStr) return '--:--';
    // timeStr is now "HH:MM:SS"
    return timeStr.slice(0, 5);
  }

  // Gruppera avgångar per linje + riktning
  const grouped = useMemo(() => {
    const groups = {};
    for (const dep of departures) {
      // Nyckla på linje + headsign (riktning)
      const key = `${dep.routeShort}::${dep.headsign}`;
      if (!groups[key]) {
        groups[key] = {
          routeShort: dep.routeShort,
          routeColor: dep.routeColor,
          headsign: dep.headsign,
          departures: [],
        };
      }
      groups[key].departures.push(dep);
    }

    // Sortera grupper: lägst minsAway först
    return Object.values(groups).sort((a, b) => {
      const aMin = a.departures[0]?.minsAway ?? 999;
      const bMin = b.departures[0]?.minsAway ?? 999;
      return aMin - bMin;
    });
  }, [departures]);

  function renderTimeChip(dep) {
    const cls = dep.minsAway <= 0 ? 'now' : dep.minsAway <= 2 ? 'soon' : '';
    const str = dep.minsAway <= 0 ? 'Nu' : `${dep.minsAway} min`;
    const delayMin = Math.round(dep.delay / 60);
    return (
      <span key={dep.tripId} className={`dep-chip ${cls}`}>
        {str}
        {delayMin > 0 && <span style={{ color: '#f59e0b', fontSize: 11 }}> +{delayMin}</span>}
        {dep.platform && <span className="dep-chip-platform">Läge {dep.platform}</span>}
        {dep.realtime && <span className="dep-chip-rt" title="Realtid">●</span>}
      </span>
    );
  }

  return (
    <div className="dep-board">
      <div className="dep-header">
        <h2>{selectedStop?.name || 'Välj hållplats'}</h2>
        <span className="dep-clock">{clock}</span>
      </div>

      <div className="dep-stop-select">
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            placeholder="Sök hållplats..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%', padding: '8px 12px', background: '#12122a',
              color: '#ccc', border: '1px solid #2a2a4a', borderRadius: '6px',
              fontSize: '13px', fontFamily: 'inherit',
            }}
          />
          {searchResults.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0,
              background: '#16163a', border: '1px solid #2a2a4a',
              borderRadius: '0 0 6px 6px', maxHeight: '200px',
              overflowY: 'auto', zIndex: 10,
            }}>
              {searchResults.map(s => (
                <div key={s.id} onClick={() => selectStop(s)}
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', color: '#ccc', borderBottom: '1px solid #1f1f3a' }}
                  onMouseEnter={e => e.target.style.background = '#22224a'}
                  onMouseLeave={e => e.target.style.background = 'transparent'}
                >{s.name}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Vy-växlare */}
      <div style={{ display: 'flex', gap: 2, padding: '0 18px 0', borderBottom: '1px solid #1a1a2e' }}>
        <button onClick={() => setViewMode('grouped')}
          style={{
            padding: '8px 14px', fontSize: '12px', border: 'none', cursor: 'pointer',
            background: viewMode === 'grouped' ? '#1a1a3a' : 'transparent',
            color: viewMode === 'grouped' ? '#f0c040' : '#555',
            borderBottom: viewMode === 'grouped' ? '2px solid #f0c040' : '2px solid transparent',
            fontFamily: 'inherit',
          }}>Per linje</button>
        <button onClick={() => setViewMode('list')}
          style={{
            padding: '8px 14px', fontSize: '12px', border: 'none', cursor: 'pointer',
            background: viewMode === 'list' ? '#1a1a3a' : 'transparent',
            color: viewMode === 'list' ? '#f0c040' : '#555',
            borderBottom: viewMode === 'list' ? '2px solid #f0c040' : '2px solid transparent',
            fontFamily: 'inherit',
          }}>Kronologisk</button>
      </div>

      {/* Loading / empty state */}
      {loading && departures.length === 0 && (
        <div style={{ padding: '30px 18px', textAlign: 'center', color: '#555', fontSize: '14px' }}>
          Hämtar avgångar...
        </div>
      )}
      {!loading && departures.length === 0 && selectedStop && (
        <div style={{ padding: '30px 18px', textAlign: 'center', color: '#555', fontSize: '14px' }}>
          Inga avgångar just nu.
          <br /><small style={{ color: '#444' }}>Realtidsdata visar bara aktiva turer — fler avgångar dagtid.</small>
        </div>
      )}

      {/* Grupperad vy */}
      {viewMode === 'grouped' && grouped.map(group => {
        const color = group.routeColor || fallbackColor(group.routeShort);
        return (
          <div key={`${group.routeShort}-${group.headsign}`} className="dep-group">
            <div className="dep-group-header">
              <span className="line-badge" style={{ background: color }}>
                {group.routeShort}
              </span>
              <span className="dep-group-dest">{group.headsign}</span>
            </div>
            <div className="dep-group-times">
              {group.departures.slice(0, 4).map(dep => renderTimeChip(dep))}
            </div>
          </div>
        );
      })}

      {/* Kronologisk vy */}
      {viewMode === 'list' && (
        <>
          <div className="dep-columns">
            <span>Linje</span>
            <span>Destination</span>
            <span>Läge</span>
            <span style={{ textAlign: 'right' }}>Avg</span>
          </div>
          {departures.map((dep, i) => {
            const timeClass = dep.minsAway <= 0 ? 'now' : dep.minsAway <= 2 ? 'soon' : '';
            const timeStr = dep.minsAway <= 0 ? 'Nu' : `${dep.minsAway} min`;
            const color = dep.routeColor || fallbackColor(dep.routeShort);
            const delayMin = Math.round(dep.delay / 60);
            return (
              <div key={`${dep.tripId}-${i}`} className="dep-row">
                <span>
                  <span className="line-badge" style={{ background: color }}>{dep.routeShort}</span>
                </span>
                <span className="dep-dest">
                  {dep.headsign}
                  {delayMin > 0 && <span style={{ color: '#f59e0b', fontSize: 11, marginLeft: 6 }}>+{delayMin}m</span>}
                </span>
                <span className="dep-platform">{dep.platform ? `Läge ${dep.platform}` : ''}</span>
                <span className={`dep-time ${timeClass}`}>{timeStr}</span>
              </div>
            );
          })}
        </>
      )}

      <div className="dep-footer">
        Trafiklab GTFS-RT · {departures.length} avgångar · Uppdateras var 15:e sekund
      </div>
    </div>
  );
}
