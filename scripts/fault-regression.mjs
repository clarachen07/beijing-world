import {launch} from 'puppeteer-core';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const url=process.env.BJW_URL||'http://localhost:4173';await mkdir('artifacts/qa',{recursive:true});
const browser=await launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--use-gl=angle'],defaultViewport:{width:1280,height:800}});
const report={url,startedAt:new Date().toISOString(),checks:[]};
const manifest=JSON.parse(await readFile('dist/data/manifest.json','utf8'));
const bootMesh=Object.values(manifest.tiles.find(tile=>tile.id==='l2_x-1_z0').meshes)[0].file;
async function check(name,action){try{await action();report.checks.push({name,passed:true});console.log(`✓ ${name}`);}catch(error){report.checks.push({name,passed:false,error:error.message});}}
const ready=page=>page.waitForFunction(()=>window.__dbg&&document.getElementById('loading').classList.contains('done'),{timeout:45000});
try{
 await check('fatal manifest 404 offers a working retry',async()=>{
  const context=await browser.createBrowserContext(),page=await context.newPage();let broken=true;await page.setRequestInterception(true);
  page.on('request',request=>{if(broken&&request.url().endsWith('/data/manifest.json'))void request.respond({status:404,body:'missing'});else void request.continue();});
  await page.goto(url);await page.waitForFunction(()=>!document.getElementById('btn-retry-boot').hidden);broken=false;await page.click('#btn-retry-boot');await ready(page);assert.equal(await page.evaluate(()=>window.__dbg.controls.mode),'browse');await context.close();
 });
 await check('corrupt city download is rejected and a fresh boot retries it',async()=>{
  const context=await browser.createBrowserContext(),page=await context.newPage();let broken=true;await page.setRequestInterception(true);
  page.on('request',request=>{if(broken&&request.url().endsWith(bootMesh))void request.respond({status:200,body:'corrupt mesh'});else void request.continue();});
  await page.goto(url);await page.waitForFunction(()=>!document.getElementById('btn-retry-boot').hidden,{timeout:30000});
  assert.match(await page.$eval('#load-detail',node=>node.textContent),/完整性/);broken=false;await page.click('#btn-retry-boot');await ready(page);await context.close();
 });
 await check('hung response times out and boot retry remains usable',async()=>{
  const context=await browser.createBrowserContext(),page=await context.newPage();let hung=true;await page.setRequestInterception(true);
  page.on('request',request=>{if(!(hung&&request.url().endsWith(bootMesh)))void request.continue();});
  const start=Date.now();await page.goto(url);await page.waitForFunction(()=>!document.getElementById('btn-retry-boot').hidden,{timeout:30000});
  const elapsed=Date.now()-start;assert.ok(elapsed<25000&&elapsed>=10000);report.hangTimeoutMs=elapsed;
  hung=false;await page.click('#btn-retry-boot');await ready(page);await context.close();
 });
 await check('one failed landmark keeps the city usable and can be retried',async()=>{
  const context=await browser.createBrowserContext(),page=await context.newPage();let broken=true;await page.setRequestInterception(true);
  page.on('request',request=>{if(broken&&/\/cctv(?:[-.]|\/)/.test(request.url())&&request.url().endsWith('.glb'))void request.respond({status:404,body:'missing'});else void request.continue();});
  await page.goto(url);await ready(page);await page.waitForFunction(()=>window.__dbg.models.stats().failed>0,{timeout:45000});
  assert.equal(await page.evaluate(()=>document.getElementById('loading').classList.contains('done')),true);broken=false;await page.click('#btn-retry-assets');await page.waitForFunction(()=>window.__dbg.models.stats().failed===0,{timeout:45000});await context.close();
 });
 await check('cached scene boots offline and uses a versioned resource cache',async()=>{
  const context=await browser.createBrowserContext(),page=await context.newPage();await page.goto(url);await ready(page);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{timeout:30000});await page.reload();await ready(page);
  await page.waitForFunction(()=>window.__dbg.city.stats.pending===0&&window.__dbg.models.stats().pending===0,{timeout:45000});
  const cachesBefore=await page.evaluate(()=>caches.keys());assert.ok(cachesBefore.some(key=>key.startsWith('beijing-world-')));
  await page.setOfflineMode(true);await page.reload({waitUntil:'domcontentloaded'});await ready(page);
  assert.equal(await page.evaluate(()=>window.__dbg.controls.mode),'browse');report.offlineCacheNames=cachesBefore;await context.close();
 });
 const release=JSON.parse(await readFile('dist/release.json','utf8'));report.releaseRevision=release.revision;
 await check('worker activation removes a prior release cache',async()=>{
  const context=await browser.createBrowserContext(),page=await context.newPage();await page.goto(url);await ready(page);
  await page.evaluate(async()=>{const old=await caches.open('beijing-world-previous-release-fixture');await old.put(new URL('./models/outdated.glb',location.href),new Response('old model'));});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{timeout:30000});
  const keys=await page.evaluate(()=>caches.keys());assert.ok(!keys.includes('beijing-world-previous-release-fixture'));assert.ok(keys.includes(`beijing-world-${release.revision}`));
  report.activationCacheNames=keys;await context.close();
 });
}finally{report.completedAt=new Date().toISOString();report.passed=report.checks.every(check=>check.passed);await writeFile('artifacts/qa/fault-regression.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
if(!report.passed)process.exitCode=1;
