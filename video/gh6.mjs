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
await page.evaluate(`(() => {
  const { scene, THREE } = window.__dbg;
  const mk = (color, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(400, 1200, 400), new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, 600, z);
    scene.add(m);
  };
  mk(0xff0000, -1700, -8000);  // 红 = 奥森
  mk(0x0000ff, -950, 5950);    // 蓝 = 天坛
})()`);
await page.evaluate(`window.__bjw.renderPose([-1700, 750, -7600], [-1700, 0, -8400])`);
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'gh6-calib.png' });
await browser.close();
process.exit(0);
