import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1200,700', '--use-angle=metal', '--use-gl=angle'],
  defaultViewport: { width: 1200, height: 700 },
});
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 60000, polling: 300 });
await new Promise((r) => setTimeout(r, 1500));
const r = await page.evaluate(`(async () => {
  const bjw = window.__bjw;
  bjw.seekFrame(Math.floor(bjw.totalFrames * 0.42));
  const ydm = [...document.querySelectorAll('.landmark-label')].find(el => el.querySelector('.name')?.textContent === '永定门');
  const stateAfterSeek = { hidden: ydm.classList.contains('hidden'), display: getComputedStyle(ydm).display, opacity: getComputedStyle(ydm).opacity };
  await new Promise((res) => setTimeout(res, 500));
  const stateBeforeShot = { hidden: ydm.classList.contains('hidden'), opacity: getComputedStyle(ydm).opacity };
  return { stateAfterSeek, stateBeforeShot };
})()`);
console.log(JSON.stringify(r, null, 1));
await page.screenshot({ path: 'chk6.png' });
await browser.close();
