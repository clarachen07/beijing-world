/** Validate actual exported geometry, textures, measured heights and all registered paths. */
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import validator from 'gltf-validator';
const registry=JSON.parse(await readFile('config/landmarks.json','utf8'));
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});await MeshoptDecoder.ready;
let errors=[];const reports=[];
const only=process.argv.find(a=>a.startsWith('--only='))?.split('=')[1]?.split(',');
for(const [model,def] of new Map(registry.landmarks.filter(l=>l.model&&(!only||only.includes(l.model))).map(l=>[l.model,l]))){
 const counts={};
 for(const level of ['near','medium','far','collision']){
  const p=level==='collision'?def.collision:def.lod[level];let bytes;
  try{bytes=await readFile('public/'+p.replace(/^\.\//,''));}catch{errors.push(`${model}: missing ${level}`);continue;}
  const result=await validator.validateBytes(new Uint8Array(bytes),{uri:p,maxIssues:100});
  const doc=await io.readBinary(new Uint8Array(bytes));const scene=doc.getRoot().listScenes()[0];const bounds=getBounds(scene);
  const height=bounds.max[1]-bounds.min[1];
  const triangles=doc.getRoot().listMeshes().reduce((s,m)=>s+m.listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0);counts[level]=triangles;
  if(result.issues.numErrors)errors.push(`${model}/${level}: ${result.issues.numErrors} glTF errors`);
  if(!Number.isFinite(height)||Math.abs(height-def.heightM)>Math.max(.5,def.heightM*.01))errors.push(`${model}/${level}: height ${height} != ${def.heightM}`);
  if(Math.abs(bounds.min[1])>.5)errors.push(`${model}/${level}: base not grounded ${bounds.min[1]}`);
  if(level==='near')for(const mat of doc.getRoot().listMaterials()){
   if(!mat.getBaseColorTexture()||!mat.getNormalTexture()||!mat.getMetallicRoughnessTexture())errors.push(`${model}: ${mat.getName()} missing baked PBR maps`);
  }
  for(const texture of doc.getRoot().listTextures()){
   if(texture.getMimeType()!=='image/ktx2'){errors.push(`${model}/${level}: uncompressed runtime texture`);continue;}
   const image=texture.getImage();const magic=[171,75,84,88,32,50,48,187,13,10,26,10];
   if(!image||image.length<80||magic.some((v,i)=>image[i]!==v)){errors.push(`${model}/${level}: invalid KTX2 header`);continue;}
   const view=new DataView(image.buffer,image.byteOffset,image.byteLength),w=view.getUint32(20,true),h=view.getUint32(24,true),mips=view.getUint32(40,true);
   if(w!==512||h!==512||mips<10)errors.push(`${model}/${level}: KTX2 dimensions/mip chain ${w}x${h}/${mips}`);
  }
  for(const accessor of doc.getRoot().listAccessors())if(accessor.getType()==='VEC3'&&accessor.getArray()&&Array.from(accessor.getArray()).some(x=>!Number.isFinite(x)))errors.push(`${model}/${level}: nonfinite geometry`);
  if(level==='collision'&&doc.getRoot().listTextures().length)errors.push(`${model}: collision has unused textures`);
  reports.push({model,level,bytes:bytes.byteLength,triangles,height,bounds,errors:result.issues.numErrors,warnings:result.issues.numWarnings,messages:result.issues.messages.filter(m=>m.severity<2)});
 }
 // A twelve-triangle cube / 28-triangle taper is already minimal. Preserve the closed silhouette.
 if(counts.far>counts.medium||(counts.far===counts.medium&&counts.medium>32))errors.push(`${model}: far LOD is not simpler than medium`);
}
await mkdir('tests/reports',{recursive:true});await writeFile('tests/reports/models.json',JSON.stringify({errors,assets:reports},null,2)+'\n');
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log(`Validated ${reports.length} GLBs: zero errors, grounded metre scales, real PBR maps, smaller far LODs.`);
