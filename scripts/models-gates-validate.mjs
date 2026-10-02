/** Final GLB roof components and portal rays; no measured architecture claim. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';import {MeshoptDecoder} from 'meshoptimizer';
const registry=JSON.parse(await readFile('config/landmarks.json','utf8'));
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});await MeshoptDecoder.ready;
const errors=[],assets=[],sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function hit(triangles,origin,direction,maxDistance){
 let closest=Infinity;
 for(const [a,b,c] of triangles){
  const e1=sub(b,a),e2=sub(c,a),p=cross(direction,e2),det=dot(e1,p);if(Math.abs(det)<1e-9)continue;
  const v=sub(origin,a),u=dot(v,p)/det;if(u<-.00001||u>1.00001)continue;
  const q=cross(v,e1),w=dot(direction,q)/det;if(w<-.00001||u+w>1.00001)continue;
  const distance=dot(e2,q)/det;if(distance>.003&&distance<maxDistance&&distance<closest)closest=distance;
 }
 return Number.isFinite(closest)?closest:null;
}
function roofComponents(parts){
 const triangles=parts.filter(p=>p.material.startsWith('grey_roof_tiles')).flatMap(p=>p.triangles),points=[],ids=new Map(),parent=[];
 const id=p=>{const key=p.map(v=>Math.round(v*1000)).join(',');if(!ids.has(key)){ids.set(key,points.length);parent.push(points.length);points.push(p);}return ids.get(key);};
 const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 for(const t of triangles){const n=t.map(id);parent[find(n[1])]=find(n[0]);parent[find(n[2])]=find(n[0]);}
 const groups=new Map();for(let i=0;i<points.length;i++){const n=find(i);if(!groups.has(n))groups.set(n,[]);groups.get(n).push(points[i]);}
 return [...groups.values()].map(ps=>{const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of ps)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}return {min,max,planAreaM2:(max[0]-min[0])*(max[2]-min[2])};}).filter(b=>b.planAreaM2>120).sort((a,b)=>a.min[1]-b.min[1]);
}
for(const model of ['yongdingmen','wumen','shenwumen','gulou','zhonglou'])for(const level of ['near','medium','collision']){
 const d=registry.landmarks.find(d=>d.model===model),path='public/'+(level==='collision'?d.collision:d.lod[level]).replace(/^\.\//,'');
 const doc=await io.readBinary(new Uint8Array(await readFile(path))),parts=[];
 for(const node of doc.getRoot().listNodes())for(const primitive of node.getMesh()?.listPrimitives()??[]){
  const m=node.getWorldMatrix(),position=primitive.getAttribute('POSITION'),points=[];
  for(let i=0;i<position.getCount();i++){const p=position.getElement(i,[]);points.push([0,1,2].map(k=>m[k]*p[0]+m[4+k]*p[1]+m[8+k]*p[2]+m[12+k]));}
  const ids=primitive.getIndices()?.getArray()??points.map((_,i)=>i),triangles=[];for(let i=0;i<ids.length;i+=3)triangles.push([points[ids[i]],points[ids[i+1]],points[ids[i+2]]]);
  parts.push({material:primitive.getMaterial()?.getName()??'',triangles});
 }
 const triangles=parts.flatMap(p=>p.triangles),checks=[];
 const probe=(name,origin,direction,distance,expectedClear)=>{const firstHitM=hit(triangles,origin,direction,distance),passed=expectedClear?firstHitM===null:firstHitM!==null;checks.push({name,originGLTFMetres:origin,direction,maxDistanceM:distance,expectedClear,firstHitM,passed});if(!passed)errors.push(`${model}/${level}: ${name}`);};
 if(model==='shenwumen')for(const x of [-15,0,15])probe(`through gate ${x}`,[x,1.75,30],[0,0,-1],60,true);
 if(model==='wumen'){
  for(const x of [-52,-17.5,0,17.5,52])probe(`north arch mouth ${x}`,[x,1.75,-20],[0,0,1],10,true);
  for(const x of [-17.5,0,17.5])probe(`south central through arch ${x}`,[x,1.75,80],[0,0,-1],100,true);
  for(const side of [-1,1]){
   probe(`south lateral wing closed ${side}`,[side*52,1.75,80],[0,0,-1],50,false);
   probe(`lateral courtyard turn ${side}`,[side*52,1.75,25],[-side,0,0],14,true);
  }
 }
 if(model==='zhonglou'){
  probe('lower central gate',[0,1.75,25],[0,0,-1],50,true);
  probe('upper room central large arch',[0,26.5,20],[0,0,-1],40,true);
  for(const x of [-9.2,9.2]){
   probe(`upper recessed side arch front ${x}`,[x,26.5,20],[0,0,-1],8.95,true);
   probe(`upper closed side shutter ${x}`,[x,26.5,20],[0,0,-1],40,false);
  }
 }
 const row={model,level,path,checks,materialEvidence:doc.getRoot().listMaterials().map(m=>({name:m.getName(),baseColorFactor:m.getBaseColorFactor(),baseColorTexture:m.getBaseColorTexture()?.getName(),embeddedBaseColorKTX2SHA256:m.getBaseColorTexture()?.getImage()?createHash('sha256').update(m.getBaseColorTexture().getImage()).digest('hex'):null}))};
 if(level!=='collision'&&['yongdingmen','gulou','zhonglou'].includes(model)){
  row.roofComponents=roofComponents(parts);row.expectedEaveLayers=model==='zhonglou'?2:3;
  if(row.roofComponents.length!==row.expectedEaveLayers)errors.push(`${model}/${level}: expected${row.expectedEaveLayers} large roof components; actual${row.roofComponents.length}`);
  if(model==='gulou'&&!parts.some(p=>p.material==='wall_red'))errors.push(`${model}/${level}: red podium missing`);
  if(model==='zhonglou'&&(!parts.some(p=>p.material==='grey_brick')||parts.some(p=>p.material==='wood_red'||p.material==='wall_red')))errors.push(`${model}/${level}: grey masonry missing or unexpected red facade material`);
 }
 assets.push(row);
}
await mkdir('tests/reports',{recursive:true});await writeFile('tests/reports/model-gates.json',JSON.stringify({generatedAt:new Date().toISOString(),assetVersion:registry.assetVersion,method:'Decoded Meshopt world triangles: connected large grey roof layers, masonry materials and explicit portal rays for render/medium/collision. Mouth counts and visible macro forms are photo-grounded; corridor dimensions, stair detail and unsourced part heights remain inferred.',errors,assets},null,2)+'\n');
console.log(JSON.stringify({errors,assets:assets.map(r=>({model:r.model,level:r.level,roofLayers:r.roofComponents?.length,portalChecks:r.checks.length}))}));if(errors.length)process.exitCode=1;
