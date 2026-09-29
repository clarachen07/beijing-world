import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1600,900', '--use-angle=metal', '--use-gl=angle'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[PAGEERROR]', e.message.slice(0, 300)));
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 120000, polling: 500 });
await new Promise((r) => setTimeout(r, 2500));
// 太和殿特写 (殿位于 -1640, 3520; 相机在其南面 500m)
await page.evaluate(`window.__bjw.renderPose([-1640, 110, 4050], [-1640, 30, 3400])`);
await page.screenshot({ path: 'v2-taihedian.png' });
console.log('✓ taihedian');
await browser.close();
process.exit(0);
