/** Real Chrome input regression. Use BJW_URL for a stable production preview. */
import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launch } from 'puppeteer-core';

const baseURL = process.env.BJW_URL ?? 'http://localhost:5173';
const output = resolve('artifacts/qa');
const sleep = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));
const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.reduce((sum, value, index) => sum + value * b[index], 0))));
const report = { startedAt: new Date().toISOString(), baseURL, browser: '', profiles: [], limitations: ['Mobile uses real Chrome touch events on an emulated viewport; it does not measure a physical phone GPU.'] };
const profiles = [
  { name: 'desktop', viewport: { width: 1440, height: 900, deviceScaleFactor: 1 } },
  { name: 'mobile', viewport: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
].filter(profile => !process.env.BJW_PROFILE || process.env.BJW_PROFILE === profile.name);

async function chromePath() {
  for (const candidate of [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean)) {
    try { await access(candidate); return candidate; } catch { /* Try the next installed browser. */ }
  }
  throw new Error('Chrome was not found. Set CHROME_PATH to an installed Chrome executable.');
}

async function snapshot(page) {
  return page.evaluate(() => {
    const { camera, controls } = window.__dbg;
    return { position: camera.position.toArray(), rotation: camera.quaternion.toArray(), target: controls.orbit.target.toArray(), mode: controls.mode, flying: controls.flying, tourT: controls.tourT, finished: controls.tourFinished };
  });
}
async function clearCanvasPoint(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById('scene');
    for (const [x, y] of [[.5,.48],[.3,.4],[.7,.4],[.3,.6],[.7,.6],[.5,.3]]) {
      const point = { x: Math.round(innerWidth*x), y: Math.round(innerHeight*y) };
      if (document.elementFromPoint(point.x,point.y) === canvas) return point;
    }
    throw new Error('No clear canvas input point was found');
  });
}
async function drag(page, button, dx, dy) {
  const point = await clearCanvasPoint(page);
  await page.mouse.move(point.x,point.y); await page.mouse.down({button});
  await page.mouse.move(point.x+dx,point.y+dy,{steps:8}); await page.mouse.up({button});
  await sleep(80);
}
async function touch(client, type, points) {
  await client.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id,x,y]) => ({id,x,y,radiusX:4,radiusY:4,force:1})) });
  await sleep(25);
}
async function takeoverProbe(page, kind) {
  await page.evaluate(kind => {
    const read = () => {
      const {camera,controls,collision}=window.__dbg;
      return {position:camera.position.toArray(),rotation:camera.quaternion.toArray(),mode:controls.mode,flying:controls.flying,groundM:collision.heightAt(camera.position.x,camera.position.z)};
    };
    window.__navigationProbe = {};
    const event = kind === 'pointer' ? 'pointerdown' : 'keydown';
    const before = () => { window.__navigationProbe.before = read(); };
    const after = () => { window.__navigationProbe.after = read(); };
    window.addEventListener(event,before,{capture:true,once:true});
    (kind === 'pointer' ? document.getElementById('scene') : window).addEventListener(event,after,{capture:kind === 'pointer',once:true});
  },kind);
  if (kind === 'pointer') {
    const point = await clearCanvasPoint(page); await page.mouse.move(point.x,point.y); await page.mouse.down(); await page.mouse.up();
  } else { await page.keyboard.down('w'); await page.keyboard.up('w'); }
  const probe = await page.evaluate(() => window.__navigationProbe);
  assert.ok(probe.before && probe.after,'Both sides of the input event must be observed');
  assert.ok(distance(probe.before.position,probe.after.position)<1e-8,'Taking control must preserve the current camera position');
  assert.ok(angle(probe.before.rotation,probe.after.rotation)<1e-7,'Taking control must preserve the current camera orientation');
  return probe;
}

