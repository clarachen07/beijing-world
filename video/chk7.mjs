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
// 隐藏除水/绿地外的一切，飞到什刹海上空渲染
const info = await page.evaluate(`(() => {
  const { scene, city, env } = window.__dbg;
  const { waterMat, greenMat } = city;
  let kept = 0, hidden = 0;
  scene.traverse((o) => {
    if (o.isMesh || o.isPoints) {
      const keep = o.material === waterMat || o.material === greenMat;
      o.visible = keep;
      keep ? kept++ : hidden++;
    }
  });
  // 水面白天亮度拉满便于观察
  env.nightT = 0;
  return { kept, hidden };
})()`);
console.log('layers', JSON.stringify(info));
await page.evaluate(`window.__bjw.renderPose([-1800, 900, 3200], [-1800, 0, 2200])`);
await page.screenshot({ path: 'chk7-water.png' });
// 统计水网格包围盒
const bb = await page.evaluate(`(() => {
  const { scene, city } = window.__dbg;
  const { waterMat } = city;
  let out = null;
  scene.traverse((o) => {
    if (o.isMesh && o.material === waterMat && !out) {
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      out = { min: b.min.toArray().map(v=>Math.round(v)), max: b.max.toArray().map(v=>Math.round(v)) };
    }
  });
  return out;
})()`);
console.log('water bbox', JSON.stringify(bb));
await browser.close();
process.exit(0);
