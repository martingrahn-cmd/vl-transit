import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiUrl } from '../lib/api';

const ROUTE_COLORS = ['#E63946', '#457B9D', '#2A9D8F', '#E9C46A', '#F4845F', '#6A4C93', '#1982C4'];
function fallbackColor(str) {
  let hash = 0;
  for (const c of String(str)) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return ROUTE_COLORS[Math.abs(hash) % ROUTE_COLORS.length];
}

// #9 — Favoriter i localStorage
function loadFavorites() {
  try { return JSON.parse(localStorage.getItem('vl-favorites') || '[]'); } catch { return []; }
}
function saveFavorites(favs) {
  localStorage.setItem('vl-favorites', JSON.stringify(favs.slice(0, 5)));
}

// #8 — Senaste sökningar i localStorage
function loadRecent() {
  try { return JSON.parse(localStorage.getItem('vl-recent-stops') || '[]'); } catch { return []; }
}
function saveRecent(stop) {
  const recent = loadRecent().filter(s => s.id !== stop.id);
  recent.unshift({ id: stop.id, name: stop.name });
  localStorage.setItem('vl-recent-stops', JSON.stringify(recent.slice(0, 5)));
}

export default function DepartureBoard({ gtfs, initialStopId }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedStop, setSelectedStop] = useState(null);
  const [departures, setDepartures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [clock, setClock] = useState('');
  const [viewMode, setViewMode] = useState('grouped');
  const [favorites, setFavorites] = useState(loadFavorites);
  const [showFullDay, setShowFullDay] = useState(false); // #11
  const [expandedLines, setExpandedLines] = useState(new Set()); // #11

  // Klocka
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('sv-SE'));
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, []);

  // #10 — Läs stop från URL-hash eller initialStopId
  useEffect(() => {
    const hashStop = window.location.hash.match(/^#\/departures\/(.+)$/);
    const targetId = hashStop?.[1] || initialStopId;

    if (targetId) {
      const stop = gtfs.stops.find(s => s.id === targetId);
      if (stop) { setSelectedStop(stop); return; }
      // Om inte i summary, skapa provisoriskt
      setSelectedStop({ id: targetId, name: 'Laddar...' });
      return;
    }
    // Fallback: Västerås Central
    const central = gtfs.stops.find(s =>
      s.name.toLowerCase().includes('västerås') &&
      (s.name.toLowerCase().includes('central') || s.name.toLowerCase().includes('resecentr'))
    );
    if (central) setSelectedStop(central);
  }, [gtfs.stops, initialStopId]);

  // #8 — Sök hållplatser med debounce
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
      const hours = showFullDay ? 18 : 1.5;
      const res = await fetch(apiUrl(`/api/realtime/departures/${selectedStop.id}?hours=${hours}`));
      const data = await res.json();
      setDepartures(data.departures || []);
      // Uppdatera stoppnamn om vi bara hade ID
      if (selectedStop.name === 'Laddar...' && data.stopName) {
        setSelectedStop(prev => ({ ...prev, name: data.stopName }));
      }
    } catch (err) {
      console.warn('Avgångar:', err.message);
      setDepartures([]);
    }
    setLoading(false);
  }, [selectedStop, showFullDay]);

  useEffect(() => {
    fetchDepartures();
    const interval = setInterval(fetchDepartures, 15000);
    return () => clearInterval(interval);
  }, [fetchDepartures]);

  function selectStop(stop) {
    setSelectedStop(stop);
    setSearchQuery('');
    setSearchResults([]);
    setExpandedLines(new Set());
    saveRecent(stop);
    // #10 — Uppdatera URL
    window.location.hash = `/departures/${stop.id}`;
  }

  function toggleFavorite(stop) {
    const exists = favorites.some(f => f.id === stop.id);
    const updated = exists
      ? favorites.filter(f => f.id !== stop.id)
      : [...favorites, { id: stop.id, name: stop.name }].slice(0, 5);
    setFavorites(updated);
    saveFavorites(updated);
  }

  function formatTime(timeStr) {
    if (!timeStr) return '--:--';
    const [h, m] = timeStr.split(':');
    const hour = parseInt(h) % 24; // GTFS: 24:05 → 00:05, 25:30 → 01:30
    return `${String(hour).padStart(2, '0')}:${m}`;
  }

  // #8 — Highlight matchande text
  function highlightMatch(text, query) {
    if (!query || query.length < 2) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <strong style={{ color: '#f0c040' }}>{text.slice(idx, idx + query.length)}</strong>
        {text.slice(idx + query.length)}
      </>
    );
  }

  // Gruppera avgångar per linje + riktning
  const grouped = useMemo(() => {
    const groups = {};
    for (const dep of departures) {
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
    return Object.values(groups).sort((a, b) => {
      const aMin = a.departures[0]?.minsAway ?? 999;
      const bMin = b.departures[0]?.minsAway ?? 999;
      return aMin - bMin;
    });
  }, [departures]);

  // #7 — Tidschip med planerad tid
  function renderTimeChip(dep) {
    const cls = dep.minsAway <= 0 ? 'now' : dep.minsAway <= 2 ? 'soon' : '';
    const str = dep.minsAway <= 0 ? 'Nu' : `${dep.minsAway} min`;
    const delayMin = Math.round(dep.delay / 60);
    return (
      <span key={dep.tripId} className={`dep-chip ${cls}`}>
        {str}
        <span className="dep-chip-scheduled">kl {formatTime(dep.scheduledTime)}</span>
        {delayMin > 0 && <span style={{ color: '#f59e0b', fontSize: 11 }}> +{delayMin}</span>}
        {dep.platform && <span className="dep-chip-platform">Läge {dep.platform}</span>}
        {dep.realtime && <span className="dep-chip-rt" title="Realtid">●</span>}
      </span>
    );
  }

  const isFav = selectedStop && favorites.some(f => f.id === selectedStop.id);
  const recentStops = loadRecent();

  return (
    <div className="dep-board">
      <div className="dep-header">
        <h2>
          {selectedStop?.name || 'Välj hållplats'}
          {selectedStop && (
            <button
              onClick={() => toggleFavorite(selectedStop)}
              title={isFav ? 'Ta bort favorit' : 'Spara som favorit'}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 18, marginLeft: 8, verticalAlign: 'middle',
                color: isFav ? '#f0c040' : '#555',
              }}
            >{isFav ? '\u2605' : '\u2606'}</button>
          )}
        </h2>
        <span className="dep-clock">{clock}</span>
      </div>

      {/* #9 — Favoriter */}
      {favorites.length > 0 && (
        <div style={{ display: 'flex', gap: 6, padding: '0 18px 8px', flexWrap: 'wrap' }}>
          {favorites.map(fav => (
            <button key={fav.id} onClick={() => selectStop(fav)}
              style={{
                padding: '4px 10px', fontSize: 12, borderRadius: 12,
                border: selectedStop?.id === fav.id ? '1px solid #f0c040' : '1px solid #2a2a4a',
                background: selectedStop?.id === fav.id ? '#2a2a3a' : '#12122a',
                color: selectedStop?.id === fav.id ? '#f0c040' : '#aaa',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >{fav.name}</button>
          ))}
        </div>
      )}

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
          {/* #8 — Sökresultat med highlight + senaste */}
          {(searchResults.length > 0 || (searchQuery.length === 0 && recentStops.length > 0 && document.activeElement?.placeholder === 'Sök hållplats...')) && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0,
              background: '#16163a', border: '1px solid #2a2a4a',
              borderRadius: '0 0 6px 6px', maxHeight: '200px',
              overflowY: 'auto', zIndex: 10,
            }}>
              {searchResults.length > 0 ? searchResults.map(s => (
                <div key={s.id} onClick={() => selectStop(s)}
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', color: '#ccc', borderBottom: '1px solid #1f1f3a' }}
                  onMouseEnter={e => e.target.style.background = '#22224a'}
                  onMouseLeave={e => e.target.style.background = 'transparent'}
                >{highlightMatch(s.name, searchQuery)}</div>
              )) : recentStops.map(s => (
                <div key={s.id} onClick={() => selectStop(s)}
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', color: '#777', borderBottom: '1px solid #1f1f3a' }}
                  onMouseEnter={e => e.target.style.background = '#22224a'}
                  onMouseLeave={e => e.target.style.background = 'transparent'}
                >
                  <span style={{ color: '#555', marginRight: 6 }}>&#8635;</span>{s.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Vy-växlare + #11 heldag-toggle */}
      <div style={{ display: 'flex', gap: 2, padding: '0 18px 0', borderBottom: '1px solid #1a1a2e', alignItems: 'center' }}>
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
        <label style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 12, color: '#555', cursor: 'pointer', userSelect: 'none', padding: '6px 0',
        }}>
          <input type="checkbox" checked={showFullDay}
            onChange={e => setShowFullDay(e.target.checked)}
            style={{ accentColor: '#f0c040' }} />
          Hela dagen
        </label>
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
        const key = `${group.routeShort}-${group.headsign}`;
        const isExpanded = expandedLines.has(key);
        const visibleDeps = isExpanded ? group.departures : group.departures.slice(0, 4);
        const hasMore = group.departures.length > 4;

        return (
          <div key={key} className="dep-group">
            <div className="dep-group-header">
              <span className="line-badge" style={{ background: color }}>
                {group.routeShort}
              </span>
              <span className="dep-group-dest">{group.headsign}</span>
              {/* #11 — Expandera/kollapsa */}
              {hasMore && (
                <button onClick={() => {
                  setExpandedLines(prev => {
                    const next = new Set(prev);
                    next.has(key) ? next.delete(key) : next.add(key);
                    return next;
                  });
                }} style={{
                  background: 'none', border: 'none', color: '#555', cursor: 'pointer',
                  fontSize: 11, marginLeft: 'auto', fontFamily: 'inherit', padding: '2px 6px',
                }}>
                  {isExpanded ? 'Visa färre' : `+${group.departures.length - 4} till`}
                </button>
              )}
            </div>
            <div className="dep-group-times">
              {visibleDeps.map(dep => renderTimeChip(dep))}
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
            <span>Tid</span>
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
                {/* #7 — Planerad tid */}
                <span style={{ color: '#666', fontSize: 12 }}>
                  {formatTime(dep.scheduledTime)}
                  {dep.platform && <span style={{ marginLeft: 4, color: '#555' }}>L{dep.platform}</span>}
                </span>
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
