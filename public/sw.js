const CACHE = 'meow-ops-v3';
const STATIC = ['/', '/index.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Delete old cache versions on activate
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const requestUrl = new URL(e.request.url);
  const isPublicDemoData = requestUrl.origin === self.location.origin
    && /^\/data\/(?:demo-)?(?:sessions|cost-summary|superadmin-usage)\.json$/.test(requestUrl.pathname);
  // These fixtures are privacy-sensitive even though their contents are public.
  // Always fetch the active deployment's version and keep them out of CacheStorage.
  if (isPublicDemoData) return;
  const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(requestUrl.hostname);
  // A hosted shell can read private summaries from the optional loopback
  // helper. Keep those responses out of the hosted origin's CacheStorage.
  if (requestUrl.origin !== self.location.origin && isLoopback) return;
  if (e.request.method !== 'GET' || e.request.cache === 'no-store') return;
  if (e.request.url.includes('supabase.co')) return;
  // Network-first for HTML navigation (always get latest app shell)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
    return;
  }
  // Cache-first for static assets
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      const cacheControl = res.headers.get('Cache-Control') || '';
      if (!res.ok || cacheControl.split(',').some((value) => value.trim().toLowerCase() === 'no-store')) return res;
      const clone = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, clone));
      return res;
    }))
  );
});
