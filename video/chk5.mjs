import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=800,500'],
});
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 60000, polling: 300 });
const r = await page.evaluate(`(() => {
  const bjw = window.__bjw;
  bjw.seekFrame(Math.floor(bjw.totalFrames * 0.42));
  const els = [...document.querySelectorAll('.landmark-label')];
  return els.map(el => ({
    name: el.querySelector('.name')?.textContent,
    hidden: el.classList.contains('hidden'),
    opacity: el.style.opacity,
  }));
})()`);
console.log(JSON.stringify(r, null, 1));
await browser.close();
