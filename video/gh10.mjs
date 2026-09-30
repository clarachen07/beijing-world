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
const pose = `window.__bjw.renderPose([-1500, 260, 3050], [-1600, 0, 2300])`;
await page.evaluate(pose);
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'gh10-all.png' });
// 隐藏树实例
await page.evaluate(`(() => {
  const { scene } = window.__dbg;
  scene.traverse((o) => { if (o.isInstancedMesh) o.visible = false; });
})()`);
await page.evaluate(pose);
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'gh10-notrees.png' });
console.log('✓ done');
await browser.close();
process.exit(0);
