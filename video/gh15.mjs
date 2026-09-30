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
await page.screenshot({ path: 'gh15-0.png' });
// 隐藏绿+水+路灯+车流+树
await page.evaluate(`(() => {
  const { scene, city } = window.__dbg;
  scene.traverse((o) => {
    if (o.isMesh && (o.material === city.greenMat || o.material === city.waterMat)) o.visible = false;
    if (o.isInstancedMesh) o.visible = false;
    if (o.isPoints) o.visible = false;
  });
})()`);
await page.evaluate(pose); await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: 'gh15-1.png' });
console.log('✓ done');
await browser.close();
process.exit(0);
