import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=800,500'],
});
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 120000, polling: 500 });
await new Promise((r) => setTimeout(r, 3000));
// 列出 scene 顶层子对象
const kids = await page.evaluate(`(() => {
  const { scene } = window.__dbg;
  return scene.children.map((o, i) => ({ i, type: o.type, name: o.name || '(noname)', isGroup: o.isGroup, meshes: (() => { let n = 0; o.traverse((c) => { if (c.isMesh) n++; }); return n; })() }));
})()`);
console.log('scene children:', JSON.stringify(kids));
// 逐个隐藏并检测"绿色锥体"像素: 采样故宫区域屏幕块的绿色占比
const detect = `(() => {
  const canvas = document.getElementById('scene');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  // 用 2D 方式: drawImage 到 2D canvas 读像素
  const c2 = document.createElement('canvas');
  c2.width = canvas.width; c2.height = canvas.height;
  const ctx = c2.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  // 故宫区域在屏幕中下部
  const x0 = Math.floor(c2.width * 0.35), x1 = Math.floor(c2.width * 0.62);
  const y0 = Math.floor(c2.height * 0.55), y1 = Math.floor(c2.height * 0.9);
  let green = 0, n = 0;
  for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) {
    const d = ctx.getImageData(x, y, 1, 1).data;
    if (d[1] > d[0] + 15 && d[1] > d[2] + 15) green++;
    n++;
  }
  return green / n;
})()`;
await page.evaluate(`window.__bjw.renderPose([-1500, 260, 3050], [-1600, 0, 2300])`);
await new Promise(r => setTimeout(r, 400));
const base = await page.evaluate(detect);
console.log('基准绿色占比:', base.toFixed(3));
for (const k of kids) {
  if (!k.isGroup && k.meshes === 0) continue;
  await page.evaluate(`(() => { const { scene } = window.__dbg; scene.children[${k.i}].visible = false; })()`);
  await page.evaluate(`window.__bjw.renderPose([-1500, 260, 3050], [-1600, 0, 2300])`);
  await new Promise(r => setTimeout(r, 350));
  const frac = await page.evaluate(detect);
  console.log(`隐藏 child[${k.i}] (${k.name}, ${k.meshes} meshes): 绿色占比 = ${frac.toFixed(3)} ${frac < base * 0.5 ? '<<< 元凶!' : ''}`);
  await page.evaluate(`(() => { const { scene } = window.__dbg; scene.children[${k.i}].visible = true; })()`);
}
await browser.close();
process.exit(0);
