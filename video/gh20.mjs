import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--window-size=1400,800'],
});
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__dbg', { timeout: 120000, polling: 500 });
await new Promise((r) => setTimeout(r, 3000));
await page.evaluate(`window.__bjw.seekFrame(63)`);
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: 'gh20-a.png' });
await page.evaluate(`(() => {
  const { scene } = window.__dbg;
  scene.traverse((o) => { if (o.isInstancedMesh) o.visible = false; });
})()`);
await page.evaluate(`window.__bjw.seekFrame(63)`);
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: 'gh20-b.png' });
console.log('✓ done');
await browser.close();
process.exit(0);
