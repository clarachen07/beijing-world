import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=800,500'],
});
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 60000, polling: 300 });
const r = await page.evaluate(async () => {
  const { camera } = window.__dbg;
  const out = [];
  const bjw = window.__bjw;
  for (const t of [0.0, 0.1, 0.2, 0.3, 0.42, 0.6, 0.8]) {
    bjw.seekFrame(Math.floor(bjw.totalFrames * t));
    out.push({ t, pos: camera.position.toArray().map(v => Math.round(v)) });
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
