import React, { useState, useEffect } from 'react';
import RealtimeMap from './components/RealtimeMap';
import DepartureBoard from './components/DepartureBoard';
import LineList from './components/LineList';
import { apiUrl } from './lib/api';

const TABS = [
  { id: 'map', label: 'Realtidskarta', icon: '🗺️' },
  { id: 'departures', label: 'Avgångstavla', icon: '🕐' },
  { id: 'lines', label: 'Linjenät', icon: '🚌' },
];

export default function App() {
  const [tab, setTab] = useState('map');
  const [gtfs, setGtfs] = useState(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      fetch(apiUrl('/api/health')).then(r => r.json()),
      fetch(apiUrl('/api/gtfs/summary')).then(r => r.json()),
    ])
      .then(([h, g]) => {
        setHealth(h);
        if (g.error) {
          setError(g.error);
        } else {
          setGtfs(g);
        }
      })
      .catch(err => {
        setError(`Kan inte ansluta till servern. Kör: npm run dev\n${err.message}`);
      });
  }, []);

  return (
    <div className="app">
      <header className="header">
        <div className="header-logo">VL</div>
        <h1>VL Realtid</h1>
        <div className="status">
          <div className={`status-dot ${health?.realtimeKey ? '' : 'offline'}`} />
          <span className="status-text">
            {health?.realtimeKey ? 'Live' : 'Offline'}
          </span>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error && (
        <div className="error-box">
          <strong>Konfigurationsfel:</strong> {error}
        </div>
      )}

      {!error && !gtfs && (
        <div className="loading">
          <div className="spinner" />
          <span>Laddar GTFS-data...</span>
        </div>
      )}

      {gtfs && tab === 'map' && <RealtimeMap gtfs={gtfs} />}
      {gtfs && tab === 'departures' && <DepartureBoard gtfs={gtfs} />}
      {gtfs && tab === 'lines' && <LineList gtfs={gtfs} />}
    </div>
  );
}
