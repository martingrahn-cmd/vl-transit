import React, { useState, useMemo } from 'react';

// Generera färg per route
function routeColor(routeId, gtfsColor) {
  if (gtfsColor) return gtfsColor;
  const colors = [
    '#E63946', '#457B9D', '#2A9D8F', '#E9C46A', '#F4845F',
    '#6A4C93', '#1982C4', '#8AC926', '#FF595E', '#118AB2',
  ];
  let hash = 0;
  for (const c of String(routeId)) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

// Route type namn
function routeTypeName(type) {
  const types = {
    0: 'Spårvagn', 1: 'Tunnelbana', 2: 'Tåg', 3: 'Buss',
    4: 'Färja', 5: 'Linbana', 6: 'Gondol', 7: 'Bergbana',
    100: 'Tåg', 200: 'Buss', 700: 'Buss', 702: 'Expressbuss',
    717: 'Sjötrafik', 900: 'Spårvagn', 1000: 'Sjötrafik',
  };
  return types[type] || 'Buss';
}

export default function LineList({ gtfs }) {
  const [expandedId, setExpandedId] = useState(null);
  const [filter, setFilter] = useState('');

  // Sortera linjer — numeriskt om möjligt
  const sortedRoutes = useMemo(() => {
    return [...gtfs.routes].sort((a, b) => {
      const na = parseInt(a.short);
      const nb = parseInt(b.short);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      if (!isNaN(na)) return -1;
      if (!isNaN(nb)) return 1;
      return (a.short || a.long || '').localeCompare(b.short || b.long || '', 'sv');
    });
  }, [gtfs.routes]);

  // Filtrera
  const filtered = useMemo(() => {
    if (!filter) return sortedRoutes;
    const q = filter.toLowerCase();
    return sortedRoutes.filter(r =>
      (r.short || '').toLowerCase().includes(q) ||
      (r.long || '').toLowerCase().includes(q)
    );
  }, [sortedRoutes, filter]);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Sök linje eller destination..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 14px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '14px',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontFamily: 'var(--font)',
          }}
        />
      </div>

      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
        {filtered.length} linjer · {gtfs.stats.trips} turer totalt
      </div>

      <div className="lines-grid">
        {filtered.map(route => {
          const color = routeColor(route.id, route.color);
          const trips = gtfs.tripsPerRoute[route.id] || 0;
          const typeName = routeTypeName(route.type);
          const expanded = expandedId === route.id;

          return (
            <div
              key={route.id}
              className={`line-card ${expanded ? 'expanded' : ''}`}
              onClick={() => setExpandedId(expanded ? null : route.id)}
            >
              <div className="line-head">
                <span className="line-num" style={{ background: color }}>
                  {route.short || '—'}
                </span>
                <div>
                  <div className="line-name">
                    {route.long || route.short || 'Okänd linje'}
                  </div>
                  <div className="line-meta">
                    {typeName} · {trips} turer/dag
                  </div>
                </div>
                <span className="line-trips">
                  {expanded ? '▲' : '▼'}
                </span>
              </div>

              {expanded && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    <div>Route ID: <code>{route.id}</code></div>
                    <div>Typ: {typeName} (GTFS type {route.type})</div>
                    {route.color && <div>GTFS-färg: {route.color}</div>}
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-dim)' }}>
                      Klicka på "Realtidskarta" för att se fordon på denna linje i realtid.
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
