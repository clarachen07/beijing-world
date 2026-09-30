import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1400,800', '--use-angle=metal', '--use-gl=angle'],
  defaultViewport: { width: 1400, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[PAGEERROR]', e.message.slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') console.log('[ERR]', m.text().slice(0, 200)); });
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 120000, polling: 500 });
await new Promise((r) => setTimeout(r, 3000));
// 检查绿/水网格状态
const info = await page.evaluate(`(() => {
  const { scene, city } = window.__dbg;
  let green = null, water = null;
  scene.traverse((o) => {
    if (o.isMesh && o.material === city.greenMat) green = { vis: o.visible, verts: o.geometry.getAttribute('position').count, bb: !!o.geometry.boundingBox };
    if (o.isMesh && o.material === city.waterMat) water = { vis: o.visible, verts: o.geometry.getAttribute('position').count };
  });
  return { green, water, greenVertColor: city.greenMat.vertexColors, uNight: city.greenMat.onBeforeCompile ? 'yes' : 'no' };
})()`);
console.log(JSON.stringify(info));
await page.evaluate(`window.__bjw.renderPose([-1500, 260, 3050], [-1600, 0, 2300])`);
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'gh9-shichahai.png' });
await browser.close();
process.exit(0);
