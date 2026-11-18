// Garde l'app (pas les données) en mémoire pour qu'elle s'ouvre vite, même avec un mauvais signal.
const V = 'gotham-v4';
const SHELL = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-180.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))); self.clients.claim(); });
// Réseau d'abord, sans la mémoire du navigateur (toujours la dernière version), le cache seulement si pas de réseau.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request.url, { cache: 'no-cache' }).then((r) => { const c = r.clone(); caches.open(V).then((ca) => ca.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});

// Notifications (nouvelle commande, message du dispatch) : affichées même si l'app est fermée.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { notification: { title: 'Gotham', body: e.data ? e.data.text() : '' } }; }
  const n = d.notification || {};
  const link = (d.fcmOptions && d.fcmOptions.link) || (d.data && d.data.link) || './';
  e.waitUntil(self.registration.showNotification(n.title || 'Gotham', {
    body: n.body || '', icon: n.icon || 'icon-192.png', badge: 'icon-192.png', tag: n.tag || undefined, renotify: !!n.tag, data: { link }, vibrate: [200, 100, 200]
  }).then(() => self.registration.getNotifications()).then((ns) => {
    // Petit chiffre rouge sur l'icône : nombre de notifications pas encore vues.
    if (self.navigator && self.navigator.setAppBadge) return self.navigator.setAppBadge(ns.length).catch(() => {});
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if (c.url.indexOf('/livreurs/') >= 0 && 'focus' in c) return c.focus(); }
    return self.clients.openWindow(link);
  }));
});
