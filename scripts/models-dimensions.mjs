/** Read-only measurement of final compressed GLBs against independent primary text. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
const registry=JSON.parse(await readFile('config/landmarks.json','utf8'));
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
await MeshoptDecoder.ready;
const round=n=>Math.round(n*1e6)/1e6;
const transform=(p,m)=>[0,1,2].map(i=>m[i]*p[0]+m[4+i]*p[1]+m[8+i]*p[2]+m[12+i]);
const bounds=points=>({min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))});
function components(primitive,matrix,primitiveIndex){
 const position=primitive.getAttribute('POSITION'),raw=position.getArray(),itemSize=3;
 const canonical=new Map(),vertices=[],map=[];
 for(let i=0;i<position.getCount();i++){
  const key=Array.from(raw.slice(i*itemSize,(i+1)*itemSize)).join(',');
  let id=canonical.get(key);
  if(id===undefined){id=vertices.length;canonical.set(key,id);vertices.push({p:transform(position.getElement(i,[]),matrix),index:i});}
  map.push(id);
 }
 const parent=vertices.map((_,i)=>i);const find=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;};
 const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a;};
 const indices=primitive.getIndices()?.getArray()??map.map((_,i)=>i);
 for(let i=0;i<indices.length;i+=3){join(map[indices[i]],map[indices[i+1]]);join(map[indices[i]],map[indices[i+2]]);}
 const groups=new Map();vertices.forEach((v,i)=>{const root=find(i);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(v);});
 return [...groups.values()].map(v=>{
  const b=bounds(v.map(x=>x.p)),size=b.max.map((x,i)=>x-b.min[i]);
  return{material:primitive.getMaterial()?.getName()??'',primitiveIndex,bounds:b,size,center:b.min.map((x,i)=>(x+b.max[i])/2),vertices:v};
 });
}
async function measure(model){
 const def=registry.landmarks.find(d=>d.model===model),path='public/'+def.lod.near.replace(/^\.\//,''),bytes=await readFile(path),doc=await io.readBinary(new Uint8Array(bytes));
 const parts=[];for(const node of doc.getRoot().listNodes())if(node.getMesh())for(const [index,primitive] of node.getMesh().listPrimitives().entries())parts.push(...components(primitive,node.getWorldMatrix(),index));
 const all=parts.flatMap(p=>p.vertices.map(v=>v.p));
 return {model,path,sha256:createHash('sha256').update(bytes).digest('hex'),parts,bounds:bounds(all)};
}
const models=await Promise.all(['taihedian','qiniandian','cctv'].map(measure));
if(process.argv.includes('--parts')){
 for(const m of models){console.log(m.model,m.path);for(const p of m.parts.filter(p=>p.size[1]>7||p.size[0]>20))console.log(p.material,p.vertices.length,'size',p.size.map(round),'centre',p.center.map(round));}
 process.exit(0);
}
const sources={
 taihe:{title:'故宫博物院：太和殿（杨玉良）',url:'https://www.dpm.org.cn/Uploads/pdf/1602/T00092_00.pdf',page:1,verifiedAt:'2026-10-02',values:{eastWestBodyM:63.96,northSouthBodyM:37.17,ridgeHeightM:35.05,includingChiwenHeightM:37.44},definitionNote:'Publication names east-west/north-south building dimensions but does not give survey endpoints or distinguish column-axis from outside-column dimensions.'},
 taiheBase:{title:'故宫博物院：明清北京城的建造（建筑形制章节）',url:'https://www.dpm.org.cn/Uploads/pdf/1564/T00016_00.pdf',printedPage:16,verifiedAt:'2026-10-02',values:{altarHeightM:8.13,bodyHeightM:26.92},definitionNote:'The text gives a three-tier 前三殿 altar of total height 8.13m. It describes the shared terrace layout, not a survey of this reconstructed rectangular footprint.'},
 qinianDetailed:{title:'北京市公园管理中心：祈年殿',url:'https://gygl.beijing.gov.cn/mlgy/mlgy_gyjg01/201912/t20191211_1048233.html',publishedAt:'2019-12-11',verifiedAt:'2026-10-02',values:{hallAboveAltarHeightM:31.6,altarHeightM:5.2,totalHeightM:36.8,lowerDiameterM:90.3,middleDiameterM:79.3,upperDiameterM:68.2,dragonWellColumnHeightM:19.2,dragonWellColumnDiameterM:1.2}},
 qinianCurrent:{title:'天坛公园：祈年殿',url:'https://tiantanpark.cn/scenic_spot_list/detail/1254.html',verifiedAt:'2026-10-02',values:{outerColumnRingDiameterApproxM:24,overallHeightApproxM:38},definitionNote:'Diameter refers explicitly to spaces between outer-eave columns; total height is approximate.'},
 qinianSummary:{title:'北京市公园管理中心：天坛的主体建筑：祈年殿',url:'https://gygl.beijing.gov.cn/whgy/whgy_wsgc/201912/t20191206_885633.html',publishedAt:'2019-04-16',verifiedAt:'2026-10-02',values:{diameterM:32,altarHeightM:6,hallHeightAsDescribedM:38},definitionNote:'Text says 殿高38米; it does not explicitly identify that value as height including the separately stated 6m altar. 32m is not labelled with roof-eave survey endpoints. Using it as the largest roof diameter is an architectural inference, not verified measurement equivalence.'},
 cctvHeight:{title:'Turner Construction: CCTV Headquarters',url:'https://www.turnerconstruction.com/projects/china-central-television-headquarters-cctv',verifiedAt:'2026-10-02',values:{heightM:234}},
 cctvCantilever:{title:'OMA: CCTV Headquarters',url:'https://www.oma.com/projects/cctv-headquarters',verifiedAt:'2026-10-02',values:{cantileverM:75},definitionNote:'The project page gives 75m but no surveyed endpoints, axis or support-face definition for mapping to this model.'},
};
const checks=[],observations=[];
const evidence=part=>({material:part.material,primitiveIndex:part.primitiveIndex,uniquePositionCount:part.vertices.length,firstAccessorVertexIndices:part.vertices.slice(0,12).map(v=>v.index),boundsGLTFMetres:{min:part.bounds.min.map(round),max:part.bounds.max.map(round)}});
const extreme=(part,axis,max)=>part.vertices.reduce((a,b)=>(max?b.p[axis]>a.p[axis]:b.p[axis]<a.p[axis])?b:a).p;
function add(model,part,sourceKey,sourcePart,expectedM,actualM,points,{definitionVerified=true,notes='',partEvidence=[]}={}){
 const relativeErrorPercent=100*Math.abs(actualM-expectedM)/expectedM;
 checks.push({model,part,source:sources[sourceKey].url,sourcePart,expectedM,actualM:round(actualM),relativeErrorPercent:round(relativeErrorPercent),tolerancePercent:2,numericalCheck:relativeErrorPercent<=2?'pass':'fail',status:definitionVerified?(relativeErrorPercent<=2?'pass':'fail'):'measurement_definition_unverified',definitionVerified,controlPointsGLTFMetres:points.map(p=>p.map(round)),partEvidence,notes});
}
const taihe=models[0],qinian=models[1],cctv=models[2];
const columns=taihe.parts.filter(p=>p.material==='wood_red'&&p.vertices.length===24&&p.size[0]<2&&p.size[2]<2&&p.bounds.min[1]>8&&p.bounds.min[1]<8.3&&p.size[1]>7);
if(columns.length!==32)throw new Error(`Expected 32 distinct primary Taihe perimeter columns; found ${columns.length}`);
const centres=columns.map(p=>[p.center[0],p.bounds.min[1],p.center[2]]);
for(const [axis,key,expected] of [[0,'east-west body column axes',63.96],[2,'north-south body column axes',37.17]]){
 const lo=centres.reduce((a,b)=>b[axis]<a[axis]?b:a),hi=centres.reduce((a,b)=>b[axis]>a[axis]?b:a);
 add('taihedian',key,'taihe',axis===0?'东西长（柱轴解释未独立核准）':'南北宽（柱轴解释未独立核准）',expected,hi[axis]-lo[axis],[lo,hi],{definitionVerified:false,notes:'Measured centres of exported circular columns. Text alone cannot establish that its body dimensions refer to these same axes.',partEvidence:[evidence(columns[centres.indexOf(lo)]),evidence(columns[centres.indexOf(hi)])]});
 const outsideLo=Math.min(...columns.map(p=>p.bounds.min[axis])),outsideHi=Math.max(...columns.map(p=>p.bounds.max[axis]));
 observations.push({model:'taihedian',part:axis===0?'outer-column envelope east-west':'outer-column envelope north-south',actualM:round(outsideHi-outsideLo),publishedBodyM:expected,numericalErrorIfOutsideFacesWereIntendedPercent:round(100*Math.abs(outsideHi-outsideLo-expected)/expected),acceptance:'Source endpoint definition unavailable; this alternative is not silently discarded.'});
}
const taiheTerraces=taihe.parts.filter(p=>p.material==='carved_marble'&&p.vertices.length===8&&p.size[0]>70&&p.size[2]>40&&p.size[1]>2);
const taiheBaseTop=Math.max(...taiheTerraces.map(p=>p.bounds.max[1]));
add('taihedian','three-tier altar height','taiheBase','台基高',8.13,taiheBaseTop-taihe.bounds.min[1],[[0,taihe.bounds.min[1],0],[0,taiheBaseTop,0]],{partEvidence:taiheTerraces.map(evidence)});
const upperRoof=taihe.parts.filter(p=>p.material==='glazed_gold'&&p.size[0]>45&&p.size[0]<60&&p.size[1]>8).sort((a,b)=>b.bounds.max[1]-a.bounds.max[1])[0];
if(!upperRoof)throw new Error('Taihe upper roof was not located');
add('taihedian','upper roof ridge above ground','taihe','殿地面至正脊',35.05,upperRoof.bounds.max[1]-taihe.bounds.min[1],[[0,taihe.bounds.min[1],0],extreme(upperRoof,1,true)],{partEvidence:[evidence(upperRoof)]});
add('taihedian','height including chiwen ornament','taihe','高（包括正吻卷尾）',37.44,taihe.bounds.max[1]-taihe.bounds.min[1],[[0,taihe.bounds.min[1],0],[0,taihe.bounds.max[1],0]]);
const discs=qinian.parts.filter(p=>p.material==='carved_marble'&&p.vertices.length===192&&p.size[1]>1&&p.size[1]<3&&p.size[0]>40&&Math.abs(p.size[0]-p.size[2])<.01).sort((a,b)=>a.bounds.min[1]-b.bounds.min[1]);
if(discs.length!==3)throw new Error(`Expected three Prayer Hall altar discs; found ${discs.length}`);
for(const [i,name,diameter] of [[0,'lower altar disc',90.3],[1,'middle altar disc',79.3],[2,'upper altar disc',68.2]])add('qiniandian',name+' diameter','qinianDetailed',name==='lower altar disc'?'下层径':name==='middle altar disc'?'中层径':'上层径',diameter,discs[i].size[0],[extreme(discs[i],0,false),extreme(discs[i],0,true)],{partEvidence:[evidence(discs[i])],notes:'Diameter of the marble disc itself, excluding radial stairs, balusters and handrails.'});
const baseTop=discs[2].bounds.max[1];
add('qiniandian','three-tier altar height','qinianDetailed','3层殿基合计高',5.2,baseTop-qinian.bounds.min[1],[[0,qinian.bounds.min[1],0],[0,baseTop,0]],{partEvidence:discs.map(evidence)});
add('qiniandian','hall above altar height','qinianDetailed','祈年殿殿高',31.6,qinian.bounds.max[1]-baseTop,[[0,baseTop,0],[0,qinian.bounds.max[1],0]]);
add('qiniandian','overall height including altar','qinianDetailed','通高',36.8,qinian.bounds.max[1]-qinian.bounds.min[1],[[0,qinian.bounds.min[1],0],[0,qinian.bounds.max[1],0]]);
const qColumns=qinian.parts.filter(p=>p.material==='wood_red'&&p.vertices.length===24&&p.size[0]<2&&p.size[2]<2&&p.size[1]>7);
const outsideColumns=qColumns.filter(p=>Math.hypot(p.center[0],p.center[2])>11);
if(outsideColumns.length!==12)throw new Error(`Expected 12 outer Prayer Hall columns; found ${outsideColumns.length}`);
const outerLo=outsideColumns.reduce((a,b)=>b.center[0]<a.center[0]?b:a),outerHi=outsideColumns.reduce((a,b)=>b.center[0]>a.center[0]?b:a);
add('qiniandian','outer eave column-axis ring diameter','qinianCurrent','外檐柱间直径约',24,outerHi.center[0]-outerLo.center[0],[outerLo.center,outerHi.center],{partEvidence:[evidence(outerLo),evidence(outerHi)],notes:'Source says approximately 24m; measured between centres of opposing exported outer columns.'});
const dragonColumns=qColumns.filter(p=>Math.hypot(p.center[0],p.center[2])<5);
if(dragonColumns.length!==4)throw new Error(`Expected four dragon-well columns; found ${dragonColumns.length}`);
add('qiniandian','central dragon-well column height','qinianDetailed','龙井柱高',19.2,dragonColumns[0].size[1],[extreme(dragonColumns[0],1,false),extreme(dragonColumns[0],1,true)],{partEvidence:dragonColumns.map(evidence)});
add('qiniandian','central dragon-well column diameter','qinianDetailed','龙井柱直径',1.2,dragonColumns[0].size[0],[extreme(dragonColumns[0],0,false),extreme(dragonColumns[0],0,true)],{partEvidence:[evidence(dragonColumns[0])]});
const lowerRoof=qinian.parts.filter(p=>p.material==='glazed_blue'&&p.size[0]>25).sort((a,b)=>b.size[0]-a.size[0])[0];
add('qiniandian','largest blue roof eave diameter','qinianSummary','所述直径（未定义测量边界）',32,lowerRoof.size[0],[extreme(lowerRoof,0,false),extreme(lowerRoof,0,true)],{definitionVerified:false,partEvidence:[evidence(lowerRoof)],notes:'The 32m institutional text does not explicitly define roof edge or column face. Geometric value is measured; exact source-part correspondence remains an inference.'});
add('cctv','overall structural envelope height','cctvHeight','headquarters height',234,cctv.bounds.max[1]-cctv.bounds.min[1],[[0,cctv.bounds.min[1],0],[0,cctv.bounds.max[1],0]]);
const northCantilever=cctv.parts.find(p=>p.material==='glass_curtainwall'&&p.size[0]>75&&p.size[0]<77&&p.size[1]>40&&p.size[1]<45);
if(!northCantilever)throw new Error('CCTV upper north block was not located');
checks.push({model:'cctv',part:'free cantilever length',source:sources.cctvCantilever.url,sourcePart:'75-metre cantilever',expectedM:75,actualM:null,relativeErrorPercent:null,tolerancePercent:2,status:'not_verified',definitionVerified:false,controlPointsGLTFMetres:[],partEvidence:[evidence(northCantilever)],notes:'The 76m length of the complete upper north block includes its tower overlap and cannot verify the 75m free cantilever. No independently matched support face and cantilever endpoint are available; no <=2% claim is made.'});
observations.push({model:'cctv',part:'complete upper north block, including tower overlap',actualM:round(northCantilever.size[0]),notEquivalentTo:'75m free cantilever',controlPointsGLTFMetres:[extreme(northCantilever,0,false),extreme(northCantilever,0,true)].map(p=>p.map(round))});
const conflicts=[{model:'qiniandian',chosen:sources.qinianDetailed.url,chosenOverallM:36.8,chosenAltarM:5.2,alternate:sources.qinianCurrent.url,alternateOverallApproxM:38,alternateAltarSource:sources.qinianSummary.url,alternateAltarM:6,alternateHallHeightAsDescribedM:38,alternateHeightIncludesAltar:null,notes:'Detailed 31.6m hall + 5.2m altar defines the model. The current official park gives total height approximately 38m. The older summary separately states altar 6m and 殿高38m without an explicit total-height definition. These remain conflicting/ambiguous evidence, not equal measured values.'}];
const report={generatedAt:new Date().toISOString(),assetVersion:registry.assetVersion,method:'Final GLB Meshopt decoded by NodeIO; normalized POSITION elements transformed by exported node world matrix; triangle components rejoined by identical position to recover physical parts despite UV/normal seams. Expected dimensions are independent primary-source constants, not registry.heightM. Only near LOD is used for architectural measurement.',coordinateFrame:'GLTF local metre coordinates: X east, Y up, Z south; elevation/placement transform intentionally excluded',tolerancePercent:2,sources,assets:models.map(m=>({model:m.model,path:m.path,sha256:m.sha256,boundsGLTFMetres:{min:m.bounds.min.map(round),max:m.bounds.max.map(round)}})),checks,observations,conflicts,geospatialAcceptance:{targetHorizontalErrorM:3,independentSurveyedControlPointsAvailable:false,status:'not_accepted_as_surveyed',placements:registry.landmarks.map(d=>({id:d.id,surveyed:false,independentControlPointCount:0,registeredLatitude:d.lat,registeredLongitude:d.lon,registeredOriginIsNotAccuracyEvidence:true})),notes:'All 32 placements have OSM mapping/coordinate provenance, but no independent surveyed control points. They have not passed measured <=3m accuracy acceptance.'},summary:{definedChecksPassed:checks.filter(c=>c.status==='pass').length,definedChecksFailed:checks.filter(c=>c.status==='fail').length,unresolvedChecks:checks.filter(c=>!['pass','fail'].includes(c.status)).length,overallArchitecturalAndSurveyAcceptance:'partial; unresolved source endpoint definitions and 75m cantilever; no surveyed 3m acceptance'}};
await mkdir('tests/reports',{recursive:true});await writeFile('tests/reports/model-dimensions.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.summary));for(const c of checks)console.log(`${c.model}: ${c.part}: ${c.actualM??'unknown'} / ${c.expectedM} m; ${c.relativeErrorPercent??'unknown'}%; ${c.status}`);
if(report.summary.definedChecksFailed)process.exitCode=1;
