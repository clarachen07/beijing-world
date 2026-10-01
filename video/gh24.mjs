import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1400,800'],
});
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 120000, polling: 500 });
await new Promise((r) => setTimeout(r, 2500));
// 点击故宫标签
const clicked = await page.evaluate(`(() => {
  const el = [...document.querySelectorAll('.landmark-label')].find(e => e.querySelector('.name')?.textContent === '故宫');
  if (!el) return 'no label';
  el.click();
  return 'clicked';
})()`);
console.log(clicked);
await new Promise((r) => setTimeout(r, 3400)); // 飞行 2.6s + 余量
const posA = await page.evaluate(`window.__dbg.camera.position.toArray().map(v => Math.round(v))`);
await page.screenshot({ path: 'gh24-a.png' });
await new Promise((r) => setTimeout(r, 2200)); // 越过原本会弹回的帧
const posB = await page.evaluate(`window.__dbg.camera.position.toArray().map(v => Math.round(v))`);
await page.screenshot({ path: 'gh24-b.png' });
console.log('落位 A:', JSON.stringify(posA));
console.log('2.2s后 B:', JSON.stringify(posB));
console.log(posA.join() === posB.join() ? '✓ 无弹回, 相机稳定' : '✗✗ 仍然弹回!');
await browser.close();
process.exit(0);
