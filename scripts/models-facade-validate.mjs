/** Inspect final decoded facade layers; inferred details are not survey evidence. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
const registry=JSON.parse(await readFile('config/landmarks.json','utf8'));
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
await MeshoptDecoder.ready;
const errors=[],assets=[];
const bounds=points=>({min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))});
for(const model of ['cctv','watercube'])for(const level of ['near','medium']){
 const def=registry.landmarks.find(d=>d.model===model),path='public/'+def.lod[level].replace(/^\.\//,'');
 const doc=await io.readBinary(new Uint8Array(await readFile(path))),parts=[];
 for(const node of doc.getRoot().listNodes())for(const p of node.getMesh()?.listPrimitives()??[]){
  const m=node.getWorldMatrix(),pos=p.getAttribute('POSITION'),points=[];
  for(let i=0;i<pos.getCount();i++){const v=pos.getElement(i,[]);points.push([0,1,2].map(k=>m[k]*v[0]+m[4+k]*v[1]+m[8+k]*v[2]+m[12+k]));}
  const index=p.getIndices()?.getArray()??points.map((_,i)=>i),triangles=[];
  for(let i=0;i<index.length;i+=3)triangles.push([points[index[i]],points[index[i+1]],points[index[i+2]]]);
  parts.push({material:p.getMaterial()?.getName(),points,triangles,bounds:bounds(points)});
 }
 const row={model,level,path};
 if(model==='cctv'){
  const steel=parts.find(p=>p.material.startsWith('steel_structure'));
  // The old model had neither plane: existing tower grids cannot satisfy both.
  const soffit=steel.triangles.filter(t=>t.every(p=>p[1]>189.5&&p[1]<192)&&t.some(p=>p[0]>30));
  const outer=steel.triangles.filter(t=>t.every(p=>p[0]>62.45&&p[0]<63.55&&p[1]>192));
  Object.assign(row,{cantileverSoffitSteelTriangles:soffit.length,cantileverEastFaceSteelTriangles:outer.length});
  if(soffit.length<80||outer.length<80)errors.push(`${model}/${level}: cantilever exterior or soffit grid missing`);
 }else{
  const shell=parts.find(p=>p.material.startsWith('etfe_cells')),glass=parts.find(p=>p.material.startsWith('glass_curtainwall')),columns=parts.find(p=>p.material.startsWith('white_stucco'));
  Object.assign(row,{pillowShellBoundsGLTF: shell?.bounds,recessedGlazingBoundsGLTF:glass?.bounds,paleColumnBoundsGLTF:columns?.bounds,dimensionsInferred:{groundStoreyHeightM:4.2,recessM:1.8,columnSpacingM:12}});
  if(!shell||Math.abs(shell.bounds.min[1]-4.2)>.03||Math.abs(shell.bounds.max[1]-31)>.03)errors.push(`${model}/${level}: upper ETFE facade layer missing`);
  if(!glass||Math.abs(glass.bounds.min[1])>.03||Math.abs(glass.bounds.max[1]-4.2)>.03||Math.abs(glass.bounds.max[0]-86.7)>.05||Math.abs(glass.bounds.min[2]+86.7)>.05)errors.push(`${model}/${level}: recessed glazed storey missing`);
  if(!columns||columns.bounds.min[1]>.03||columns.bounds.max[1]<4.1||columns.bounds.max[0]<88||columns.bounds.min[2]>-88)errors.push(`${model}/${level}: perimeter pale columns missing`);
 }
 assets.push(row);
}
await mkdir('tests/reports',{recursive:true});
await writeFile('tests/reports/model-facades.json',JSON.stringify({generatedAt:new Date().toISOString(),assetVersion:registry.assetVersion,method:'Final Meshopt GLB decoded world vertices; checks structural layer presence, not as-built rod geometry or surveyed entrance dimensions.',errors,assets},null,2)+'\n');
console.log(JSON.stringify({errors,assets}));if(errors.length)process.exitCode=1;
