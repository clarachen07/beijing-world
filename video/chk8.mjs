import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1200,700', '--use-angle=metal', '--use-gl=angle'],
  defaultViewport: { width: 1200, height: 700 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[PAGEERROR]', e.message.slice(0, 300)));
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 60000, polling: 300 });
await new Promise((r) => setTimeout(r, 1500));
const info = await page.evaluate(`(() => {
  const { scene, city, THREE } = window.__dbg;
  const { waterMat, greenMat } = city;
  // 换成醒目的纯色 Basic 材质并禁用剔除
  const red = new THREE.MeshBasicMaterial({ color: 0xff2222, side: THREE.DoubleSide, wireframe: true });
  const greenM = new THREE.MeshBasicMaterial({ color: 0x22ff44, side: THREE.DoubleSide, wireframe: true });
  const report = [];
  scene.traverse((o) => {
    if ((o.isMesh || o.isPoints) && (o.material === waterMat || o.material === greenMat)) {
      o.material = o.material === waterMat ? red : greenM;
      o.frustumCulled = false;
      report.push({
        mat: o.material === red ? 'water' : 'green',
        verts: o.geometry.getAttribute('position').count,
        pos: o.position.toArray(),
        visible: o.visible,
        parentVisible: o.parent.visible,
      });
    }
  });
  // 其余全隐藏
  scene.traverse((o) => {
    if ((o.isMesh || o.isPoints) && o.material !== red && o.material !== greenM) o.visible = false;
  });
  return report;
})()`);
console.log('REPORT', JSON.stringify(info, null, 1));
await page.evaluate(`window.__bjw.renderPose([-1800, 1200, 3400], [-1700, 0, 2200])`);
await page.screenshot({ path: 'chk8-water.png' });
await browser.close();
process.exit(0);
