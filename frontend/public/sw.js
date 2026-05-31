/* Family Calendar service worker — never-blank cache (spec §0).
 * - App shell (navigation + assets): cache-first with background update.
 * - API GETs: stale-while-revalidate, so a reload with the server down still
 *   renders the last-good payload instead of a blank/error screen. */
const SHELL = 'homecal-shell-v1';
const API = 'homecal-api-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/index.html'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== API).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations → serve cached shell instantly, fall back to network.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('/index.html').then((cached) => {
        const net = fetch(req)
          .then((res) => {
            caches.open(SHELL).then((c) => c.put('/index.html', res.clone()));
            return res;
          })
          .catch(() => cached);
        return cached || net;
      })
    );
    return;
  }

  // API → stale-while-revalidate.
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
        return cached || net;
      })
    );
    return;
  }

  // Static assets → cache-first with background refresh.
  event.respondWith(
    caches.open(SHELL).then(async (cache) => {
      const cached = await cache.match(req);
      const net = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || net;
    })
  );
});
