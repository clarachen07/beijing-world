import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1400,800'],
});
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 120000, polling: 500 });
await new Promise((r) => setTimeout(r, 3000));
const pose = `window.__bjw.renderPose([-1500, 260, 3050], [-1600, 0, 2300])`;
await page.evaluate(pose); await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: 'gh17-a.png' });
const r1 = await page.evaluate(`(() => {
  const { scene } = window.__dbg;
  let n = 0;
  scene.traverse((o) => { if (o.isMesh && o.geometry.getAttribute('position').count === 4340) { o.visible = false; n++; } });
  return n;
})()`);
console.log('hidden ridge-trees:', r1);
await page.evaluate(pose); await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: 'gh17-b.png' });
const r2 = await page.evaluate(`(() => {
  const { scene } = window.__dbg;
  let n = 0;
  scene.traverse((o) => { if (o.isMesh && o.geometry.getAttribute('position').count === 2257) { o.visible = false; n++; } });
  return n;
})()`);
console.log('hidden hill:', r2);
await page.evaluate(pose); await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: 'gh17-c.png' });
await browser.close();
process.exit(0);
