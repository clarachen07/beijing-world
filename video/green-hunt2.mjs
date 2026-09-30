import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1400,800', '--use-angle=metal', '--use-gl=angle'],
  defaultViewport: { width: 1400, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[PAGEERROR]', e.message.slice(0, 200)));
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 120000, polling: 500 });
await new Promise((r) => setTimeout(r, 3000));
// 预热一帧
await page.evaluate(`window.__bjw.renderPose([0, 2000, 0], [0, 0, -1000])`);
await new Promise((r) => setTimeout(r, 600));
const spots = [
  ['aosen', -1700, -8400],   // 奥森公园（原被裁剪区）
  ['jingshan', -700, 2900],  // 景山（原绿色大饼）
];
for (const [name, x, z] of spots) {
  await page.evaluate(`window.__bjw.renderPose([${x}, 750, ${z + 800}], [${x}, 0, ${z}])`);
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `ghunt2-${name}.png` });
  console.log('✓', name);
}
await browser.close();
process.exit(0);
