/** CPU-only benchmark of real collision tiles and all landmark proxies.
 * Run: node --import tsx scripts/collision-benchmark.mjs
 * Reports host timings; physical phone and frame-loop checks remain separate. */
import * as THREE from 'three';
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {performance} from 'node:perf_hooks';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {Capsule} from 'three/examples/jsm/math/Capsule.js';
import {CollisionWorld} from '../src/collision.ts';
import {buildLandmarks} from '../src/landmarks.ts';
import {latLonToLocal} from '../src/geo.ts';
const manifest=JSON.parse(await readFile('public/data/manifest.json','utf8'));
const registry=JSON.parse(await readFile('config/landmarks.json','utf8'));
const report=[];
function inspect(tree){let nodes=0,references=0,maxDepth=0,stack=[[tree,0]];while(stack.length){const [node,depth]=stack.pop();nodes++;references+=node.triangles.length;maxDepth=Math.max(maxDepth,depth);stack.push(...node.subTrees.map(n=>[n,depth+1]));}return{nodes,references,maxDepth};}
function profile(name,register,tree){const w=new CollisionWorld(),start=performance.now();register(w);const elapsed=performance.now()-start;const acceleration=tree(w);const row={name,buildMs:elapsed,...inspect(acceleration),heapMB:process.memoryUsage().heapUsed/1048576};
 if(name.startsWith('tile:')){
  const g=w.tiles.get('near').data.ground,wx=(g.width-1)*g.step,wz=(g.height-1)*g.step,capsule=new Capsule(),ray=new THREE.Ray(),cap=[],rays=[];
  for(let ix=0;ix<9;ix++)for(let iz=0;iz<9;iz++){
   const x=g.origin[0]+2+(wx-4)*ix/8,z=g.origin[1]+2+(wz-4)*iz/8,h=w.heightAt(x,z);
   capsule.start.set(x,h+.35,z);capsule.end.set(x,h+1.45,z);capsule.radius=.35;
   const a=performance.now();acceleration.capsuleIntersect(capsule);cap.push({ms:performance.now()-a,x,z});
   ray.origin.set(x,h+1.7,z);ray.direction.set(g.origin[0]+wx-x,h+1.7,g.origin[1]+wz-z).sub(ray.origin);if(ray.direction.lengthSq()<.001)ray.direction.set(1,0,0);ray.direction.normalize();
   const b=performance.now();acceleration.rayIntersect(ray);rays.push({ms:performance.now()-b,x,z});
  }
  const summary=items=>{items.sort((a,b)=>a.ms-b.ms);return{p95Ms:items[Math.floor(items.length*.95)].ms,max:items.at(-1),samples:items.length};};
  row.capsuleQueries=summary(cap);row.rayQueries=summary(rays);
 }
 report.push(row);console.log(JSON.stringify(row));w.clear();}
const landscape=buildLandmarks();const palace=landscape.landmarks.find(l=>l.id==='forbidden-city');profile('palace-perimeter',w=>w.addModel('model',palace.group),w=>w.models.get('model').octree);landscape.dispose();
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
for(const d of registry.landmarks){
 const file=d.collision.replace(/^\.\//,'');const bytes=await readFile('public/'+file);const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const [x,z]=latLonToLocal(d.lat,d.lon);gltf.scene.position.set(x,d.elevationM,z);gltf.scene.rotation.y=THREE.MathUtils.degToRad(d.rotDeg);
 profile('model:'+d.id,w=>w.addModel('model',gltf.scene),w=>w.models.get('model').octree);
 gltf.scene.traverse(o=>{if(o.isMesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}});
}
const candidates=[];
for(const descriptor of manifest.tiles.filter(t=>t.lod===0&&t.collision)){
 const data=JSON.parse(gunzipSync(await readFile('public/data/'+descriptor.collision.file)));
 candidates.push({descriptor,data,edges:data.buildings.reduce((sum,b)=>sum+b.polygon.length+(b.holes??[]).reduce((n,r)=>n+r.length,0),0)});
}
candidates.sort((a,b)=>b.edges-a.edges);
for(const {descriptor,data,edges} of candidates.slice(0,6)) profile('tile:'+descriptor.id+':'+descriptor.collision.file+':edges='+edges,w=>w.updateTile('near',data),w=>w.tiles.get('near').octree);
await writeFile(process.env.BJW_COLLISION_REPORT??'artifacts/qa/collision-cpu.json',JSON.stringify({revision:manifest.revision,host:{platform:process.platform,arch:process.arch,node:process.version},scope:'CPU-only; process heap includes all parsed tile candidates, not just collision tree memory.',report},null,2)+'\n');
