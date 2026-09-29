import { readFile } from 'node:fs/promises';
const ORIGIN = { lat: 39.9475, lon: 116.41 };
const M_LAT = 111132, M_LON = 111320 * Math.cos(39.9475 * Math.PI / 180);
const toXZ = (lat, lon) => [(lon - ORIGIN.lon) * M_LON, (ORIGIN.lat - lat) * M_LAT];
const j = JSON.parse(await readFile('/tmp/all_wg.json', 'utf8'));
for (const el of j.elements) {
  if (el.id === 14973564 || el.id === 13167265) {
    console.log(`=== REL ${el.id} tags:`, JSON.stringify(el.tags));
    el.members.forEach((m, i) => {
      if (!m.geometry) { console.log(` member${i} role=${m.role} ref=${m.ref} NO GEOM`); return; }
      const pts = m.geometry.map(g => g ? toXZ(g.lat, g.lon) : null);
      const nulls = pts.filter(p => !p).length;
      // 相邻点最大跳变
      let maxJump = 0, jumpAt = -1;
      for (let k = 1; k < pts.length; k++) {
        if (!pts[k] || !pts[k-1]) continue;
        const d = Math.hypot(pts[k][0]-pts[k-1][0], pts[k][1]-pts[k-1][1]);
        if (d > maxJump) { maxJump = d; jumpAt = k; }
      }
      console.log(` member${i} role=${m.role} ref=${m.ref} pts=${pts.length} nulls=${nulls} maxJump=${Math.round(maxJump)}@${jumpAt}`);
      if (m.geometry) console.log(`   first: lat=${m.geometry[0].lat.toFixed(4)},lon=${m.geometry[0].lon.toFixed(4)} last: lat=${m.geometry[m.geometry.length-1].lat.toFixed(4)},lon=${m.geometry[m.geometry.length-1].lon.toFixed(4)}`);
    });
  }
}
