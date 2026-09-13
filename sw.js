/* Food Diary service worker: a cache-first app shell and nothing else.
   It never touches diary data (that lives in localStorage) and never caches
   anything outside SHELL. Bump VERSION on every deploy, together with BUILD in
   index.html; the page then offers "Reload" and old caches get deleted. */
const PREFIX = 'food-diary-shell-';
const VERSION = 10;
const CACHE = PREFIX + VERSION;
const SHELL = ['./', 'index.html', 'logic.js', 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  // cache: 'reload' bypasses the HTTP cache so a deploy never precaches a stale file.
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

// Sent by the page when the parent taps Reload. Never skip waiting on our own:
// swapping the app mid-entry could lose what's being typed.
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Every app on this origin shares Cache Storage, so only our own old caches go.
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys
      .filter((k) => k.startsWith(PREFIX) && k !== CACHE)
      .map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then((c) =>
    (req.mode === 'navigate' ? c.match('index.html') : c.match(req, { ignoreSearch: true }))
      .then((hit) => hit || fetch(req))));
});
