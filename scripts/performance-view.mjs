import assert from 'node:assert/strict';
import {launch} from 'puppeteer-core';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export function performancePose(def,origin) {
  const x=(def.lon-origin.lon)*111320*Math.cos(origin.lat*Math.PI/180),z=(origin.lat-def.lat)*111132;
  const height=def.heightM||30,elev=def.elevationM||0;
  if(def.model==='cctv')return {pos:[x-650,elev+350,z+100],look:[x,elev+height*.55,z],view:'west'};
  const distance=Math.max(150,Math.min(1400,def.focus*.65));
  return {pos:[x+distance*.65,elev+Math.max(100,height+distance*.55),z+distance*.85],look:[x,elev+height*.4,z]};
}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const retained=report=>Object.fromEntries(Object.entries(report).filter(([key])=>!['views','viewSupplements'].includes(key)));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/** Only replace the requested view; preserve the complete original protocol. */
export async function runSingleView({base,registry,origin}) {
  const key=process.env.BJW_VIEW_ONLY,def=registry.landmarks.find(entry=>entry.id===key||entry.model===key);
  assert.ok(def,`Unknown view ${key}`);
  const profiles=process.env.BJW_PROFILE==='both'?['desktop','mobile']:[process.env.BJW_PROFILE||'desktop'];
  assert.ok(profiles.every(profile=>['desktop','mobile'].includes(profile)));
  const previewOnly=process.env.BJW_VIEW_PREVIEW==='1',output='artifacts/qa',pose=performancePose(def,origin);
  await mkdir(output,{recursive:true});
  const summaries=[];
  const browser=await launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--use-gl=angle','--enable-gpu-rasterization']});
  try{
   for(const profile of profiles){
    const mobile=profile==='mobile',path=`${output}/performance-${profile}.json`;
    const original=JSON.parse(await readFile(path,'utf8'));
    const index=original.views.findIndex(view=>view.id===def.id);
    assert.ok(index>=0,`${profile} has no existing view ${def.id}`);
    const unchanged=digest(retained(original)),otherViews=digest(original.views.filter((_,i)=>i!==index));
    const previousView=original.views[index],errors=[];
    const page=await browser.newPage();
    await page.setViewport(mobile?{width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true}:{width:1440,height:900,deviceScaleFactor:1});
    page.on('pageerror',error=>errors.push(error.message));
    const client=await page.createCDPSession();
    await client.send('Network.enable');await client.send('Network.setCacheDisabled',{cacheDisabled:true});await client.send('Network.setBypassServiceWorker',{bypass:true});
    await page.evaluateOnNewDocument(()=>{window.__qaLongTasks=[];new PerformanceObserver(list=>window.__qaLongTasks.push(...list.getEntries().map(entry=>({start:entry.startTime,duration:entry.duration})))).observe({entryTypes:['longtask']});});
    try{
     await page.goto(base,{waitUntil:'domcontentloaded',timeout:60000});
     await page.waitForFunction(()=>!!window.__bjw&&Number(getComputedStyle(document.getElementById('loading')).opacity)<.01,{timeout:60000});
     const release=await page.evaluate(async()=>await (await fetch('./release.json',{cache:'no-store'})).json());
     const identity=await page.evaluate(()=>({city:window.__dbg.city.manifest.revision,bundle:[...document.scripts].find(script=>script.type==='module')?.src,devicePixelRatio,viewport:[innerWidth,innerHeight]}));
     assert.equal(release.revision,original.release.revision,'A single view cannot be mixed across releases');
     assert.equal(identity.city,original.identity.city,'A single view cannot be mixed across city versions');
     assert.equal(new URL(identity.bundle).pathname,new URL(original.identity.bundle).pathname,'A single view cannot be mixed across bundles');
     if(!previewOnly && profile==='desktop' && process.env.BJW_UI_DIAG==='1'){
      const initial=await page.evaluate(()=>({position:window.__dbg.camera.position.toArray(),mode:window.__dbg.controls.mode}));
      assert.equal(initial.mode,'browse');
      await page.select('#landmark-picker',def.id);
      await page.waitForFunction(()=>!window.__dbg.controls.flying,{timeout:10000});
      await page.waitForFunction(()=>window.__dbg.models.stats().pending===0,{timeout:30000});
      await sleep(150);
      const ui=await page.evaluate(()=>({position:window.__dbg.camera.position.toArray(),rotation:window.__dbg.camera.quaternion.toArray(),mode:window.__dbg.controls.mode,picker:document.getElementById('landmark-picker').value,flyToCalls:window.__dbg.controls.debug.flyToCalls}));
      ui.initial=initial;ui.release=release;ui.identity=identity;ui.screenshot=`${output}/desktop-cctv-ui-selection.png`;ui.scope='Default browse → actual landmark picker selection; screenshot diagnosis only, no navigation/runtime modification.';
      await page.screenshot({path:ui.screenshot});await writeFile(`${output}/cctv-ui-selection.json`,JSON.stringify(ui,null,2)+'\n');
     }
     await page.evaluate(async(p,l)=>{await window.__bjw.renderPose(p,l);},pose.pos,pose.look);
     if(previewOnly){
      const screenshot=`${output}/${profile}-${def.id}-west-preflight.png`;
      await page.screenshot({path:screenshot});summaries.push({profile,previewOnly:true,...pose,screenshot,release,identity});
     }else{
      const startedAt=new Date().toISOString();
      const start=await page.evaluate(()=>{window.__bjw.resume();window.__bjw.resetMetrics();window.__qaLongTasks=[];return performance.now();});
      await sleep(5000);
      const end=await page.evaluate(()=>({time:performance.now(),metrics:window.__bjw.metrics(),longTasks:window.__qaLongTasks}));
      assert.deepEqual(errors,[]);
      const screenshot=`${output}/${profile}-view-${String(index+1).padStart(2,'0')}-${def.id}.png`;
      await page.screenshot({path:screenshot});
      const replacement={id:def.id,pos:pose.pos,look:pose.look,...end.metrics};
      original.views[index]=replacement;
      assert.equal(digest(retained(original)),unchanged);assert.equal(digest(original.views.filter((_,i)=>i!==index)),otherViews);
      const supplement={id:def.id,reason:'Original automated SE view intersected China Zun and did not represent CCTV; replaced with the inspected west view.',scope:'Only this 5-second view and its screenshot were remeasured. Other 11 views, original cold load, 180-second route, determinism, resource visits, overall long tasks and completion timestamp remain unchanged.',startedAt,completedAt:new Date().toISOString(),durationSeconds:(end.time-start)/1000,release,identity,pose,screenshot,longTasks:end.longTasks,errors,retainedSectionsSHA256:unchanged,otherViewsSHA256:otherViews,previousView};
      original.viewSupplements=[...(original.viewSupplements??[]),supplement];
      await writeFile(path,JSON.stringify(original,null,2)+'\n');
      summaries.push({profile,...supplement,metrics:end.metrics});
      console.log(`${profile} ${def.id} supplemental view: p95 ${end.metrics.p95.toFixed(1)}ms / max ${end.metrics.max.toFixed(1)}ms`);
     }
    }finally{await page.close();}
   }
  }finally{await browser.close();}
  await writeFile(`${output}/${key}-${previewOnly?'view-preflight':'view-supplement'}.json`,JSON.stringify({generatedAt:new Date().toISOString(),summaries},null,2)+'\n');
}
