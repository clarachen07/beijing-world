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
await new Promise((r) => setTimeout(r, 2500));
// [x, alt, z] 俯视各区域
const spots = [
  ['aosen', -1200, -8600],    // 奥森公园
  ['jingshan', -700, 3050],   // 景山
  ['tiantan', -950, 5950],    // 天坛
  ['shichahai', -1700, 2600], // 什刹海
  ['cbd', 3700, 3300],        // 国贸
];
for (const [name, x, z] of spots) {
  await page.evaluate(`window.__bjw.renderPose([${x}, 900, ${z + 900}], [${x}, 0, ${z}])`);
  await page.screenshot({ path: `ghunt-${name}.png` });
  console.log('✓', name);
}
await browser.close();
process.exit(0);
