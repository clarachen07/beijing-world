/** 天空渲染实验：定位黑天空 */
import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--window-size=1200,700', '--use-angle=metal', '--use-gl=angle'],
  defaultViewport: { width: 1200, height: 700 },
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.error('[PAGEERROR]', e.message.slice(0, 400)));
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 60000, polling: 300 });
await new Promise((r) => setTimeout(r, 1200));

// 实验 A：当前状态（漫游初始帧）
await page.screenshot({ path: 'skyA-current.png' });

// 实验 B：把天空材质换成纯红 → 天空区域应变红
await page.evaluate(`(() => {
  const { scene, env, camera } = window.__dbg;
  const THREE = window.__dbg.THREE;
  env.sky.material = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.BackSide, depthWrite: false });
})()`);
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: 'skyB-red.png' });

// 实验 C：移除天空
await page.evaluate(`(() => {
  const { scene, env } = window.__dbg;
  scene.remove(env.sky);
})()`);
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: 'skyC-nosky.png' });

// 相机与场景信息
const info = await page.evaluate(() => {
  const { camera, scene, env } = window.__dbg;
  return {
    camPos: camera.position.toArray().map((v) => v.toFixed(0)),
    nightT: env.nightT,
    uNight: env.sky.material.uniforms ? env.sky.material.uniforms.uNight?.value : 'removed',
    objects: scene.children.length,
  };
});
console.log('INFO', JSON.stringify(info));
await browser.close();
process.exit(0);
