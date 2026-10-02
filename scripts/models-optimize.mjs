/** Shared KTX2 texture cache + Meshopt. No network used during production builds. */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { dedup, prune, weld, meshopt, listTextureSlots, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, access, stat, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
const root=process.cwd();const dir=path.join(root,'public/models/landmarks');const cache=path.join(root,'artifacts/model-texture-cache');await mkdir(cache,{recursive:true});
const tool=process.env.TOKTX || path.join(root,'tools/bin/toktx');
try { await access(tool); } catch { throw new Error('KTX-Software toktx is required. Set TOKTX=/absolute/path/toktx. Official binaries: https://github.com/KhronosGroup/KTX-Software/releases/tag/v4.4.2 (Darwin-arm64 pkg on Apple Silicon; Linux/Windows equivalents).'); }
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});await MeshoptEncoder.ready;await MeshoptDecoder.ready;
const only=process.argv.find(a=>a.startsWith('--only='))?.split('=')[1]?.split(',');
const run=(args)=>new Promise((resolve,reject)=>{const child=spawn(tool,args,{env:{...process.env,DYLD_LIBRARY_PATH:path.dirname(tool)}});let error='';child.stderr.on('data',c=>error+=c);child.on('error',reject);child.on('exit',code=>code?reject(new Error(error||`toktx ${code}`)):resolve());});
// Hashed URLs are immutable. Optimize freshly exported canonical filenames before fingerprinting.
const files=(await readdir(dir)).filter(f=>f.endsWith('.glb')&&!/-[0-9a-f]{10}\.glb$/.test(f)&&(!only||only.some(n=>f===`${n}.glb`||f.startsWith(`${n}-`))));
const results=[];
for(const file of files){
 const location=path.join(dir,file);const document=await io.read(location);const before=(await stat(location)).size;
 await document.transform(dedup(),weld(),prune());
 const textures=document.getRoot().listTextures();
 if(textures.length)document.createExtension(KHRTextureBasisu).setRequired(true);
 for(const texture of textures){
  if(texture.getMimeType()==='image/ktx2')continue;
  const slots=listTextureSlots(texture);const color=slots.some(s=>/baseColor|emissive/.test(s));const normal=slots.some(s=>/normal/i.test(s));
  const bytes=texture.getImage();if(!bytes)continue;const digest=createHash('sha256').update(bytes).update(color?'srgb':'linear').update(normal?'uastc':'etc1s').digest('hex');
  const ktx=path.join(cache,`${digest}.ktx2`);
  try{await access(ktx);}catch{
   const png=path.join(cache,`${digest}.png`);await writeFile(png,bytes);
   await run(['--t2','--genmipmap','--encode',normal?'uastc':'etc1s','--assign_oetf',color?'srgb':'linear','--assign_primaries','bt709',...(normal?['--uastc_quality','2','--zcmp','18']:['--clevel','1','--qlevel','180']),ktx,png]);
  }
  texture.setImage(await readFile(ktx)).setMimeType('image/ktx2');
 }
 await document.transform(meshopt({encoder:MeshoptEncoder,level:'high',quantizePosition:16,quantizeNormal:12,quantizeTexcoord:16}),prune());
 const output=location+'.tmp.glb';await io.write(output,document);await rename(output,location);
 const bounds=getBounds(document.getRoot().listScenes()[0]);const item={file,bytes:(await stat(location)).size,originalBytes:before,triangles:document.getRoot().listMeshes().reduce((s,m)=>s+m.listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0),textures:textures.length,bounds};
 results.push(item);console.log(`${file}: ${(before/1024).toFixed(0)} -> ${(item.bytes/1024).toFixed(0)} KiB`);
}
await writeFile(path.join(dir,'asset-report.json'),JSON.stringify({generatedAt:new Date().toISOString(),compression:'EXT_meshopt_compression + KHR_texture_basisu (ETC1S base/ORM; UASTC normal), embedded mipmaps',assets:results},null,2)+'\n');
