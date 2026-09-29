/** 调试：加载页面，输出加载屏状态与所有错误 */
import { launch } from 'puppeteer-core';

const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--window-size=1600,900', '--use-angle=metal', '--use-gl=angle', '--hide-scrollbars'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('console', (m) => console.log(`[${m.type()}]`, m.text().slice(0, 400)));
page.on('pageerror', (e) => console.error('[PAGEERROR]', e.message.slice(0, 600)));
page.on('requestfailed', (r) => console.log('[REQFAIL]', r.url().slice(0, 120), r.failure()?.errorText));
page.on('requestfinished', (r) => { const u = r.url(); if (u.includes('data/')) console.log('[REQ OK]', u.split('/').slice(-2).join('/'), r.response()?.status()); });

await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, 15000));
const state = await page.evaluate(() => ({
  detail: document.getElementById('load-detail')?.textContent,
  bar: document.getElementById('load-bar')?.style.width,
  loadingDone: document.getElementById('loading')?.classList.contains('done'),
  hasBjw: !!window.__bjw,
  canvases: document.querySelectorAll('canvas').length,
}));
console.log('STATE:', JSON.stringify(state));
await page.screenshot({ path: 'shot-debug.png' });
await browser.close();
process.exit(0);
