import {launch} from 'puppeteer-core';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const output='artifacts/qa';await mkdir(output,{recursive:true});
const config=JSON.parse(await readFile('config/world.json','utf8'));
const registry=JSON.parse(await readFile('config/landmarks.json','utf8'));
const browser=await launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--use-gl=angle'],defaultViewport:{width:1440,height:900,deviceScaleFactor:1}});
const views=[];
const before=JSON.parse(await readFile(`${output}/comparison-before.json`,'utf8').catch(()=>'{}')).views??[];
try{
 for(const stage of (process.env.COMPARE_STAGE?[process.env.COMPARE_STAGE]:['before','after'])){
  const page=await browser.newPage();await page.goto(stage==='before'?(process.env.BJW_BEFORE_URL||'http://127.0.0.1:5174'):(process.env.BJW_URL||'http://127.0.0.1:4173'),{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__bjw,{timeout:120000});
  await page.waitForFunction(()=>{const screen=document.getElementById('loading');return !screen||Number(getComputedStyle(screen).opacity)<.01;},{timeout:120000});
  for(const model of ['taihedian','qiniandian','cctv']){
   const def=registry.landmarks.find(lm=>lm.model===model),x=(def.lon-config.origin.lon)*111320*Math.cos(config.origin.lat*Math.PI/180),z=(config.origin.lat-def.lat)*config.projection.metresPerDegreeLat;
   const distance=model==='cctv'?340:model==='qiniandian'?110:120;
   const prior=stage==='after'?before.find(view=>view.model===model):undefined;
   const pos=prior?.pos??(model==='cctv'?[x-600,def.elevationM+450,z-700]:[x+distance*.7,def.elevationM+distance*.6+def.heightM*.7,z+distance*.9]);
   const look=prior?.look??[x,def.elevationM+def.heightM*(model==='cctv'?.5:.4),z];
   await page.evaluate(async(p,l)=>{await window.__bjw.renderPose(p,l);},pos,look);await page.screenshot({path:`${output}/compare-${stage}-${model}.png`});views.push({stage,model,pos,look});
  }
  await page.close();
 }
}finally{await browser.close();await writeFile(`${output}/comparison-${process.env.COMPARE_STAGE||'all'}.json`,JSON.stringify({views,note:'Matched WGS84 camera positions. Before uses source/assets committed in f966785, rebuilt using the current installed toolchain; after uses current static release. Renderer resolution/lighting differs; this is a visual comparison, not an original-version performance measurement.'},null,2)+'\n');}
