import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1400,800'],
});
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 120000, polling: 500 });
await new Promise((r) => setTimeout(r, 2500));
const label = await page.evaluate(`(() => {
  const el = [...document.querySelectorAll('.landmark-label')].find(e => e.querySelector('.name')?.textContent === '永定门');
  const r = el.getBoundingClientRect();
  const st = getComputedStyle(el);
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), pe: st.pointerEvents, op: st.opacity, topEl: (() => { const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return t ? t.className || t.tagName : 'none'; })() };
})()`);
console.log('标签状态:', JSON.stringify(label));
await page.mouse.move(label.x, label.y);
await page.mouse.down();
await page.mouse.up();
await new Promise(r => setTimeout(r, 300));
const dbg = await page.evaluate(`window.__dbg.controls.debug`);
console.log('调试:', JSON.stringify(dbg));
const mode = await page.evaluate(`window.__dbg.controls.mode`);
console.log('mode:', mode);
await browser.close();
process.exit(0);
