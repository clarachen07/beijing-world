// Targeted comparison; retain the existing Taihedian/Qiniandian captures.
import {launch} from 'puppeteer-core';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

const output='artifacts/qa';
await mkdir(output,{recursive:true});
const world=JSON.parse(await readFile('config/world.json','utf8'));
const registry=JSON.parse(await readFile('config/landmarks.json','utf8'));
const def=registry.landmarks.find(entry=>entry.model==='cctv');
const x=(def.lon-world.origin.lon)*111320*Math.cos(world.origin.lat*Math.PI/180);
const z=(world.origin.lat-def.lat)*world.projection.metresPerDegreeLat;
const pos=[x-600,def.elevationM+450,z-700];
const look=[x,def.elevationM+def.heightM*.5,z];
const stages=process.env.COMPARE_STAGE?[process.env.COMPARE_STAGE]:['before','after'];
if(stages.some(stage=>!['before','after'].includes(stage)))throw new Error('COMPARE_STAGE must be before or after');
const browser=await launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--use-gl=angle'],defaultViewport:{width:1440,height:900,deviceScaleFactor:1}});
try{
 for(const stage of stages){
  const url=stage==='before'?(process.env.BJW_BEFORE_URL||'http://127.0.0.1:5174/'):(process.env.BJW_URL||'http://127.0.0.1:4173/');
  const page=await browser.newPage(),pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(String(error)));
  try{
   await page.goto(url,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!!window.__bjw,{timeout:120000});
   await page.waitForFunction(()=>{const screen=document.getElementById('loading');return !screen||Number(getComputedStyle(screen).opacity)<.01;},{timeout:120000});
   await page.evaluate(async(p,l)=>{await window.__bjw.renderPose(p,l);},pos,look);
   const observed=await page.evaluate(()=>({position:window.__dbg.camera.position.toArray(),fov:window.__dbg.camera.fov,aspect:window.__dbg.camera.aspect,pixelRatio:window.__dbg.renderer.getPixelRatio(),loadingOpacity:document.getElementById('loading')?Number(getComputedStyle(document.getElementById('loading')).opacity):0}));
   if(observed.position.some((value,index)=>Math.abs(value-pos[index])>1e-5))throw new Error(`${stage} camera did not adopt the requested pose`);
   if(pageErrors.length)throw new Error(`${stage} page errors: ${pageErrors.join('; ')}`);
   await page.screenshot({path:`${output}/compare-${stage}-cctv.png`});
   const path=`${output}/comparison-${stage}.json`;
   const prior=JSON.parse(await readFile(path,'utf8').catch(()=>'{}'));
   prior.views=[...(prior.views??[]).filter(view=>view.model!=='cctv'),{stage,model:'cctv',view:'north-west',pos,look,capturedAt:new Date().toISOString(),observed,pageErrors}];
   prior.note='Matched WGS84 camera positions. Before uses source/assets committed in f966785, rebuilt using the current installed toolchain; after uses current static release. Renderer resolution/lighting differs; this is a visual comparison, not an original-version performance measurement.';
   await writeFile(path,JSON.stringify(prior,null,2)+'\n');
  }finally{await page.close();}
 }
}finally{await browser.close();}
