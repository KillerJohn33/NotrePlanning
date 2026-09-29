/* Cache de l'interface uniquement : les données passent toujours par le réseau. */
const CACHE = 'notre-planning-v4';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'store.js', 'import.js', 'config.js', 'icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
// Réseau d'abord (pour toujours avoir la dernière version), cache en secours hors-ligne.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('index.html')))
  );
});
