/* Cache de l'interface uniquement : les données passent toujours par le réseau. */
// Changer ce numéro à chaque publication (le même que APP_VERSION dans app.js) :
// c'est ce qui fait détecter la nouvelle version par les appareils.
const CACHE = 'notre-planning-v43';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'store.js', 'import.js', 'config.js', 'icon.svg', 'apple-touch-icon.png', 'manifest.webmanifest'];

self.addEventListener('install', event => {
  // no-cache : ne pas reprendre une copie périmée du cache HTTP du navigateur.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'no-cache' })))));
  self.skipWaiting();
});
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
// Réseau d'abord (pour toujours avoir la dernière version), cache en secours hors-ligne.
// no-cache : le navigateur revérifie chaque fichier auprès du serveur (réponse 304 légère
// s'il n'a pas changé) au lieu de garder une copie jusqu'à 10 min (réglage de GitHub Pages).
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const fresh = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache' }) : fetch(req, { cache: 'no-cache' });
  event.respondWith(
    fresh
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('index.html')))
  );
});

// Notifications envoyées par la tâche GitHub Actions (notifier/notify.js) : { title, body, tag, url }.
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Notre Planning', {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: data.tag,
    data: { url: data.url || './' },
  }));
});

// Toucher une notification ouvre l'app (ou la ramène au premier plan).
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(w => 'focus' in w);
    if (open) return open.focus();
    return self.clients.openWindow(event.notification.data?.url || './');
  })());
});
