import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1400,800'],
});
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 120000, polling: 500 });
await new Promise((r) => setTimeout(r, 3000));
// 世界坐标包围盒枚举: 找到锥体区域 (x -2400..-1000, z 2000..3100, y 0..80) 内的所有网格
const info = await page.evaluate(`(() => {
  const { scene, THREE } = window.__dbg;
  const out = [];
  scene.traverse((o) => {
    if (!o.isMesh && !o.isPoints) return;
    o.updateWorldMatrix(true, false);
    const wp = new THREE.Vector3();
    o.getWorldPosition(wp);
    if (wp.x > -2600 && wp.x < -800 && wp.z > 1800 && wp.z < 3300 && wp.y < 100) {
      const bs = o.geometry.boundingSphere || (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere);
      out.push({ name: (o.name || '(noname)').slice(0, 30), type: o.isInstancedMesh ? 'inst' : (o.isPoints ? 'pts' : 'mesh'), wp: [wp.x, wp.y, wp.z].map(v => Math.round(v)), bsR: Math.round(bs.radius), visible: o.visible, mat: o.material.type, vcolor: !!o.material.vertexColors, count: o.count || o.geometry.getAttribute('position').count });
    }
  });
  return out;
})()`);
console.log(JSON.stringify(info, null, 1));
await browser.close();
process.exit(0);
