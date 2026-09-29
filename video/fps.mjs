import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1600,900', '--use-angle=metal', '--use-gl=angle'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 60000, polling: 300 });
await new Promise((r) => setTimeout(r, 3000));
const r = await page.evaluate(async () => {
  // 计数 rAF 5 秒
  let frames = 0;
  const t0 = performance.now();
  await new Promise((res) => {
    const loop = () => { frames++; if (performance.now() - t0 < 5000) requestAnimationFrame(loop); else res(); };
    requestAnimationFrame(loop);
  });
  const el = (performance.now() - t0) / 1000;
  const { renderer } = window.__dbg;
  const mem = renderer.info.memory;
  return { fps: (frames / el).toFixed(1), geometries: mem.geometries, textures: mem.textures };
});
console.log('FPS:', JSON.stringify(r));
await browser.close();
process.exit(0);
