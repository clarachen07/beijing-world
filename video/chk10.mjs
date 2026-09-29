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
// 太和殿特写: 相机放太和殿南偏西
await page.evaluate(`window.__bjw.renderPose([-160, 90, 640], [-90, 25, 420])`);
await page.screenshot({ path: 'v2-taihedian.png' });
console.log('✓ taihedian');
// 故宫全景 (北望神武门方向)
await page.evaluate(`window.__bjw.renderPose([-700, 380, 5050], [-100, 30, 3500])`);
await page.screenshot({ path: 'v2-gugong.png' });
console.log('✓ gugong');
await browser.close();
process.exit(0);
