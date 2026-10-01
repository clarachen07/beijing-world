import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1400,800'],
});
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 120000, polling: 500 });
await new Promise((r) => setTimeout(r, 2500));
const pos = () => page.evaluate(`window.__dbg.camera.position.toArray().map(v => Math.round(v))`);
// 干净点击标签 (按下+松开都在标签上) → flyTo
const label = await page.evaluate(`(() => {
  const el = [...document.querySelectorAll('.landmark-label')].find(e => e.querySelector('.name')?.textContent === '永定门');
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);
await page.mouse.move(label.x, label.y);
await page.mouse.down();
await page.mouse.up();          // click 触发 flyTo
console.log('已点击永定门');
await new Promise(r => setTimeout(r, 1200));
const mid = await pos();
console.log('飞行中(1.2s):', JSON.stringify(mid));
// 飞行中乱晃鼠标 (无按键)
await page.mouse.move(label.x + 300, label.y - 150, { steps: 10 });
await new Promise(r => setTimeout(r, 2600));
const land = await pos();
await page.screenshot({ path: 'gh26-land.png' });
// 落位后乱晃 + 拖拽一下再回到原位
await page.mouse.move(300, 300, { steps: 5 });
await page.mouse.move(1100, 500, { steps: 5 });
await new Promise(r => setTimeout(r, 1200));
const fin = await pos();
console.log('落位:', JSON.stringify(land));
console.log('落位后乱晃:', JSON.stringify(fin));
await browser.close();
process.exit(0);
