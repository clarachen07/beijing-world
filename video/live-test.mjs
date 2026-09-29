import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1600,900', '--use-angle=metal', '--use-gl=angle'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[PAGEERROR]', e.message.slice(0, 300)));
await page.goto('https://clarachen07.github.io/beijing-world/', { waitUntil: 'networkidle0', timeout: 120000 });
await page.waitForFunction('!!window.__dbg', { timeout: 120000, polling: 500 });
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: 'live-day.png' });
console.log('✓ live day view');
await page.evaluate(`window.__bjw.seekFrame(Math.floor(window.__bjw.totalFrames * 0.8))`);
await new Promise((r) => setTimeout(r, 1000));
await page.screenshot({ path: 'live-night.png' });
console.log('✓ live night view');
// 视频按钮是否出现
const btn = await page.evaluate(`document.getElementById('btn-video').style.display`);
console.log('video button display:', btn);
await browser.close();
process.exit(0);
