/* 北京世界 — Service Worker: 数据/模型本地缓存, 二次打开秒加载 */
const DATA_CACHE = 'bjw-data-v1';
const META_CACHE = 'bjw-meta-v1';

self.addEventListener('install', (e) => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== DATA_CACHE && k !== META_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const p = url.pathname;
  const isData = /\.bin\.gz$|\.glb$|\/ground\.jpg$|\/manifest\.json$/.test(p);
  const isShell = p.endsWith('/') || p.endsWith('index.html') || /\.js$|\.css$/.test(p);
  if (!isData && !isShell) return;

  // manifest 网络优先: 新版本(内容变化)时清空数据缓存, 保证更新可达
  if (p.endsWith('manifest.json')) {
    e.respondWith((async () => {
      const meta = await caches.open(META_CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) {
          const old = await meta.match(req);
          if (old && (await old.text()) !== (await res.clone().text())) {
            await caches.delete(DATA_CACHE);
          }
          meta.put(req, res.clone());
        }
        return res;
      } catch {
        return (await meta.match(req)) || Response.error();
      }
    })());
    return;
  }

  // 其余: 缓存优先
  e.respondWith((async () => {
    const cache = await caches.open(DATA_CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      return Response.error();
    }
  })());
});
