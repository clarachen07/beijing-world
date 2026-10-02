/** Read final compressed Olympic model vertices, roof holes and field orientation. */
import{readFile,writeFile,mkdir}from'node:fs/promises';
import{NodeIO}from'@gltf-transform/core';import{ALL_EXTENSIONS}from'@gltf-transform/extensions';import{MeshoptDecoder}from'meshoptimizer';
const registry=JSON.parse(await readFile('config/landmarks.json','utf8')),io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});await MeshoptDecoder.ready;
const rows=[],errors=[],round=n=>Math.round(n*1e5)/1e5;
const bound=points=>{const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of points)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}return{min,max};};
const inside=(p,a,b,c)=>{const cross=(a,b,c)=>(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]),area=cross(a,b,c);if(Math.abs(area)<1e-8)return false;const u=cross(a,b,p)/area,v=cross(b,c,p)/area,w=cross(c,a,p)/area;return u>=-1e-8&&v>=-1e-8&&w>=-1e-8;};
function axisHole(triangles,axis){
 const other=axis===0?2:0,values=[];
 for(const triangle of triangles)for(let i=0;i<3;i++){
  const a=triangle[i],b=triangle[(i+1)%3],den=b[other]-a[other];
  if(Math.abs(den)<1e-9)continue;const t=-a[other]/den;if(t<0||t>1)continue;const n=a[axis]+t*(b[axis]-a[axis]);if(n>.001)values.push(n);
 }
 return 2*Math.min(...values);
}
for(const id of['birdnest','watercube']){
 const d=registry.landmarks.find(d=>d.id===id);
 for(const level of['near','medium','far']){
  const path='public/'+d.lod[level].replace(/^\.\//,''),doc=await io.readBinary(new Uint8Array(await readFile(path))),primitives=[];
  for(const node of doc.getRoot().listNodes())if(node.getMesh())for(const primitive of node.getMesh().listPrimitives()){
   const m=node.getWorldMatrix(),position=primitive.getAttribute('POSITION'),points=[];
   for(let i=0;i<position.getCount();i++){const p=position.getElement(i,[]);points.push([0,1,2].map(k=>m[k]*p[0]+m[4+k]*p[1]+m[8+k]*p[2]+m[12+k]));}
   const indices=primitive.getIndices()?.getArray()??points.map((_,i)=>i),triangles=[];for(let i=0;i<indices.length;i+=3)triangles.push([points[indices[i]],points[indices[i+1]],points[indices[i+2]]]);
   primitives.push({name:primitive.getMaterial()?.getName()??'',points,triangles});
  }
  const all=primitives.flatMap(p=>p.points),bounds=bound(all),size=bounds.max.map((x,i)=>x-bounds.min[i]),expected=id==='birdnest'?[333,69,294]:[177,31,177],relativeErrorPercent=size.map((x,i)=>100*Math.abs(x-expected[i])/expected[i]);
  if(relativeErrorPercent.some(x=>x>2))errors.push(`${id}/${level}: envelope exceeds2%`);
  const item={model:id,level,path,boundsGLTFMetres:{min:bounds.min.map(round),max:bounds.max.map(round)},envelopeXYZMetres:size.map(round),expectedXYZMetres:expected,envelopeErrorPercent:relativeErrorPercent.map(round)};
  if(id==='birdnest'){
   const top=primitives.find(p=>p.name.startsWith('stadium_roof_etfe')),lower=primitives.find(p=>p.name.startsWith('stadium_acoustic_ptfe')),steel=primitives.find(p=>p.name.startsWith('stadium_painted_steel')),grass=primitives.find(p=>p.name.startsWith('grass'));
   if(!top||!lower||!steel||!grass)throw Error(`Missing architectural layer:${level}`);
   const samples=Array.from({length:32},(_,i)=>[.92*92.65*Math.cos(i*Math.PI/16),60,.92*63.75*Math.sin(i*Math.PI/16)]);
   for(const p of samples)if([...top.triangles,...lower.triangles].some(t=>inside(p,...t)))errors.push(`birdnest/${level}: membrane crosses central roof opening`);
   const structuralRoof=steel.triangles.filter(t=>t.every(v=>v[1]>40)),roofHoleM=[axisHole(structuralRoof,0),axisHole(structuralRoof,2)],expectedHole=[185.3,127.5];
   const holeErrorPercent=roofHoleM.map((x,i)=>100*Math.abs(x-expectedHole[i])/expectedHole[i]);
   if(holeErrorPercent.some(x=>!Number.isFinite(x)||x>2))errors.push(`birdnest/${level}: structural roof opening exceeds2%`);
   const turf=bound(grass.points),turfSize=[turf.max[0]-turf.min[0],turf.max[2]-turf.min[2]];
   if(turfSize.some((x,i)=>Math.abs(x-[110,72][i])>2))errors.push(`birdnest/${level}: turf size or orientation`);
   Object.assign(item,{openingSource:'https://www.engineering.org.cn/sscae/CN/1160100327263363612',openingPart:'central elliptical opening, projected closest high steel boundary on long/short axes',structuralRoofHoleM:roofHoleM.map(round),expectedRoofHoleM:expectedHole,roofHoleErrorPercent:holeErrorPercent.map(round),membraneOpeningSamplesClear:samples.length,membraneInnerEdgeM:[axisHole(top.triangles,0),axisHole(top.triangles,2)].map(round),turfLongXShortZMetres:turfSize.map(round),turfSource:'https://www.n-s.cn/article_8f40ed628459423285ef875561413fb1.html',orientationDegrees:d.rotDeg});
  }
  rows.push(item);
 }
}
await mkdir('tests/reports',{recursive:true});await writeFile('tests/reports/model-olympic-dimensions.json',JSON.stringify({generatedAt:new Date().toISOString(),assetVersion:registry.assetVersion,errors,method:'NodeIO decoded normalized final GLB vertices transformed by world matrices; envelope, projected high steel opening intersections and32 roof-hole samples perLOD. Published primary dimensions are separate constants. This is geometry validation, not surveyed geospatial or per-member fabrication accuracy.',watercubeMaterial:{source:'https://architectureau.com/articles/practice-23/',measuredEnvelopeM:[177,177,31],representativeCellScaleM:32/6,cellScaleAcceptance:'inferred visual representative; actual largest described span9m, no verified universal3–7m range',exactAsBuiltWeairePhelanLayoutVerified:false},assets:rows},null,2)+'\n');
console.log(JSON.stringify({errors,assets:rows.map(r=>({model:r.model,level:r.level,envelope:r.envelopeXYZMetres,hole:r.structuralRoofHoleM,turf:r.turfLongXShortZMetres}))}));if(errors.length)process.exitCode=1;
