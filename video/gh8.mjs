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
await page.evaluate(`window.__bjw.renderPose([-1700, 2100, -300], [-1700, 0, 5600])`);
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'gh8-with.png' });
// 隐藏绿地 + 水面
await page.evaluate(`(() => {
  const { scene, city } = window.__dbg;
  scene.traverse((o) => {
    if (o.isMesh && (o.material === city.greenMat || o.material === city.waterMat)) o.visible = false;
  });
})()`);
await page.evaluate(`window.__bjw.renderPose([-1700, 2100, -300], [-1700, 0, 5600])`);
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'gh8-without.png' });
console.log('✓ two shots');
await browser.close();
process.exit(0);
