/** Immutable model URLs, removing only known obsolete generated landmark hashes. */
import {readFile,writeFile,readdir,rename,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const registry=JSON.parse(await readFile('config/landmarks.json','utf8'));const dir='public/models/landmarks/';const keep=new Set();const hashes=new Map();
for(const d of registry.landmarks)for(const key of ['near','medium','far','collision']){
 const canonical=`${d.model}${key==='near'?'':'-'+key}.glb`;
 let result=hashes.get(canonical);
 if(!result){
  let bytes;let fresh=true;
  try{bytes=await readFile(dir+canonical);}catch(error){if(error.code!=='ENOENT')throw error;fresh=false;const existing=key==='collision'?d.collision:d.lod[key];bytes=await readFile('public/'+existing.replace(/^\.\//,''));}
  const digest=createHash('sha256').update(bytes).digest('hex').slice(0,10);result=canonical.replace('.glb',`-${digest}.glb`);
  if(fresh)await rename(dir+canonical,dir+result);
  else if(!((key==='collision'?d.collision:d.lod[key]).endsWith(result)))throw new Error('Immutable asset content does not match its hash: '+result);
  hashes.set(canonical,result);
 }
 keep.add(result);if(key==='collision')d.collision='./models/landmarks/'+result;else d.lod[key]='./models/landmarks/'+result;
}
const names=[...new Set(registry.landmarks.map(d=>d.model))];
for(const file of await readdir(dir))if(!keep.has(file)&&names.some(n=>new RegExp('^'+n+'(?:-(?:medium|far|collision))?-[0-9a-f]{10}\\.glb$').test(file)))await unlink(dir+file);
registry.assetVersion=createHash('sha256').update([...keep].sort().join('\n')).digest('hex').slice(0,12);
await writeFile('config/landmarks.json',JSON.stringify(registry,null,2)+'\n');
console.log(`Fingerprinted ${keep.size} assets, version ${registry.assetVersion}.`);