async function mobileTestPageSmoke(browser) {
  const url = new URL('qa.html', process.env.BJW_LAN_URL ?? baseURL).href;
  const result = { url, profile:'browser_emulation', checks:[], pageErrors:[], passed:false };
  const page = await browser.newPage(); await page.setViewport(profiles.find(profile=>profile.name==='mobile')?.viewport ?? {width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true});
  page.on('pageerror',error=>result.pageErrors.push(error.message));
  const check = async (name,action) => {
    const started=Date.now();
    try { const detail=await action(); result.checks.push({name,passed:true,durationMs:Date.now()-started,detail}); }
    catch(error) { result.checks.push({name,passed:false,durationMs:Date.now()-started,error:error.message}); }
    const outcome=result.checks.at(-1); process.stdout.write(`mobile-test-page: ${name}: ${outcome.passed?'PASS':`FAIL: ${outcome.error}`}\n`);
  };
  const tap = async selector => { const element=await page.$(selector); assert.ok(element,selector); await element.scrollIntoView(); await element.tap(); await element.dispose(); };
  try {
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30_000});
    await page.waitForFunction(()=>!document.getElementById('start').disabled,{timeout:Number(process.env.BJW_READY_TIMEOUT_MS ?? 120_000)});
    const initial=await page.evaluate(()=>{const app=document.getElementById('world').contentWindow; return {position:app.__dbg.camera.position.toArray(),rotation:app.__dbg.camera.quaternion.toArray()};});
    await page.select('#execution','browser_emulation');
    for(const [selector,value] of [['#device-model','Chrome mobile viewport 390×844 on desktop host; simulated'],['#os','Host desktop operating system; no physical phone'],['#browser',report.browser],['#network','Local preview from desktop; no public Internet assertion']]) await page.type(selector,value);
    await page.select('#access-path','local_network');
    await check('start focuses the scene and advances the real tour',async()=>{
      await tap('#start');
      await page.waitForFunction(()=>{const frame=document.getElementById('world');return document.activeElement===frame && frame.contentWindow.document.hasFocus() && frame.contentWindow.__dbg.controls.mode==='tour';},{timeout:5000});
      await page.waitForFunction(()=>document.getElementById('world').contentWindow.__dbg.controls.tourT>0.005,{timeout:10_000});
      return page.evaluate(()=>{const frame=document.getElementById('world');return {iframeFocused:document.activeElement===frame,sceneFocused:frame.contentWindow.document.hasFocus(),tourT:frame.contentWindow.__dbg.controls.tourT};});
    });
    await check('stopping exports an honest incomplete run and observed version',async()=>{
      await tap('#panel summary'); await tap('#stop');
      await page.evaluate(()=>document.getElementById('download').addEventListener('click',event=>event.preventDefault(),{once:true}));
      await tap('#download');
      const exported=await page.$eval('#download',async anchor=>JSON.parse(await (await fetch(anchor.href)).text()));
      await writeFile(resolve(output,'mobile-test-page-smoke.json'),`${JSON.stringify(exported,null,2)}\n`);
      const run=exported.runs.at(-1); assert.ok(run); assert.equal(run.status,'stopped'); assert.equal(run.endReason,'user_stop'); assert.equal(run.protocolValid,false);
      assert.ok(run.elapsedMs<180_000); assert.equal(run.p95MeetsConfirmedMobileThreshold,null); assert.equal(exported.context.execution,'browser_emulation');
      assert.ok(exported.version?.city?.revision); assert.ok(exported.version?.bundleURL); assert.equal(exported.version?.release?.status,'read');
      assert.deepEqual(exported.errors,[]); assert.equal(exported.manualChecks.every(check=>!check.tested && check.result==='not_tested'),true);
      result.environment=exported.device; result.version=exported.version;
      const parsed=new URL(url), nonSecureLAN=parsed.protocol==='http:' && !['localhost','127.0.0.1','[::1]'].includes(parsed.hostname);
      if(nonSecureLAN) { assert.equal(exported.device.secureContext,false); assert.equal(exported.device.serviceWorkerAvailable,false); assert.notEqual(exported.device.sceneServiceWorkerControlled,true); }
      return {status:run.status,elapsedMs:run.elapsedMs,protocolValid:run.protocolValid,secureContext:exported.device.secureContext,serviceWorkerControlled:exported.device.sceneServiceWorkerControlled,cityRevision:exported.version.city.revision};
    });
    await check('manual walk reaches the main product button and prepares a safe landing',async()=>{
      await page.evaluate(initial=>{
        const app=document.getElementById('world').contentWindow,button=app.document.querySelector('#mode-seg [data-mode="walk"]');
        window.__qaWalkClicks=0; button.addEventListener('click',()=>window.__qaWalkClicks++);
        app.__dbg.camera.position.fromArray(initial.position);app.__dbg.camera.quaternion.fromArray(initial.rotation);app.__dbg.controls.adoptPose();
      },initial);
      await tap('[data-mode="walk"]');
      await page.waitForFunction(()=>{const app=document.getElementById('world').contentWindow;return app.__dbg.controls.mode==='walk' && !app.__dbg.controls.flying;},{timeout:45_000});
      const state=await page.evaluate(()=>{
        const app=document.getElementById('world').contentWindow,{camera,controls,collision}=app.__dbg;
        return {mainProductClicks:window.__qaWalkClicks,mode:controls.mode,heightAboveGroundM:camera.position.y-collision.heightAt(camera.position.x,camera.position.z),frameFocused:app.document.hasFocus(),wrapperStatus:document.getElementById('action-status').textContent};
      });
      assert.equal(state.mainProductClicks,1);assert.equal(state.mode,'walk');assert.ok(Math.abs(state.heightAboveGroundM-1.7)<1e-5);assert.equal(state.frameFocused,true);
      return {...state,setup:'Returned to the observed initial camera before requesting walk through the test-page product button.'};
    });
    await page.screenshot({path:resolve(output,'mobile-test-page-smoke.png')});
    assert.deepEqual(result.pageErrors,[]);
  } catch(error) {result.checks.push({name:'test-page setup or teardown',passed:false,error:error.message});}
  finally {await page.close();result.passed=result.checks.length===3 && result.checks.every(check=>check.passed);}
  return result;
}

