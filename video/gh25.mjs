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
// 复刻用户操作: 按下在画布(标签旁), 拖到标签上, 松开在标签 → 触发点击+卡住dragging
const label = await page.evaluate(`(() => {
  const el = [...document.querySelectorAll('.landmark-label')].find(e => e.querySelector('.name')?.textContent === '永定门');
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);
console.log('天坛标签 @', JSON.stringify(label));
await page.mouse.move(label.x - 120, label.y + 60);   // 画布上按下
await page.mouse.down();
await page.mouse.move(label.x, label.y, { steps: 6 }); // 拖到标签上
await page.mouse.up();                                  // 松开在标签 → click 触发 flyTo
console.log('已点击天坛, 飞行开始');
await new Promise(r => setTimeout(r, 1200));
const mid = await pos();
console.log('飞行中(1.2s):', JSON.stringify(mid));
// 飞行中随意移动鼠标(无按键) — 不应打断飞行
await page.mouse.move(label.x + 200, label.y - 100, { steps: 8 });
await new Promise(r => setTimeout(r, 2600)); // 飞完 + 余量
const land = await pos();
await page.screenshot({ path: 'gh25-land.png' });
// 再乱晃鼠标 + 点击别处移动, 确认稳定
await page.mouse.move(200, 200, { steps: 5 });
await page.mouse.move(1100, 600, { steps: 5 });
await new Promise(r => setTimeout(r, 1500));
const final = await pos();
await page.screenshot({ path: 'gh25-final.png' });
console.log('落位:', JSON.stringify(land));
console.log('乱晃后:', JSON.stringify(final));
console.log(land.join() === final.join() ? '✓ 完全稳定' : '✗ 仍有跳动');
await browser.close();
process.exit(0);
