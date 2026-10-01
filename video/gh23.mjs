import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1400,800'],
});
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 120000, polling: 500 });
await new Promise((r) => setTimeout(r, 3000));
// 等漫游进入一个稳定段, 记录拖前画面
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: 'gh23-pre.png' });
// 活体拖拽: 向右拖 150px (不 renderPose, 实时循环渲染)
await page.mouse.move(700, 400);
await page.mouse.down();
await page.mouse.move(850, 430, { steps: 8 });
await page.mouse.up();
await new Promise(r => setTimeout(r, 600));
await page.screenshot({ path: 'gh23-post.png' });
const st = await page.evaluate(`(() => {
  const { camera } = window.__dbg;
  return { pos: camera.position.toArray().map(v=>Math.round(v)), yawDebug: 'n/a' };
})()`);
console.log('camera:', JSON.stringify(st));
await browser.close();
process.exit(0);
