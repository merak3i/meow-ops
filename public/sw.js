const CACHE = 'meow-ops-v1';
const STATIC = ['/', '/index.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('supabase.co')) return;
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request))
  );
});
