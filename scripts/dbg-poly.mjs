// 找出超大绿地多边形的真身
import { readFile } from 'node:fs/promises';
const ORIGIN = { lat: 39.9475, lon: 116.41 };
const M_LAT = 111132, M_LON = 111320 * Math.cos(39.9475 * Math.PI / 180);
const toXZ = (lat, lon) => [(lon - ORIGIN.lon) * M_LON, (ORIGIN.lat - lat) * M_LAT];
import path from 'node:path';
let els = [];
for (let i = 0; i < 6; i++) {
  try {
    const j = JSON.parse(await readFile(`raw/water_green_${i}.json`, 'utf8'));
    els = els.concat(j.elements);
  } catch {}
}
console.log('total', els.length);
for (const el of els) {
  if (el.type === 'relation' && el.members) {
    const outers = el.members.filter(m => m.role === 'outer' && m.geometry);
    const inners = el.members.filter(m => m.role === 'inner' && m.geometry);
    let maxSpan = 0;
    for (const o of outers) {
      for (const g of o.geometry) {
        if (!g) continue;
        const [x, z] = toXZ(g.lat, g.lon);
        maxSpan = Math.max(maxSpan, Math.abs(x), Math.abs(z));
      }
    }
    if (maxSpan > 9000) {
      console.log(`REL ${el.id} ${el.tags?.name || ''} outers=${outers.length} inners=${inners.length} maxSpan=${Math.round(maxSpan)}`);
      // 检查 null geometry
      const nulls = el.members.filter(m => !m.geometry).length;
      if (nulls) console.log(`  !! ${nulls} members without geometry`);
    }
  }
}
