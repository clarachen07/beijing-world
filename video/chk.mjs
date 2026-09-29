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
await new Promise((r) => setTimeout(r, 800));
for (const [name, t] of [['gugong', 0.16], ['aoyuan', 0.42]]) {
  const info = await page.evaluate(`(() => {
    const bjw = window.__bjw;
    bjw.seekFrame(Math.floor(bjw.totalFrames * ${t}));
    const c = window.__dbg.camera;
    return { pos: c.position.toArray().map(v=>Math.round(v)), dir: new (window.__dbg.THREE.Vector3)().copy(c.getWorldDirection(new (window.__dbg.THREE.Vector3)())).toArray().map(v=>v.toFixed(2)) };
  })()`);
  console.log(name, JSON.stringify(info));
  await page.screenshot({ path: `chk-${name}.png` });
}
await browser.close();
process.exit(0);
