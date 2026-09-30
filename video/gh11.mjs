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
await page.screenshot({ path: 'gh11-a.png' });
// 隐藏景山组（landmarks 组里 name 匹配）
await page.evaluate(`(() => {
  const { scene } = window.__dbg;
  let hidden = 0;
  scene.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.index && o.geometry.getAttribute('position').count === 3723) { o.visible = false; hidden++; }
  });
  return hidden;
})()`);
await page.evaluate(pose);
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'gh11-b.png' });
console.log('✓ done');
await browser.close();
process.exit(0);
