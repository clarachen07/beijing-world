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
  const bjw = window.__bjw;
  bjw.seekFrame(Math.floor(bjw.totalFrames * 0.16));
  const afterSeek = camera.position.toArray().map(v => Math.round(v));
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  const afterRaf = camera.position.toArray().map(v => Math.round(v));
  return { afterSeek, afterRaf };
});
console.log(JSON.stringify(r));
await browser.close();
