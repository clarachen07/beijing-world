import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1400,800', '--use-angle=metal', '--use-gl=angle'],
  defaultViewport: { width: 1400, height: 800 },
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 400)); });
page.on('pageerror', (e) => console.error('[PAGEERROR]', e.message.slice(0, 300)));
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 120000, polling: 500 });
await new Promise((r) => setTimeout(r, 4000));
const info = await page.evaluate(`(() => {
  const { scene, THREE } = window.__dbg;
  let g = null;
  scene.traverse((o) => { if (o.isMesh && o.material && o.material.map) g = o; });
  if (!g) return 'no ground found';
  g.frustumCulled = false;
  g.material.color = new THREE.Color(0xff0000);
  g.material.polygonOffset = false;
  g.visible = true;
  return { visible: g.visible, matType: g.material.type, hasMap: !!g.material.map.image, mapSize: g.material.map.image ? [g.material.map.image.width, g.material.map.image.height] : null, pos: g.position.toArray(), matrixOk: !isNaN(g.matrix.elements[0]) };
})()`);
console.log('ground info:', JSON.stringify(info));
await page.evaluate(`window.__bjw.renderPose([-1700, 1500, -6800], [-1700, 0, -8400])`);
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'gh5.png' });
await browser.close();
process.exit(0);
