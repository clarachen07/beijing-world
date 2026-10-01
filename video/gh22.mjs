import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1400,800'],
});
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 120000, polling: 500 });
await new Promise((r) => setTimeout(r, 3000));
// 老城低空掠过: 检查填充建筑是否立体
await page.evaluate(`window.__bjw.renderPose([-2300, 90, 4600], [-2200, 0, 4200])`);
await new Promise(r => setTimeout(r, 600));
await page.screenshot({ path: 'gh22-infill.png' });
// 拖拽方向验证: 模拟向右拖 100px, 截图比较画面移动
await page.evaluate(`window.__bjw.renderPose([-1500, 260, 3050], [-1600, 0, 2300])`);
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: 'gh22-drag0.png' });
// 通过 controls 内部状态验证: 模拟 pointer 事件
await page.mouse.move(700, 400);
await page.mouse.down();
await page.mouse.move(800, 400, { steps: 5 });
await page.mouse.up();
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: 'gh22-drag1.png' });
console.log('✓ done');
await browser.close();
process.exit(0);
