import { useEffect, useState } from 'react';

type Health = { ok: boolean; db: string; schemaVersion: number };

/**
 * M0 placeholder. Confirms the single-origin setup end to end:
 * this page is served by the backend, and it reaches the backend's /api/health.
 * Real WallLayout/PhoneLayout arrive in M2/M3 (see docs/frontend-components.md).
 */
export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setError(String(e)));
  }, []);

  const time = now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <main className="placeholder">
      <div className="clock">{time}</div>
      <div className="date">{date}</div>
      <h1>Family Calendar</h1>
      <p className="tag">M0 scaffold — single origin, SQLite ready.</p>

      <div className="card">
        {error && <span className="bad">API unreachable: {error}</span>}
        {!error && !health && <span className="muted">Checking API…</span>}
        {health && (
          <span className={health.ok ? 'good' : 'bad'}>
            API {health.ok ? 'healthy' : 'unhealthy'} · db: {health.db} · schema v
            {health.schemaVersion}
          </span>
        )}
      </div>
    </main>
  );
}
