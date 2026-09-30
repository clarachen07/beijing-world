import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1400,800', '--use-angle=metal', '--use-gl=angle'],
  defaultViewport: { width: 1400, height: 800 },
});
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 120000, polling: 500 });
await new Promise((r) => setTimeout(r, 3000));
await page.evaluate(`window.__bjw.renderPose([0, 2000, 0], [0, 0, -1000])`);
await new Promise((r) => setTimeout(r, 500));
// 隐藏地面
await page.evaluate(`(() => {
  const { scene } = window.__dbg;
  scene.traverse((o) => { if (o.isMesh && o.material && o.material.map) o.visible = false; });
})()`);
await page.evaluate(`window.__bjw.renderPose([-1700, 750, -7600], [-1700, 0, -8400])`);
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'gh3-noground.png' });
console.log('✓ no-ground view');
await browser.close();
process.exit(0);