await mkdir(output,{recursive:true});
const browser = await launch({executablePath:await chromePath(),headless:true,args:['--enable-webgl','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
try {
  report.browser = await browser.version();
  for (const profile of profiles) {
    const result = { profile:profile.name, viewport:profile.viewport, checks:[], pageErrors:[], consoleErrors:[], failedRequests:[], assetErrors:[], navigations:[] };
    report.profiles.push(result);
    const page = await browser.newPage(); await page.setViewport(profile.viewport);
    page.on('framenavigated',frame=>{if(frame===page.mainFrame()) result.navigations.push(frame.url());});
    page.on('pageerror',error=>result.pageErrors.push(error.message));
    page.on('console',message=>{if(message.type()==='error') result.consoleErrors.push(message.text());});
    page.on('requestfailed',request=>{const error=request.failure()?.errorText; if(error!=='net::ERR_ABORTED') result.failedRequests.push({url:request.url(),error});});
    page.on('response',response=>{if(response.status()>=400) result.assetErrors.push({url:response.url(),status:response.status()});});
    const check = async (name,action) => {
      const started = Date.now();
      try { const detail = await action(); result.checks.push({name,passed:true,durationMs:Date.now()-started,...(detail ? {detail} : {})}); }
      catch(error) {
        result.checks.push({name,passed:false,durationMs:Date.now()-started,error:error.message});
        await page.screenshot({path:resolve(output,`${profile.name}-${name.replace(/[^a-z0-9]+/gi,'-')}-failed.png`)}).catch(()=>{});
      }
      const outcome = result.checks.at(-1);
      process.stdout.write(`${profile.name}: ${name}: ${outcome.passed ? 'PASS' : `FAIL: ${outcome.error}`}\n`);
    };
    try {
      await check('boot and default browse',async()=>{
        await page.goto(baseURL,{waitUntil:'domcontentloaded',timeout:30_000});
        await page.waitForFunction(()=>window.__dbg && document.getElementById('loading').classList.contains('done') || !document.getElementById('btn-retry-boot').hidden,{timeout:Number(process.env.BJW_READY_TIMEOUT_MS ?? 120_000)});
        assert.ok(await page.evaluate(()=>window.__dbg && document.getElementById('loading').classList.contains('done')),await page.$eval('#load-detail',element=>element.textContent));
        const initial = await snapshot(page); assert.equal(initial.mode,'browse');
        assert.equal(await page.$eval('[data-mode="browse"]',button=>button.getAttribute('aria-pressed')),'true');
        result.initial = initial;
        result.build = await page.evaluate(() => ({ cityRevision: window.__dbg.city.manifest.revision, scripts: [...document.scripts].map(script=>script.src).filter(Boolean) }));
        await page.waitForFunction(()=>Number.parseFloat(getComputedStyle(document.getElementById('loading')).opacity)<0.01,{timeout:3000});
        await page.screenshot({path:resolve(output,`${profile.name}-overview.png`)});
        return {position:initial.position};
      });
      if (!result.initial) continue;

      if (profile.name === 'desktop') {
        await check('left drag pans without rotating',async()=>{
          const before=await snapshot(page); await drag(page,'left',70,24); const after=await snapshot(page);
          assert.ok(distance(before.position,after.position)>1); assert.ok(angle(before.rotation,after.rotation)<1e-7);
          return {movementM:distance(before.position,after.position)};
        });
        await check('right drag rotates',async()=>{
          const before=await snapshot(page); await drag(page,'right',75,25); const after=await snapshot(page);
          assert.ok(angle(before.rotation,after.rotation)>.01); return {rotationRadians:angle(before.rotation,after.rotation)};
        });
        await check('wheel zoom keeps its target',async()=>{
          const before=await snapshot(page), point=await clearCanvasPoint(page); await page.mouse.move(point.x,point.y); await page.mouse.wheel({deltaY:-180}); await sleep(100);
          const after=await snapshot(page); assert.ok(distance(before.position,before.target)>distance(after.position,after.target)); assert.ok(distance(before.target,after.target)<1e-7);
          return {beforeM:distance(before.position,before.target),afterM:distance(after.position,after.target)};
        });
      } else {
        const client = await page.createCDPSession();
        await check('single touch pans without rotating',async()=>{
          const before=await snapshot(page), point=await clearCanvasPoint(page);
          await touch(client,'touchStart',[[0,point.x,point.y]]);
          for(let i=1;i<=6;i++) await touch(client,'touchMove',[[0,point.x+i*7,point.y+i*3]]);
          await touch(client,'touchEnd',[]); const after=await snapshot(page);
          assert.ok(distance(before.position,after.position)>1); assert.ok(angle(before.rotation,after.rotation)<1e-7);
          return {movementM:distance(before.position,after.position)};
        });
        await check('two touches zoom and rotate',async()=>{
          const before=await snapshot(page), point=await clearCanvasPoint(page);
          await touch(client,'touchStart',[[0,point.x-35,point.y],[1,point.x+35,point.y]]);
          for(let i=1;i<=6;i++) await touch(client,'touchMove',[[0,point.x-35-i*2,point.y+i*3],[1,point.x+35+i*6,point.y+i*3]]);
          await touch(client,'touchEnd',[]); const after=await snapshot(page);
          assert.ok(distance(before.position,before.target)>distance(after.position,after.target)); assert.ok(angle(before.rotation,after.rotation)>.01);
          return {beforeM:distance(before.position,before.target),afterM:distance(after.position,after.target),rotationRadians:angle(before.rotation,after.rotation)};
        });
        await client.detach();
      }
      await check('continuous landmarks and pointer takeover',async()=>{
        const ids=await page.$$eval('#landmark-picker option',options=>options.map(option=>option.value).filter(Boolean).slice(0,3)); assert.equal(ids.length,3);
        for(const id of ids) {await page.select('#landmark-picker',id); await sleep(75);}
        assert.equal((await snapshot(page)).flying,true);
        const probe=await takeoverProbe(page,'pointer'); assert.equal((await snapshot(page)).flying,false); return probe;
      });
      await check('tour keyboard takeover',async()=>{
        await page.click('[data-mode="tour"]'); await sleep(140);
        const probe=await takeoverProbe(page,'keyboard'); assert.equal((await snapshot(page)).mode,'fly');
        assert.equal(await page.$eval('[data-mode="fly"]',button=>button.getAttribute('aria-pressed')),'true'); return probe;
      });
      await check('walk preparation freezes moving views and respects later requests',async()=>{
        const ids=await page.$$eval('#landmark-picker option',options=>options.map(option=>option.value).filter(Boolean));
        const details=[];
        for (const source of ['landmark','tour']) {
          if (source === 'landmark') await page.select('#landmark-picker',ids[1]);
          else await page.click('[data-mode="tour"]');
          await sleep(140); assert.equal((await snapshot(page)).flying,true);
          await page.evaluate(()=>{
            const city=window.__dbg.city, original=city.ensureNear;
            const read=()=>({position:window.__dbg.camera.position.toArray(),rotation:window.__dbg.camera.quaternion.toArray(),mode:window.__dbg.controls.mode,flying:window.__dbg.controls.flying});
            let release; const gate=new Promise(resolve=>{release=resolve;});
            const probe={before:null,after:null,settled:false,release,restore:()=>{city.ensureNear=original;}};
            window.__walkPreparation=probe;
            // Hold completion after the real nearby load to exercise an outstanding mode request.
            city.ensureNear=async position=>{try {await original.call(city,position);await gate;}finally {probe.settled=true;}};
            window.addEventListener('click',()=>{probe.before=read();},{capture:true,once:true});
            document.querySelector('[data-mode="walk"]').addEventListener('click',()=>{probe.after=read();},{once:true});
          });
          try {
            await page.click('[data-mode="walk"]');
            const probe=await page.evaluate(()=>({before:window.__walkPreparation.before,after:window.__walkPreparation.after}));
            assert.ok(probe.before && probe.after); assert.equal(probe.after.flying,false,'Walking must stop the preceding camera motion before waiting for nearby data');
            assert.ok(distance(probe.before.position,probe.after.position)<1e-8); assert.ok(angle(probe.before.rotation,probe.after.rotation)<1e-7);
            await sleep(100); assert.ok(distance(probe.after.position,(await snapshot(page)).position)<1e-7,'The old camera transition must remain frozen during loading');
            if(source==='landmark') await page.select('#landmark-picker',ids[2]);
            else await page.click('[data-mode="fly"]');
            const expected=source==='landmark' ? 'browse' : 'fly';
            await page.evaluate(()=>window.__walkPreparation.release());
            await page.waitForFunction(()=>window.__walkPreparation.settled,{timeout:45_000}); await sleep(200);
            assert.equal((await snapshot(page)).mode,expected,'Completing an obsolete walk request must not override a later landmark or mode');
            details.push({source,...probe,latestMode:expected});
          } finally {
            await page.evaluate(()=>{window.__walkPreparation.release();window.__walkPreparation.restore();}).catch(()=>{});
          }
        }
        return details;
      });
      await check('rapid mode requests retain the latest intent',async()=>{
        await page.evaluate(initial=>{
          window.__dbg.camera.position.fromArray(initial.position); window.__dbg.camera.quaternion.fromArray(initial.rotation); window.__dbg.controls.setMode('browse');
        },result.initial);
        for(const mode of ['tour','browse','fly','tour','walk','fly']) await page.click(`[data-mode="${mode}"]`);
        await page.waitForFunction(()=>window.__dbg?.city?.stats.pending===0,{timeout:45_000}); await sleep(250);
        assert.equal((await snapshot(page)).mode,'fly'); assert.equal(await page.$eval('[data-mode="fly"]',button=>button.getAttribute('aria-pressed')),'true');
      });
      await check('street descent allows takeover without dropping',async()=>{
        await page.click('[data-mode="walk"]');
        await page.waitForFunction(()=>window.__dbg?.controls.mode==='walk' && window.__dbg.controls.flying,{timeout:45_000});
        const probe=await takeoverProbe(page,'keyboard');
        assert.equal(probe.before.mode,'walk'); assert.equal(probe.before.flying,true);
        assert.ok(probe.before.groundM!==null,'The descending camera must have a loaded landing reference before input');
        assert.ok(probe.before.position[1]-probe.before.groundM>10,'The takeover fixture must begin above the landing');
        assert.equal(probe.after.mode,'fly'); assert.equal(probe.after.flying,false);
        assert.equal((await snapshot(page)).mode,'fly');
        // High-altitude fly correctly releases nearby collision tiles on the next
        // frame. Preserve the ground reference observed before the same input event.
        assert.ok(probe.after.position[1]-probe.before.groundM>10,'Manual takeover must retain the altitude above the landing');
        return probe;
      });
      await check('loaded safe street landing',async()=>{
        await page.click('[data-mode="walk"]');
        await page.waitForFunction(()=>window.__dbg?.controls.mode==='walk' && !window.__dbg.controls.flying || document.getElementById('status-text')?.textContent.includes('尚无可步行'),{timeout:45_000});
        const state=await snapshot(page); assert.equal(state.mode,'walk');
        const ground=await page.evaluate(()=>window.__dbg.collision.heightAt(window.__dbg.camera.position.x,window.__dbg.camera.position.z));
        assert.ok(Math.abs(state.position[1]-ground-1.7)<1e-5); return {position:state.position,groundM:ground};
      });
      await check('blur clears held keys pointers and momentum',async()=>{
        await page.click('[data-mode="fly"]'); await page.keyboard.down('w'); await sleep(250);
        await page.evaluate(()=>window.dispatchEvent(new Event('blur'))); const stopped=await snapshot(page); await sleep(200);
        assert.ok(distance(stopped.position,(await snapshot(page)).position)<1e-8);
        await page.evaluate(()=>window.dispatchEvent(new Event('focus'))); await sleep(200);
        assert.ok(distance(stopped.position,(await snapshot(page)).position)<1e-8); await page.keyboard.up('w');
        await page.click('[data-mode="browse"]'); const point=await clearCanvasPoint(page);
        await page.mouse.move(point.x,point.y); await page.mouse.down(); await page.mouse.move(point.x+30,point.y);
        await page.evaluate(()=>{window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));});
        const released=await snapshot(page); await page.mouse.move(point.x+75,point.y); await sleep(100);
        assert.ok(distance(released.position,(await snapshot(page)).position)<1e-8,'Returning focus must not retain an abandoned drag');
        await page.mouse.up();
      });
      await check('visibility clears held keys',async()=>{
        await page.keyboard.down('w'); await sleep(150); const other=await browser.newPage();
        try {
          await other.bringToFront(); await page.waitForFunction(()=>document.hidden,{timeout:5000});
          const stopped=await snapshot(page); await sleep(150); await page.bringToFront(); await sleep(200);
          assert.ok(distance(stopped.position,(await snapshot(page)).position)<1e-8);
        } finally {await other.close(); await page.keyboard.up('w');}
      });
      await check('tour end holds and explicit replay returns smoothly',async()=>{
        await page.click('[data-mode="tour"]'); await page.waitForFunction(()=>window.__dbg && !window.__dbg.controls.flying,{timeout:5000});
        await page.evaluate(()=>{window.__dbg.controls.tourT=.999999;}); await page.waitForFunction(()=>window.__dbg?.controls.tourFinished,{timeout:3000});
        const end=await snapshot(page); await sleep(200); assert.ok(distance(end.position,(await snapshot(page)).position)<1e-8);
        await page.click('#btn-replay'); const replay=await snapshot(page); assert.equal(replay.flying,true); assert.ok(replay.tourT===0); assert.ok(distance(end.position,replay.position)<50);
        await page.click('[data-mode="browse"]'); return {endPosition:end.position,initialReplayMovementM:distance(end.position,replay.position)};
      });
      await check('capture resume keeps the externally placed pose',async()=>{
        await page.click('[data-mode="fly"]');
        let resumedCapture = false;
        try {
          await page.evaluate(async()=>{
            const {camera,THREE}=window.__dbg, position=camera.position.clone().add(new THREE.Vector3(5,0,0));
            const look=camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(1000).add(position);
            await window.__bjw.renderPose(position.toArray(),look.toArray(),0);
          });
          const captured=await snapshot(page); await page.evaluate(()=>window.__bjw.resume()); resumedCapture = true; await sleep(200);
          const resumed=await snapshot(page); assert.equal(resumed.mode,'browse');
          assert.ok(distance(captured.position,resumed.position)<1e-7); assert.ok(angle(captured.rotation,resumed.rotation)<1e-7);
          return {movementM:distance(captured.position,resumed.position),rotationRadians:angle(captured.rotation,resumed.rotation)};
        } finally {
          if (!resumedCapture) await page.evaluate(()=>window.__bjw?.resume()).catch(()=>{});
        }
      });
      await check('WebGL context recovers without camera drift',async()=>{
        await page.click('[data-mode="fly"]'); await page.keyboard.down('w'); await sleep(150);
        await page.evaluate(()=>{
          const canvas=document.getElementById('scene'); window.__contextProbe={lost:0,restored:0};
          canvas.addEventListener('webglcontextlost',()=>window.__contextProbe.lost++,{once:true});
          canvas.addEventListener('webglcontextrestored',()=>window.__contextProbe.restored++,{once:true});
          window.__contextExtension=window.__dbg.renderer.getContext().getExtension('WEBGL_lose_context');
          if(!window.__contextExtension) throw new Error('WEBGL_lose_context extension unavailable'); window.__contextExtension.loseContext();
        });
        await page.waitForFunction(()=>window.__contextProbe.lost===1,{timeout:5000}); await page.keyboard.up('w');
        const stopped=await snapshot(page); await sleep(400); await page.evaluate(()=>window.__contextExtension.restoreContext());
        await page.waitForFunction(()=>window.__contextProbe.restored===1,{timeout:10_000}); await sleep(400);
        assert.ok(distance(stopped.position,(await snapshot(page)).position)<1e-8);
        assert.ok(await page.evaluate(()=>window.__dbg.renderer.info.render.calls>0));
        await page.screenshot({path:resolve(output,`${profile.name}-restored.png`)});
      });
      await check('no uncaught runtime errors or unexpected reloads',async()=>{assert.deepEqual(result.pageErrors,[]); assert.equal(result.navigations.length,1,'Run final regression against a stable build without HMR reloads');});
      result.metrics=await page.evaluate(()=>window.__bjw.metrics());
    } finally { await page.close(); }
  }
  if(!process.env.BJW_PROFILE || process.env.BJW_PROFILE==='mobile') report.mobileTestPage=await mobileTestPageSmoke(browser);
} finally {
  await browser.close(); report.completedAt=new Date().toISOString(); report.passed=report.profiles.length>0 && report.profiles.every(profile=>profile.checks.length>0 && profile.checks.every(check=>check.passed)) && (!report.mobileTestPage || report.mobileTestPage.passed);
  await writeFile(resolve(output,'browser-regression.json'),`${JSON.stringify(report,null,2)}\n`);
}
if(!report.passed) process.exitCode=1;
