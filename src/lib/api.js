/**
 * API-konfiguration
 * 
 * I dev: proxas via Vite till localhost:3001
 * I prod: pekar direkt till Cloudflare Worker
 */

// Sätts vid build: VITE_API_URL=https://vl-transit-api.xxx.workers.dev
const API_BASE = import.meta.env.VITE_API_URL || '';

export function apiUrl(path) {
  return `${API_BASE}${path}`;
}
