/* Family Calendar service worker — never-blank cache (spec §0).
 *
 * Cache versioning: the main app registers `/sw.js?v=<buildId>`, so the browser
 * byte-compares on each page load and activates a new SW after a redeploy.
 * On activate the old shell cache is evicted; Vite-hashed assets self-expire.
 *
 * Navigation: NETWORK-FIRST with cache fallback — the wall always gets the
 * latest index.html when the server is up, but survives a restart on last-good.
 *
 * API GETs: stale-while-revalidate so a reload with the server down still
 * renders the last-good payload.
 *
 * Static assets: cache-first (Vite content-hashes them, so a new build = new URL). */

const BUILD = new URL(self.location.href).searchParams.get('v') || 'dev';
const SHELL = `homecal-shell-${BUILD}`;
const API = 'homecal-api-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(['/', '/index.html']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== SHELL && k !== API)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    const cacheWrite = fetch(req)
      .then((res) => {
        event.waitUntil(caches.open(SHELL).then((c) => c.put('/index.html', res.clone())));
        return res;
      })
      .catch(() => caches.match('/index.html').then((c) => c || new Response('Offline', { status: 503 })));
    event.respondWith(cacheWrite);
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      caches.open(API).then(async (cache) => {
        const cached = await cache.match(req);
        const net = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || (await net) || new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } });
      })
    );
    return;
  }

  event.respondWith(
    caches.open(SHELL).then(async (cache) => {
      const cached = await cache.match(req);
      const net = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || (await net) || new Response('', { status: 503 });
    })
  );
});
