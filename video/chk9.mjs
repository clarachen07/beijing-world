// 手动起一个与 record.mjs 相同的静态服务器测试 dist
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { launch } from 'puppeteer-core';
const DIST = path.join(process.cwd(), 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.gz': 'application/gzip', '.mp4': 'video/mp4' };
const server = createServer((req, res) => {
  let url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/') url = '/index.html';
  let file = path.join(DIST, url);
  if (!existsSync(file)) file = path.join(DIST, 'index.html');
  const data = readFileSync(file);
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Encoding': path.extname(file) === '.gz' ? 'gzip' : undefined });
  res.end(data);
});
await new Promise((r) => server.listen(4173, r));
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1280,720', '--use-angle=metal', '--use-gl=angle'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log(`[${m.type()}]`, m.text().slice(0, 300)));
page.on('pageerror', (e) => console.error('[PAGEERROR]', e.message.slice(0, 400)));
page.on('requestfailed', (r2) => console.log('[REQFAIL]', r2.url().slice(-60), r2.failure()?.errorText));
await page.goto('http://localhost:4173/?video=1', { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 8000));
const st = await page.evaluate(() => ({
  detail: document.getElementById('load-detail')?.textContent,
  hasBjw: !!window.__bjw,
}));
console.log('STATE', JSON.stringify(st));
await browser.close();
server.close();
process.exit(0);
