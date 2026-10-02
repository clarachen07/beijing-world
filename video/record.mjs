/**
 * 视频录制：Puppeteer + 本机 Chrome，加载 ?video=1 模式逐帧截屏
 * 输出 frames/*.jpg → encode.mjs 合成 MP4
 */
import { launch } from 'puppeteer-core';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { readFileSync, existsSync as fsExists } from 'node:fs';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const FRAME_DIR = path.join(ROOT, 'artifacts/video/frames');
const PORT = 4173;

const FPS = 30;
const SCALE = process.env.VIDEO_SCALE ? parseFloat(process.env.VIDEO_SCALE) : 1; // 分辨率缩放
const W = Math.round(1920 * SCALE), H = Math.round(1080 * SCALE);
const START = parseInt(process.env.VIDEO_START || '0', 10);
const END = process.env.VIDEO_END ? parseInt(process.env.VIDEO_END, 10) : Infinity;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.gz': 'application/gzip', '.mp4': 'video/mp4' };

// dist 静态服务器（带 gzip 透传）
function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        let url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (url === '/') url = '/index.html';
        let file = path.join(DIST, url);
        if (!fsExists(file)) { res.writeHead(404); res.end('nf'); return; }
        const data = readFileSync(file);
        const type = MIME[path.extname(file)] || 'application/octet-stream';
        const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
        res.writeHead(200, headers);
        res.end(req.method === 'HEAD' ? undefined : data);
      } catch (e) {
        res.writeHead(404);
        res.end('nf');
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function main() {
  if (!existsSync(path.join(DIST, 'index.html'))) {
    console.error('dist/ 不存在，请先 npm run build');
    process.exit(1);
  }
  await mkdir(FRAME_DIR, { recursive: true });
  const server = await serve();

  const launchOpts = {
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: [
      `--window-size=${W},${H}`,
      '--use-angle=metal',
      '--use-gl=angle',
      '--enable-gpu-rasterization',
      '--disable-lcd-text',
      '--hide-scrollbars',
      '--mute-audio',
    ],
    defaultViewport: { width: W, height: H },
  };
  let browser = await launch(launchOpts);
  let page = await browser.newPage();
  page.on('console', (m) => { const t = m.text(); if (t.includes('BJW')) console.log('  [page]', t); });
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message));

  await page.goto(`http://localhost:${PORT}/?video=1`, { waitUntil: 'networkidle0', timeout: 120000 });
  // 等待就绪
  await page.waitForFunction('!!window.__bjw', { timeout: 120000 });
  const meta = await page.evaluate('({ total: window.__bjw.totalFrames, fps: window.__bjw.fps })');
  const total = meta.total;
  console.log(`总帧数 ${total}（${(total / FPS).toFixed(1)}s @${FPS}fps）→ 输出 ${W}×${H}`);

  const lastIndexFile = path.join(FRAME_DIR, '.last');
  let from = START;
  if (existsSync(lastIndexFile) && !process.env.VIDEO_RESTART) {
    from = Math.max(from, parseInt(await (await import('node:fs/promises')).readFile(lastIndexFile, 'utf8'), 10) + 1);
    console.log(`↷ 从断点帧 ${from} 继续`);
  }
  const to = Math.min(total - 1, END);

  const t0 = Date.now();
  for (let i = from; i <= to; i++) {
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        await page.evaluate(`window.__bjw.seekFrame(${i})`);
        const file = path.join(FRAME_DIR, `f${String(i).padStart(5, '0')}.jpg`);
        await page.screenshot({ path: file, type: 'jpeg', quality: 92, optimizeForSpeed: true });
        ok = true;
      } catch (err) {
        console.log(`  ⚠ 帧 ${i} 截图失败 (attempt ${attempt + 1}): ${String(err.message).slice(0, 120)}`);
        if (attempt < 2) {
          // 浏览器可能已崩溃 → 重启页面
          try { await browser.close(); } catch { /* ignore */ }
          const b2 = await launch(launchOpts);
          page = await b2.newPage();
          page.on('pageerror', (e) => console.error('  [pageerror]', e.message.slice(0, 200)));
          await page.goto(`http://localhost:${PORT}/?video=1`, { waitUntil: 'networkidle0', timeout: 120000 });
          await page.waitForFunction('!!window.__bjw', { timeout: 120000 });
          await new Promise((r) => setTimeout(r, 1000));
        } else {
          throw err;
        }
      }
    }
    if (i % 15 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`  帧 ${i}/${to} (${((i / (to || 1)) * 100).toFixed(0)}%) ${el.toFixed(0)}s`);
      await writeFile(lastIndexFile, String(i));
    }
  }
  await writeFile(lastIndexFile, String(to));
  try { await browser.close(); } catch { /* ignore */ }
  server.close();
  console.log(`✓ 截帧完成 → ${FRAME_DIR}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
