import {createHash} from 'node:crypto';
import {readdir,readFile,writeFile,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';

if (await stat('dist/.git').catch(()=>null)) throw new Error('dist 内仍有独立 Git 仓库；请先迁移到 .deployment/gh-pages，避免构建删除历史');
execFileSync(process.execPath,['scripts/validate-assets.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/sources-page.mjs'],{stdio:'inherit'});
const resources = [];
async function walk(directory) {
  for (const item of await readdir(directory,{withFileTypes:true})) {
    const file = path.join(directory,item.name);
    if (item.isDirectory()) await walk(file);
    else if (!file.endsWith('.mp4') && !file.endsWith('/sw.js') && !file.endsWith('/resources.json')) {
      const bytes = await readFile(file); resources.push({file:path.relative('public',file).split(path.sep).join('/'),bytes:bytes.length,hash:createHash('sha256').update(bytes).digest('hex')});
    }
  }
}
await walk('public');
resources.sort((a,b)=>a.file.localeCompare(b.file));
const hash = createHash('sha256').update(JSON.stringify(resources));
for (const file of ['package-lock.json','index.html','vite.config.ts','scripts/sw-template.js']) hash.update(file).update(await readFile(file));
for (const directory of ['src','config']) {
  for (const file of (await readdir(directory)).sort()) { const bytes = await readFile(path.join(directory,file)); hash.update(file).update(bytes); }
}
const revision = hash.digest('hex').slice(0,20);
await writeFile('public/resources.json',JSON.stringify({version:2,revision,resources},null,2)+'\n');
execFileSync('node_modules/.bin/vite',['build'],{stdio:'inherit'});
const shell = ['./','./index.html',...(await readdir('dist/assets')).filter(file=>/\.(js|css)$/.test(file)).map(file=>`./assets/${file}`)];
const worker = (await readFile('scripts/sw-template.js','utf8')).replace('__RELEASE_ID__',revision).replace('__SHELL_FILES__',JSON.stringify(shell));
await writeFile('dist/sw.js',worker);
await writeFile('dist/release.json',JSON.stringify({revision,resources:resources.length,totalBytes:resources.reduce((s,r)=>s+r.bytes,0)},null,2)+'\n');
console.log(`可复现发布包 ${revision}：${resources.length} 项静态资源`);
