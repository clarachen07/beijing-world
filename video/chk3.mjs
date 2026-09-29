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
await new Promise((r) => setTimeout(r, 1200));
const r = await page.evaluate(`(() => {
  const { scene, camera, THREE } = window.__dbg;
  const bjw = window.__bjw;
  bjw.seekFrame(Math.floor(bjw.totalFrames * 0.16));
  // 标记方块: 红=永定门(x-1025,z8312) 绿=故宫(x-100,z-1700) 蓝=中国尊(x120,z-3800)
  const mk = (color, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(300, 600, 300), new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, 300, z);
    scene.add(m);
  };
  mk(0xff0000, -1025, 8312);
  mk(0x00ff00, -100, -1700);
  mk(0x0000ff, 120, -3800);
  const c = camera.position.toArray().map(v=>Math.round(v));
  const d = camera.getWorldDirection(new THREE.Vector3()).toArray().map(v=>v.toFixed(2));
  return { pos: c, dir: d };
})()`);
console.log('CAM', JSON.stringify(r));
await new Promise((r2) => setTimeout(r2, 500));
await page.screenshot({ path: 'chk3.png' });
await browser.close();
process.exit(0);
