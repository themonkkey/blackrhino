// Cache-first for libraries, models and map tiles so repeat visits open instantly.
// Pages are network-first (cache only as offline fallback); live flight data (/api) is never cached.
const LIB = 'ft-lib-v3', TILES = 'ft-tiles-v1', PAGES = 'br-pages-v17', MAX_TILES = 4000;
const SHELL = ['./', 'map', '3d', 'globe', 'share', 'live', 'config.js', 'shared.js', 'shared-extra.js', 'eta.js', 'fir.json', 'app.css', 'airports.json', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png', 'icons/mark.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(LIB).then(c => c.addAll([
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
    'https://cdn.jsdelivr.net/npm/cesium@1.121.0/Build/Cesium/Cesium.js',
    'https://cdn.jsdelivr.net/npm/cesium@1.121.0/Build/Cesium/Widgets/widgets.css',
    'models/airliner.glb',
  ]).catch(() => {}).then(() => caches.open(PAGES)).then(c => c.addAll(SHELL)).catch(() => {})));
  self.skipWaiting();
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => ![LIB, TILES, PAGES].includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));

// libs (SRI-checked, crossorigin) keep only ok, non-opaque copies; map tiles (plain <img>) may be opaque
async function cacheFirst(req, name, trim) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type !== 'opaque' || trim && res.type === 'opaque') {
    c.put(req, res.clone());
    if (trim && Math.random() < 0.02) c.keys().then(k => k.slice(0, Math.max(0, k.length - MAX_TILES)).forEach(r => c.delete(r)));
  }
  return res;
}
async function networkFirst(req) {   // always try the network (bypassing the HTTP cache); cache is the offline fallback
  const c = await caches.open(PAGES);
  try { const res = await fetch(req, {cache: 'no-cache'}); if (res.ok) c.put(req, res.clone()); return res; }
  catch (e) { return (await c.match(req, {ignoreSearch: true})) || Response.error(); }
}

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/') || u.pathname.startsWith('/video/')) return;   // video uses range requests: let the browser handle it
  if (u.hostname === 'server.arcgisonline.com') return e.respondWith(cacheFirst(e.request, TILES, true));
  if (u.hostname === 'cdn.jsdelivr.net' || u.hostname === 'cdnjs.cloudflare.com' || u.pathname.startsWith('/models/'))
    return e.respondWith(cacheFirst(e.request, LIB));
  if (u.origin === location.origin) return e.respondWith(networkFirst(e.request));
});
