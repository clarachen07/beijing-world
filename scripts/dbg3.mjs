// 复刻烘焙的绿地处理流程，找出产生巨大三角形的多边形
import { readFile } from 'node:fs/promises';
import earcut from 'earcut';
const ORIGIN = { lat: 39.9475, lon: 116.41 };
const M_LAT = 111132, M_LON = 111320 * Math.cos(39.9475 * Math.PI / 180);
const toXZ = (lat, lon) => [(lon - ORIGIN.lon) * M_LON, (ORIGIN.lat - lat) * M_LAT];

let els = [];
for (let i = 0; i < 6; i++) {
  try { els = els.concat(JSON.parse(await readFile(`raw/water_green_${i}.json`, 'utf8')).elements); } catch {}
}
function ringAreaXZ(r) { let a = 0; for (let i = 0; i < r.length; i++) { const [x1,z1]=r[i],[x2,z2]=r[(i+1)%r.length]; a += x1*z2-x2*z1; } return a/2; }
function pointInRing(p, ring) { let ins=false; for (let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,zi]=ring[i],[xj,zj]=ring[j]; if (zi>p[1]!==zj>p[1] && p[0]<((xj-xi)*(p[1]-zi))/(zj-zi)+xi) ins=!ins;} return ins; }

let worst = [];
for (const el of els) {
  const t = el.tags || {};
  const isGreen = t.leisure === 'park' || t.leisure === 'garden' || t.landuse === 'grass' || t.landuse === 'forest' || t.natural === 'wood';
  if (!isGreen) continue;
  const candidates = []; // [outerRing, holes[], src]
  if (el.type === 'way' && el.geometry) {
    candidates.push([el.geometry.map(g => toXZ(g.lat, g.lon)), [], `way ${el.id}`]);
  } else if (el.type === 'relation' && el.members) {
    const outers = el.members.filter(m => m.role === 'outer' && m.geometry).map(m => m.geometry.map(g => toXZ(g.lat, g.lon)));
    const inners = el.members.filter(m => m.role === 'inner' && m.geometry).map(m => m.geometry.map(g => toXZ(g.lat, g.lon)));
    for (const o of outers) candidates.push([o, inners.filter(inn => pointInRing(inn[0], o)), `rel ${el.id}`]);
  }
  for (const [ring, holes, src] of candidates) {
    if (ring.length < 3) continue;
    const area = Math.abs(ringAreaXZ(ring));
    if (area < 500000) continue;
    // 三角化并找最大三角形边长
    const flat = []; for (const [x,z] of ring) flat.push(x, z);
    const hi = []; for (const h of holes) { hi.push(flat.length/2); for (const [x,z] of h) flat.push(x, z); }
    const tris = earcut(flat, hi.length ? hi : undefined);
    let maxEdge = 0;
    for (let k = 0; k < tris.length; k += 3) {
      const i0 = tris[k]*2, i1 = tris[k+1]*2, i2 = tris[k+2]*2;
      const d = (a,b) => Math.hypot(flat[a]-flat[b], flat[a+1]-flat[b+1]);
      maxEdge = Math.max(maxEdge, d(i0,i1), d(i1,i2), d(i2,i0));
    }
    worst.push({ src, name: t.name || '', pts: ring.length, holes: holes.length, area: Math.round(area/10000), tris: tris.length/3, maxEdge: Math.round(maxEdge), tags: Object.keys(t).slice(0,5).join(',') });
  }
}
worst.sort((a,b) => b.maxEdge - a.maxEdge);
for (const w of worst.slice(0, 12)) console.log(JSON.stringify(w));
