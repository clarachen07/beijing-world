import { launch } from 'puppeteer-core';
const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
const r = await page.evaluate(async () => {
  const out = {};
  const buf = await (await fetch('./data/b/b00.bin.gz')).arrayBuffer();
  // v1: 手动 reader 循环
  try {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([buf]).stream().pipeThrough(ds);
    const reader = stream.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    out.v1 = 'ok ' + total;
  } catch (e) { out.v1 = 'ERR ' + e.message; }
  // v2: Response(buffer) 直接 body 管道
  try {
    const ds2 = new DecompressionStream('gzip');
    const stream2 = new Response(buf).body.pipeThrough(ds2);
    const raw = await new Response(stream2).arrayBuffer();
    out.v2 = 'ok ' + raw.byteLength;
  } catch (e) { out.v2 = 'ERR ' + e.message; }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
process.exit(0);
