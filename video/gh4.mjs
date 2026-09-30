import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1400,800', '--use-angle=metal', '--use-gl=angle'],
  defaultViewport: { width: 1400, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[PAGEERROR]', e.message.slice(0, 200)));
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 120000, polling: 500 });
await new Promise((r) => setTimeout(r, 4000));
const info = await page.evaluate(`(() => {
  const { scene, city, THREE } = window.__dbg;
  // 找到带 map 的地面
  let found = [];
  scene.traverse((o) => {
    if (o.isMesh && o.material) {
      if (o.material.map) { o.material.color = new THREE.Color(0xff0000); found.push('textured-ground ' + o.geometry.type); }
      else if (o.material.color && o.material.color.getHex() === 0x8f8577) { o.material.color = new THREE.Color(0x0000ff); found.push('outer-ground'); }
    }
  });
  return found;
})()`);
console.log('tinted:', JSON.stringify(info));
await page.evaluate(`window.__bjw.renderPose([-1700, 1500, -6800], [-1700, 0, -8400])`);
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'gh4-tint.png' });
await browser.close();
process.exit(0);
