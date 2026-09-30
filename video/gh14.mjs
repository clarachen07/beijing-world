import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1400,800'],
});
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 120000, polling: 500 });
await new Promise((r) => setTimeout(r, 3000));
const pose = `window.__bjw.renderPose([-1500, 260, 3050], [-1600, 0, 2300])`;
await page.evaluate(pose); await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: 'gh14-a.png' });
const info = await page.evaluate(`(() => {
  const { scene } = window.__dbg;
  const report = [];
  // 找景山组: 遍历 landmark 程序化组（含 hill Lambert 非 vertexColors 的 mesh）
  scene.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && o.material && o.material.color) {
      const c = o.material.color.getHex();
      if (c === 0x54683b || c === 0x33532a) {
        report.push({ color: c.toString(16), verts: o.geometry.getAttribute('position').count, pos: o.position.toArray().map(v=>Math.round(v)), parentPos: o.parent ? o.parent.position.toArray().map(v=>Math.round(v)) : null, world: o.getWorldPosition(new (window.__dbg.THREE.Vector3)()).toArray().map(v=>Math.round(v)) });
        o.visible = false;
      }
    }
  });
  return report;
})()`);
console.log('hidden:', JSON.stringify(info));
await page.evaluate(pose); await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: 'gh14-b.png' });
await browser.close();
process.exit(0);
