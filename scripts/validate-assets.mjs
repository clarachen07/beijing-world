import {readFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';

const manifest=JSON.parse(await readFile('public/data/manifest.json','utf8'));
if(manifest.version!==2 || !manifest.coverage?.verified || !manifest.coverage?.boundaryFile) throw new Error('Expected validated Fourth Ring coverage and v2 manifest');
if(Object.values(manifest.coverage.complete??{}).some(value=>value!==true))throw new Error('Incomplete required source snapshot');
const items=new Map();
function add(ref) {if(!ref?.file)return;const previous=items.get(ref.file);if(previous?.hash&&ref.hash&&previous.hash!==ref.hash)throw new Error(`Conflicting hash ${ref.file}`);items.set(ref.file,{...previous,...ref});}
for(const tile of manifest.tiles) {
  if(tile.complete===false)throw new Error(`Incomplete tile ${tile.id}`);
  Object.values(tile.meshes).forEach(add);add(tile.trees);add(tile.ground?.mesh);add(tile.ground?.texture);add(tile.collision);add(tile.sourceIndex);
}
for(const ref of manifest.assets??[])add(ref);add(manifest.cars);add(manifest.trafficGround);
let total=0;
for(const [file,ref] of items) {
  if(path.isAbsolute(file)||file.split('/').includes('..'))throw new Error(`Invalid resource path ${file}`);
  const bytes=await readFile(path.join('public/data',file));total+=bytes.length;
  if(ref.bytes!==undefined&&bytes.length!==ref.bytes)throw new Error(`Wrong length ${file}`);
  if(ref.hash&&createHash('sha256').update(bytes).digest('hex')!==ref.hash)throw new Error(`Wrong hash ${file}`);
  if(ref.v!==undefined){
    const raw=bytes[0]===31&&bytes[1]===139?gunzipSync(bytes):bytes,v=raw.readUInt32LE(0),i=raw.readUInt32LE(4),stride=ref.q==='i16c'||ref.q==='i16w'?6:12;
    if(v!==ref.v||i!==ref.i||raw.length!==8+v*(stride+3)+i*4)throw new Error(`Invalid mesh ${file}`);
    const offset=8+v*(stride+3);for(let n=0;n<i;n++)if(raw.readUInt32LE(offset+n*4)>=v)throw new Error(`Invalid mesh index ${file}`);
  }
}
await access(path.join('public/data',manifest.coverage.boundaryFile));
const registry=JSON.parse(await readFile('config/landmarks.json','utf8'));
for(const landmark of registry.landmarks.filter(lm=>lm.model)) {
  for(const file of [...Object.values(landmark.lod??{}).filter(value=>typeof value==='string'),landmark.collision].filter(Boolean)) await access(path.join('public',file.replace(/^\.\//,'')));
}
console.log(`资产完整性通过：${manifest.tiles.length} 城市分块、${items.size} 数据资源、${registry.landmarks.length} 地标注册，${(total/1048576).toFixed(1)} MiB`);
