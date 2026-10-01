/* 北京世界 — Service Worker v6
 * 策略: 页面外壳(html/js/css)和 manifest 永远网络优先(保证更新可达);
 *       大体量数据(.bin.gz/.glb/ground.jpg)缓存优先 + manifest 变化时整体失效。
 * 缓存名带版本: 部署新版本时旧缓存全部清除。 */
const SHELL_CACHE = 'bjw-shell-v6';
const DATA_CACHE = 'bjw-data-v6';
const META_CACHE = 'bjw-meta-v6';
const ALL = [SHELL_CACHE, DATA_CACHE, META_CACHE];

self.addEventListener('install', (e) => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !ALL.includes(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const p = url.pathname;
  const isData = /\.bin\.gz$|\.glb$|\/ground\.jpg$/.test(p);
  const isManifest = p.endsWith('manifest.json');
  const isShell = p.endsWith('/') || p.endsWith('index.html') || /\.js$|\.css$/.test(p);
  if (!isData && !isManifest && !isShell) return;

  // manifest: 网络优先, 内容变化时清空数据缓存(数据/格式随版本演进)
  if (isManifest) {
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

  // 外壳: 网络优先 (失败才回退缓存) —— 保证代码更新即时可达
  if (isShell) {
    e.respondWith((async () => {
      const shell = await caches.open(SHELL_CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) shell.put(req, res.clone());
        return res;
      } catch {
        const hit = await shell.match(req);
        return hit || Response.error();
      }
    })());
    return;
  }

  // 数据/模型: 缓存优先 (大文件, 重复访问秒开); manifest 变化时已被上层清空
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
