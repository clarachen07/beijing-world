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
// 用 CanvasTexture: 北半红南半蓝（canvas 顶部=红, v=1=顶部行）
await page.evaluate(`(() => {
  const { scene, THREE } = window.__dbg;
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 64, 32);   // canvas 顶部半=红
  ctx.fillStyle = '#0000ff'; ctx.fillRect(0, 32, 64, 32);  // canvas 底部半=蓝
  const tex = new THREE.CanvasTexture(cv);
  scene.traverse((o) => { if (o.isMesh && o.material && o.material.map) { o.material.map = tex; o.material.needsUpdate = true; } });
})()`);
await page.evaluate(`window.__bjw.renderPose([-1700, 2200, 600], [-1700, 0, 500])`);
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'gh7-flip.png' });
await browser.close();
process.exit(0);
