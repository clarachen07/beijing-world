/** 开发调试截图：加载页面并抓取几个视角 */
import { launch } from 'puppeteer-core';

const URL = process.env.SHOT_URL || 'http://localhost:5173';
const OUT = process.env.SHOT_OUT || 'shot';

const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--window-size=1600,900', '--use-angle=metal', '--use-gl=angle', '--hide-scrollbars'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('console', (m) => { const t = m.text(); if (!t.includes('Download the React DevTools')) console.log('[page]', t.slice(0, 300)); });
page.on('pageerror', (e) => console.error('[pageerror]', e.message.slice(0, 500)));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('!!window.__bjw', { timeout: 90000, polling: 500 });
await new Promise((r) => setTimeout(r, 3000));

const VIEWS = [
  ['aerial', 0.02],     // 南城高空
  ['qianmen', 0.10],    // 前门/天安门
  ['gugong', 0.16],     // 故宫/景山
  ['shichahai', 0.23],  // 什刹海/钟鼓楼
  ['aoyuan', 0.42],     // 鸟巢水立方
  ['cbd', 0.62],        // 中国尊近景（入夜）
  ['skyline', 0.80],    // CBD 天际线夜景
  ['finale', 0.95],     // 全城收尾
];
for (const [name, t] of VIEWS) {
  await page.evaluate(`window.__bjw.seekFrame(Math.floor(window.__bjw.totalFrames * ${t}))`);
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: `view-${name}.png` });
  console.log(`✓ ${name}`);
}
await browser.close();
process.exit(0);
