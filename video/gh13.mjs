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
// 逐步隐藏: 1) legacy GLB 组 2) landmark 程序化组 3) 建筑分块
const steps = [
  ['a-all', ''],
  ['b-nolegacy', `(() => { const { scene } = window.__dbg; scene.traverse((o) => { if (o.userData && o.userData.__legacy) o.visible = false; }); })()`],
];
await page.evaluate(pose); await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: 'gh13-a.png' });
// 隐藏所有 GLB (含 legacy) — legacy 对象没有标记, 改为按 userData 找不到 → 直接隐藏场景中除 city 外的 Group?
// 简化: 逐个隐藏已知对象
await page.evaluate(`(() => {
  const { scene, city } = window.__dbg;
  window.__groups = { scene };
  // 找到 city.group (含 ground) 与 landmark 组
  scene.traverse((o) => { if (o.isMesh && o.material && o.material.map) window.__groundMesh = o; });
})()`);
// 隐藏 legacy: GLB 模型的网格有 MeshStandardMaterial (非 Lambert flatShading)
await page.evaluate(`(() => {
  const { scene } = window.__dbg;
  scene.traverse((o) => { if (o.isMesh && o.material && o.material.isMeshStandardMaterial && !o.isInstancedMesh) o.visible = false; });
})()`);
await page.evaluate(pose); await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: 'gh13-b.png' });
await page.evaluate(`(() => {
  const { scene } = window.__dbg;
  // 恢复 GLB, 隐藏建筑分块 (Lambert + vertexColors + 无 map + 无 emissive)
  scene.traverse((o) => { if (o.isMesh && o.material && o.material.isMeshStandardMaterial && !o.isInstancedMesh) o.visible = true; });
  window.__chunks = [];
  scene.traverse((o) => { if (o.isMesh && o.material && o.material.isMeshLambertMaterial && o.material.vertexColors && !o.material.map) { window.__chunks.push(o); } });
  window.__chunks.forEach((o) => { if (o.geometry.getAttribute('position').count > 50000) o.visible = false; });
})()`);
await page.evaluate(pose); await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: 'gh13-c.png' });
console.log('✓ 3 shots');
await browser.close();
process.exit(0);
