import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1400,800'],
});
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 120000, polling: 500 });
await new Promise((r) => setTimeout(r, 3000));
const info = await page.evaluate(`(() => {
  const { scene } = window.__dbg;
  const out = [];
  scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const g = o.geometry;
    const type = g.type;
    const p = o.position;
    // 景山/故宫区域 (z 2000..3100, x -2600..-900)
    if (p.z > 1800 && p.z < 3300 && p.x > -2800 && p.x < -800) {
      out.push({ name: o.name || '(noname)', type, isInst: !!o.isInstancedMesh, count: o.count || g.getAttribute('position').count, pos: [p.x, p.y, p.z].map(v => Math.round(v)), parent: o.parent && o.parent.type });
    }
  });
  return out;
})()`);
console.log(JSON.stringify(info, null, 1));
await browser.close();
process.exit(0);
