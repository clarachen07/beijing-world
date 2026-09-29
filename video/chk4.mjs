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
// 先放标记：绿=鼓楼(x-1680,z800) 紫=鸟巢(x-1180,z-4900)
await page.evaluate(`(() => {
  const { scene, THREE } = window.__dbg;
  const mk = (color, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(300, 800, 300), new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, 400, z);
    scene.add(m);
  };
  mk(0x00ff00, -1680, 800);
  mk(0xff00ff, -1180, -4900);
})()`);
await page.evaluate('window.__bjw.seekFrame(Math.floor(window.__bjw.totalFrames * 0.42))');
const info = await page.evaluate(`(() => {
  const c = window.__dbg.camera;
  return { pos: c.position.toArray().map(v=>Math.round(v)) };
})()`);
console.log('CAM', JSON.stringify(info));
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'chk4.png' });
await browser.close();
process.exit(0);
