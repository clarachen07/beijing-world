import {launch} from 'puppeteer-core';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';
import {performancePose,runSingleView} from './performance-view.mjs';
const base=process.env.BJW_URL||'http://localhost:4173';
const profile=process.env.BJW_PROFILE||'desktop',mobile=profile==='mobile';
const output='artifacts/qa';await mkdir(output,{recursive:true});
const registry=JSON.parse(await readFile('config/landmarks.json','utf8'));
const origin=JSON.parse(await readFile('config/world.json','utf8')).origin;
if(process.env.BJW_VIEW_ONLY){
  await runSingleView({base,registry,origin});
}else{
const browser=await launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--use-gl=angle','--enable-gpu-rasterization'],defaultViewport:mobile?{width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true}:{width:1440,height:900,deviceScaleFactor:1}});
const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
const client=await page.createCDPSession();await client.send('Network.enable');await client.send('Network.setCacheDisabled',{cacheDisabled:true});await client.send('Network.setBypassServiceWorker',{bypass:true});
const downloads=new Map();
client.on('Network.requestWillBeSent',event=>downloads.set(event.requestId,{url:event.request.url,type:event.type,completed:false,encodedBytes:0,receivedBodyBytes:0}));
client.on('Network.dataReceived',event=>{const request=downloads.get(event.requestId);if(request)request.receivedBodyBytes+=event.encodedDataLength;});
client.on('Network.loadingFinished',event=>{const request=downloads.get(event.requestId);if(request){request.completed=true;request.encodedBytes=event.encodedDataLength;}});
client.on('Network.loadingFailed',event=>{const request=downloads.get(event.requestId);if(request)request.failed=event.errorText;});
await client.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:10*1000*1000/8,uploadThroughput:1000*1000/8});
await page.evaluateOnNewDocument(()=>{
  window.__qaLongTasks=[];new PerformanceObserver(list=>window.__qaLongTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({entryTypes:['longtask']});
});
const start=Date.now();await page.goto(base,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>{const loading=document.querySelector('#loading');return !!window.__bjw&&loading?.classList.contains('done')&&Number(getComputedStyle(loading).opacity)<.01;},{timeout:60000});
const boot=await page.evaluate(()=>({entries:performance.getEntriesByType('resource').map(r=>({name:r.name,transfer:r.transferSize,end:r.responseEnd})),longTasks:window.__qaLongTasks}));
const completedDownloads=[...downloads.values()].filter(request=>request.completed);
const inFlightRequests=[...downloads.values()].filter(request=>!request.completed);
const completedEncodedBytes=completedDownloads.reduce((sum,request)=>sum+request.encodedBytes,0);
const networkCapture={completedEncodedBytes,observedEncodedBytesIncludingPartialBodies:completedEncodedBytes+inFlightRequests.reduce((sum,request)=>sum+request.receivedBodyBytes,0),requests:completedDownloads,inFlightRequests,scope:'Chrome page CDP through scene-ready detection: completed responses include document and headers; in-flight received encoded body bytes are added separately. In-flight headers, worker-target script traffic and transport overhead are not counted. Worker only decodes buffers and makes no city/model downloads.'};
const identity=await page.evaluate(()=>({city:window.__dbg.city.manifest.revision,bundle:[...document.scripts].find(s=>s.type==='module')?.src,devicePixelRatio,viewport:[innerWidth,innerHeight]}));
const report={profile,simulated:mobile,device:{cpu:os.cpus()[0].model,memoryGiB:os.totalmem()/1073741824,note:mobile?'Chrome viewport and touch emulation on desktop hardware':'Local desktop hardware'},browser:await browser.version(),release:JSON.parse(await readFile('dist/release.json','utf8')),identity,url:base,startedAt:new Date(start).toISOString(),coldLoad:{milliseconds:Date.now()-start,transferredBytes:boot.entries.reduce((sum,r)=>sum+r.transfer,0),networkCapture,network:'10 Mbps / 100 ms CDP simulation',...boot},views:[],errors};
await client.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const preferred=['taihedian','qiniandian','cctv','tiananmen','birdnest','watercube','white-dagoba','chinazun','yonghegong','confucius-guozijian','ditan','ritan'];
const poses=preferred.map(key=>registry.landmarks.find(lm=>lm.id===key||lm.model===key)).filter(Boolean);
for(const def of registry.landmarks)if(poses.length<12&&!poses.includes(def))poses.push(def);
try {
  for(const [index,def] of poses.slice(0,12).entries()){
    const {pos,look}=performancePose(def,origin);
    await page.evaluate(async(p,l)=>{await window.__bjw.renderPose(p,l);window.__bjw.resume();window.__bjw.resetMetrics();},pos,look);
    await delay(5000);const metrics=await page.evaluate(()=>window.__bjw.metrics());
    await page.screenshot({path:`${output}/${profile}-view-${String(index+1).padStart(2,'0')}-${def.id}.png`});
    report.views.push({id:def.id,pos,look,...metrics});console.log(`${profile} view ${index+1}/12 ${def.name}: p95 ${metrics.p95.toFixed(1)}ms`);
  }
  if(process.env.BJW_SKIP_ROUTE!=='1'){
    await page.click('#btn-replay');const routeStart=await page.evaluate(()=>{window.__bjw.resetMetrics();return performance.now();});
    for(let part=0;part<6;part++){await delay(30000);console.log(`${profile} route ${(part+1)*30}/180 seconds`);}
    const routeEnd=await page.evaluate(()=>performance.now());report.route={durationSeconds:180,start:routeStart,end:routeEnd,...await page.evaluate(()=>window.__bjw.metrics())};
  }
  const frames=await page.evaluate(async()=>{
    const state=()=>{
      let trafficMatrices=null,trafficCount=0;
      window.__dbg.scene.traverse(o=>{if(o.isInstancedMesh&&o.geometry.parameters?.width===1.9){const bytes=new Uint8Array(o.instanceMatrix.array.buffer);let hash=2166136261;for(const byte of bytes)hash=Math.imul(hash^byte,16777619);trafficMatrices=hash>>>0;trafficCount=o.count;}});
      return{camera:window.__dbg.camera.position.toArray(),quaternion:window.__dbg.camera.quaternion.toArray(),night:window.__dbg.env.nightT,trafficMatrices,trafficCount};
    };
    await window.__bjw.seekFrame(777);const a=state();
    await window.__bjw.seekFrame(2000);await window.__bjw.seekFrame(777);const b=state();return{a,b,equal:a.trafficMatrices!==null&&JSON.stringify(a)===JSON.stringify(b)};
  });report.determinism=frames;
  const points=[report.views[0],report.views[2]];const visits=[];
  for(const target of points)await page.evaluate(async(p,l)=>{await window.__bjw.renderPose(p,l);window.__bjw.resume();},target.pos,target.look);
  await delay(16500);const baseline=await page.evaluate(()=>window.__bjw.metrics());await client.send('HeapProfiler.collectGarbage');const heapBefore=(await page.metrics()).JSHeapUsedSize;
  for(let i=0;i<20;i++){
    const target=points[i%2];await page.evaluate(async(p,l)=>{await window.__bjw.renderPose(p,l);window.__bjw.resume();},target.pos,target.look);await delay(250);
    visits.push(await page.evaluate(()=>window.__bjw.metrics()));
  }
  await delay(16500);await client.send('HeapProfiler.collectGarbage');report.resourceCycles={visits:20,baseline,snapshots:visits,afterCleanup:await page.evaluate(()=>window.__bjw.metrics()),heapBefore,heapAfter:(await page.metrics()).JSHeapUsedSize,interpretation:'20 warm repeated visits followed by 16.5s cleanup, matched final view; not 20 complete cold unload/reload cycles.'};
  report.longTasks=await page.evaluate(()=>window.__qaLongTasks);
}catch(error){report.errors.push(error.message);report.failure=error.stack;}
finally{report.completedAt=new Date().toISOString();await writeFile(`${output}/performance-${profile}.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
if(report.errors.length)process.exitCode=1;
}
