// 复刻烘焙的绿地收集逻辑, 找出绘制出全宽绿带的多边形
import { readFile } from 'node:fs/promises';
const ORIGIN = { lat: 39.9475, lon: 116.41 };
const M_LAT = 111132, M_LON = 111320 * Math.cos(39.9475 * Math.PI / 180);
const toXZ = (lat, lon) => [(lon - ORIGIN.lon) * M_LON, (ORIGIN.lat - lat) * M_LAT];
function ringAreaXZ(r) { let a = 0; for (let i = 0; i < r.length; i++) { const [x1,z1]=r[i],[x2,z2]=r[(i+1)%r.length]; a += x1*z2-x2*z1; } return a/2; }

let els = [];
for (let i = 0; i < 6; i++) {
  try { els = els.concat(JSON.parse(await readFile(`raw/water_green_${i}.json`, 'utf8')).elements); } catch {}
}
// 复刻: greenPolys 收集 (addPolygon 成功后 push 原始外环)
function dedupe(ring, minDist = 1.5) {
  const out = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0]-q[0], p[1]-q[1]) > minDist) out.push(p);
  }
  while (out.length > 2 && Math.hypot(out[0][0]-out[out.length-1][0], out[0][1]-out[out.length-1][1]) <= minDist) out.pop();
  return out;
}
const candidates = [];
for (const el of els) {
  const t = el.tags || {};
  let greenKey = null;
  if (t.leisure === 'park' || t.leisure === 'garden') greenKey = 'park';
  else if (t.leisure === 'pitch' || t.leisure === 'golf_course') greenKey = 'pitch';
  else if (t.landuse === 'grass' || t.landuse === 'village_green') greenKey = 'grass';
  else if (t.landuse === 'forest' || t.natural === 'wood') greenKey = 'forest';
  else if (t.landuse === 'meadow') greenKey = 'grass';
  else if (t.landuse === 'recreation_ground') greenKey = 'pitch';
  else if (t.landuse === 'cemetery') greenKey = 'cemetery';
  else if (t.natural === 'scrub') greenKey = 'scrub';
  if (!greenKey || !el.geometry) continue;
  if (el.type === 'way') {
    const ring = dedupe(el.geometry.map(g => toXZ(g.lat, g.lon)), 1.5);
    const area = Math.abs(ringAreaXZ(ring));
    if (area > 4000) candidates.push({ id: el.id, name: t.name || '', key: greenKey, ring, area: area/10000 });
  }
}
console.log('候选绿环:', candidates.length);
// 找横跨全宽 (bbox 宽 > 12km) 的环
for (const c of candidates) {
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for (const [x,z] of c.ring) { if(x<minX)minX=x; if(x>maxX)maxX=x; if(z<minZ)minZ=z; if(z>maxZ)maxZ=z; }
  if (maxX-minX > 12000) {
    console.log(`⚠ 全宽环: id=${c.id} "${c.name}" ${c.key} area=${c.area.toFixed(0)}万m2 宽=${((maxX-minX)/1000).toFixed(1)}km z范围=${(minZ/1000).toFixed(1)}..${(maxZ/1000).toFixed(1)}km 点数=${c.ring.length}`);
    console.log('   前5点:', c.ring.slice(0,5).map(p=>p.map(v=>Math.round(v)).join(',')).join(' | '));
  }
}

// 关系多边形: 每个 outer 环
function pointInRing(p, ring) { let ins=false; for (let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,zi]=ring[i],[xj,zj]=ring[j]; if (zi>p[1]!==zj>p[1] && p[0]<((xj-xi)*(p[1]-zi))/(zj-zi)+xi) ins=!ins;} return ins; }
for (const el of els) {
  const t = el.tags || {};
  if (el.type !== 'relation' || !el.members) continue;
  const isGreen = t.leisure === 'park' || t.leisure === 'garden' || t.landuse === 'grass' || t.landuse === 'forest' || t.natural === 'wood' || t.landuse === 'meadow' || t.landuse === 'recreation_ground';
  if (!isGreen) continue;
  const outers = el.members.filter(m => m.role === 'outer' && m.geometry).map(m => dedupe(m.geometry.map(g => toXZ(g.lat, g.lon)), 1.5));
  for (const o of outers) {
    if (o.length < 3) continue;
    const area = Math.abs(ringAreaXZ(o));
    if (area < 4000) continue;
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for (const [x,z] of o) { if(x<minX)minX=x; if(x>maxX)maxX=x; if(z<minZ)minZ=z; if(z>maxZ)maxZ=z; }
    if (maxX-minX > 8000 || maxZ-minZ > 6000) {
      console.log(`⚠ REL 全宽环: id=${el.id} "${t.name||''}" area=${(area/10000).toFixed(0)}万m2 宽=${((maxX-minX)/1000).toFixed(1)}km 高=${((maxZ-minZ)/1000).toFixed(1)}km z范围=${(minZ/1000).toFixed(1)}..${(maxZ/1000).toFixed(1)}km 点数=${o.length}`);
    }
  }
}
