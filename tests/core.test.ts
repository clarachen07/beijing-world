import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {decodeMesh,decodeTrees,decodeCarPaths} from '../src/decode.ts';
import {AssetQueue,assetURL,assetDigest,fetchComplete} from '../src/asset-fetch.ts';
import {TrafficSimulation} from '../src/traffic.ts';
import {groundSampler} from '../src/ground.ts';
import {validateManifest} from '../src/loader.ts';
import {chooseTiles} from '../src/tiles.ts';
import type {Manifest,TileDescriptor} from '../src/data.ts';

function packed() {
  const buffer = new ArrayBuffer(47),view = new DataView(buffer); view.setUint32(0,3,true); view.setUint32(4,3,true);
  for(let i=0;i<9;i++) view.setInt16(8+i*2,i,true);
  new Uint8Array(buffer,26,9).fill(127); for(let i=0;i<3;i++)view.setUint32(35+i*4,i,true); return buffer;
}
test('quantized meshes decode unaligned indices and reject truncation, oversized counts and out-of-range indices',()=>{
  const buffer = packed(),mesh = decodeMesh(buffer,'i16c'); assert.equal(mesh.positions[8],Math.fround(1.6)); assert.deepEqual([...mesh.indices],[0,1,2]);
  assert.throws(()=>decodeMesh(buffer.slice(0,-1),'i16c')); const bad = packed(); new DataView(bad).setUint32(43,9,true); assert.throws(()=>decodeMesh(bad,'i16c'));
  const huge = new ArrayBuffer(8); new DataView(huge).setUint32(0,0xffffffff,true); assert.throws(()=>decodeMesh(huge,'i16c'));
  assert.throws(()=>decodeTrees(new ArrayBuffer(3),1)); assert.throws(()=>decodeCarPaths(new ArrayBuffer(3)));
});
test('asset URL maps source assets under public without dot-path mistakes',()=>{
  assert.equal(assetURL('https://cdn.test/gh/repo@abc/public','./data/a.bin.gz'),'https://cdn.test/gh/repo@abc/public/data/a.bin.gz');
  assert.equal(assetURL('','models/a.glb'),'./models/a.glb'); assert.equal(assetURL('https://cdn.test/','https://other.test/a'),'https://other.test/a');
});
test('checksum fallback on phone LAN HTTP matches SHA-256 for short and multi-block assets',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:undefined});
  try {
    for (const size of [0,3,65537]) {
      const bytes=Uint8Array.from({length:size},(_,i)=>i%251);
      assert.equal(await assetDigest(bytes.buffer),createHash('sha256').update(bytes).digest('hex'));
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis,'crypto',descriptor);
    else Reflect.deleteProperty(globalThis,'crypto');
  }
});
test('shared queue caps concurrency and promptly cancels a queued obsolete request',async()=>{
  const queue = new AssetQueue(2); let active = 0,max = 0; const releases:(()=>void)[] = [];
  const task = ()=>queue.run(()=>new Promise<void>(resolve=>{active++;max=Math.max(max,active);releases.push(()=>{active--;resolve();});}));
  const a=task(),b=task(),abort=new AbortController(); const c=queue.run(async()=>{assert.fail('cancelled task ran');},{signal:abort.signal});
  abort.abort(new Error('obsolete')); await assert.rejects(c,/obsolete/); assert.equal(max,2); releases.forEach(release=>release()); await Promise.all([a,b]);
});
test('timeout covers response body and caller cancellation',async()=>{
  const server = createServer((_request,response)=>{response.writeHead(200);response.write('partial');}); server.listen(0,'127.0.0.1'); await once(server,'listening');
  const address=server.address() as {port:number},url=`http://127.0.0.1:${address.port}`;
  try { await assert.rejects(fetchComplete(url,{timeoutMs:40})); const controller=new AbortController(); const pending=fetchComplete(url,{signal:controller.signal}); controller.abort(); await assert.rejects(pending); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
});
test('content-addressed downloads reject corruption before it reaches the decoder',async()=>{
  const valid=Buffer.from('valid asset'),digest=createHash('sha256').update(valid).digest('hex').slice(0,20);
  const server=createServer((request,response)=>response.end(request.url?.includes('broken')?Buffer.from('corrupt'):valid));server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address() as {port:number},base=`http://127.0.0.1:${address.port}`;
  try {assert.deepEqual(Buffer.from(await fetchComplete(`${base}/${digest}.bin`)),valid);await assert.rejects(fetchComplete(`${base}/broken/${digest}.bin`),/完整性/);}
  finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('transport gzip decoding is recognized even when the mesh vertex count starts with 0x1f',async()=>{
  const raw=Buffer.from([31,3,0,0,0,0,0,0]),compressed=gzipSync(raw),digest=createHash('sha256').update(compressed).digest('hex').slice(0,20);
  const server=createServer((_request,response)=>{response.writeHead(200,{'Content-Encoding':'gzip'});response.end(compressed);});server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address() as {port:number};
  try {assert.deepEqual(Buffer.from(await fetchComplete(`http://127.0.0.1:${address.port}/${digest}.bin.gz`)),raw);}
  finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('traffic is independent of seek order and rendering frequency',()=>{
  const paths=[new Float32Array([0,0,80,0,120,50])],sim=new TrafficSimulation(paths,12),a={x:0,z:0,yaw:0},b={x:0,z:0,yaw:0};
  sim.evaluate(4,22.3,a); for(let t=0;t<15;t+=1/60)sim.evaluate(4,t,b); sim.evaluate(4,22.3,b); assert.deepEqual(a,b);
  const other=new TrafficSimulation(paths,12); other.evaluate(4,22.3,b);assert.deepEqual(a,b);
});
const tile=(id:string,lod:0|1|2,size:number,children?:string[]):TileDescriptor=>({id,lod,size,bounds:[-size/2,-size/2,size/2,size/2],ox:0,oz:0,meshes:{},children});
const manifest=():Manifest=>({version:2,revision:'abc',origin:{lat:39.9475,lon:116.41},bounds:[-4000,-4000,4000,4000],tiles:[tile('root',2,8000,['middle']),tile('middle',1,2000,['leaf']),tile('leaf',0,500)],coverage:{boundaryFile:'ring.json',verified:true,scope:'ring',date:'2026-10-02'},sources:[],stats:{}});
test('manifest rejects invalid hierarchy and missing children',()=>{
  assert.equal(validateManifest(manifest()).version,2); const missing=manifest();missing.tiles[0].children=['missing'];assert.throws(()=>validateManifest(missing));
  const cycle=manifest();cycle.tiles[2].children=['root'];assert.throws(()=>validateManifest(cycle));
});
test('hierarchical screen error selects fine near tiles and coarse distant tiles',()=>{
  const camera=new THREE.PerspectiveCamera(55,1,1,50000);camera.position.set(0,300,600);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  assert.deepEqual([...chooseTiles(manifest(),camera,900)],['leaf']);camera.position.set(0,18000,18000);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  assert.deepEqual([...chooseTiles(manifest(),camera,900)],['root']);
});
test('ground sampler interpolates and rejects corrupted grids',()=>{
  const sample=groundSampler({width:2,height:2,origin:[0,0],step:10,heights:[0,10,20,30]});assert.equal(sample(5,5),15);assert.throws(()=>groundSampler({width:2,height:2,origin:[0,0],step:0,heights:[]}));
});
