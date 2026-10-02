/* Generated release ID includes code, data and models; no cross-release stale assets. */
const VERSION = 'f379c023976b7b0f93a8';
const CACHE = `beijing-world-${VERSION}`;
const SHELL = ["./","./index.html","./assets/decode.worker-CxzzSVa6.js","./assets/index-CUnMNSRK.css","./assets/index-kvYwi1c0.js","./assets/sha2-0dmcoPFZ.js","./assets/three-BgMGqtJM.js"];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('beijing-world-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'invalidate-asset') return;
  const url = new URL(event.data.url);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(caches.open(CACHE).then(cache=>cache.delete(url.href)));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  // Videos remain normal streaming responses; never duplicate large ranges in CacheStorage.
  if (url.pathname.endsWith('.mp4') || event.request.headers.has('range')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE), cached = await cache.match(event.request);
    const navigation = event.request.mode === 'navigate' || /(?:manifest|resources)\.json$/.test(url.pathname);
    if (cached && !navigation) return cached;
    try {
      const response = await fetch(event.request, {signal:AbortSignal.timeout(12000)});
      if (response.ok && response.type !== 'opaque') await cache.put(event.request,response.clone()).catch(() => {});
      if (!response.ok && cached) return cached;
      return response;
    } catch (error) {
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        const shell = await cache.match(new URL('./index.html',self.registration.scope)); if (shell) return shell;
      }
      throw error;
    }
  })());
});
