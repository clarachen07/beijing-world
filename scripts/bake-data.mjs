/**
 * 北京世界 — 数据烘焙脚本
 * raw/*.json (Overpass) → public/data/*.bin.gz + manifest.json
 *
 * 全部数据 © OpenStreetMap contributors (ODbL)
 */
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import earcut from 'earcut';

const RAW = path.resolve(process.cwd(), 'raw');
const OUT = path.resolve(process.cwd(), 'public/data');
const OUT_B = path.join(OUT, 'b');

// ── 与 src/geo.ts 一致的投影 ──────────────────────────────
const ORIGIN = { lat: 39.9475, lon: 116.41 };
const M_LAT = 111132;
const M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const toXZ = (lat, lon) => [(lon - ORIGIN.lon) * M_LON, (ORIGIN.lat - lat) * M_LAT];

const BBOX = { s: 39.865, w: 116.34, n: 40.03, e: 116.48 };

// ── 区域掩膜（lat/lon 矩形：s,w,n,e）─────────────────────
const ZONES = {
  forbiddenCity: { s: 39.9113, w: 116.3902, n: 39.9232, e: 116.4046 },
  templeOfHeaven: { s: 39.8710, w: 116.3990, n: 39.8910, e: 116.4185 },
  cbd: { s: 39.9000, w: 116.4380, n: 39.9250, e: 116.4780 },
  financialStreet: { s: 39.9060, w: 116.3520, n: 39.9270, e: 116.3720 },
  civic: { s: 39.8985, w: 116.3905, n: 39.9080, e: 116.4045 }, // 天安门广场围合（大会堂/国博/纪念堂）
  oldCity: { s: 39.8660, w: 116.3480, n: 39.9620, e: 116.4370 },
  yonghegong: { s: 39.9450, w: 116.4090, n: 39.9512, e: 116.4142 }, // 雍和宫
};
const inZone = (z, lat, lon) => lat >= z.s && lat <= z.n && lon >= z.w && lon <= z.e;

// ── 地名匹配的程序化地标替换（烘焙侧跳过，运行时代码建模）──
const SKIP_NAME_RE = /中国尊|中信大厦|中央电视台|国家体育场|国家游泳中心|国家大剧院|祈年殿|奥林匹克塔|玲珑塔|奥林匹克森林公园观景塔/;
// 名称 → 高度覆盖（米）
const HEIGHT_OVERRIDE = {
  天安门: 34, 正阳门: 41, 钟楼: 48, 鼓楼: 47, 天安门城楼: 34, 箭楼: 32,
};

// 地标净空圆（lat, lon, r米）: 坐标来自 OSM 真实数据, 程序化/GLB 地标替代
const CLEAR_CIRCLES = [
  [39.91582, 116.39078, 78],  // 太和殿
  [39.91395, 116.39088, 40],  // 太和门
  [39.91229, 116.391, 76],    // 午门
  [39.92092, 116.39057, 44],  // 神武门
  [39.9137, 116.39518, 40],   // 东华门
  [39.91337, 116.38669, 40],  // 西华门
  [39.9123, 116.3863, 32], [39.9123, 116.3951, 32],   // 角楼
  [39.9209, 116.3863, 32], [39.9209, 116.3951, 32],   // 角楼
  [39.9072, 116.3911, 105],   // 天安门
  [39.89918, 116.39153, 64],  // 正阳门
  [39.89797, 116.39164, 44],  // 箭楼
  [39.87106, 116.39309, 55],  // 永定门
  [39.9403, 116.3893, 55],    // 鼓楼
  [39.9417, 116.3893, 50],    // 钟楼
  [39.88225, 116.40662, 105], // 祈年殿
  [39.90333, 116.38357, 90],  // 国家大剧院
  [39.91157, 116.46014, 55],  // 中国尊
  [39.9086, 116.4599, 45],    // 国贸三期
  [39.9153, 116.4642, 130],   // 央视大楼
  [39.9929, 116.3966, 210],   // 鸟巢
  [39.99155, 116.3842, 130],  // 水立方
  [40.00655, 116.3879, 55],   // 奥林匹克塔
  [39.9934, 116.3902, 30],    // 玲珑塔
  [39.9254, 116.3908, 55],    // 景山万春亭
  [39.9255, 116.3889, 70],    // 北海白塔
];
const inClearCircle = (lat, lon) =>
  CLEAR_CIRCLES.some(([clat, clon, r]) => {
    const dx = (lon - clon) * M_LON, dz = (lat - clat) * M_LAT;
    return dx * dx + dz * dz < r * r;
  });

// ── 颜色工具 ─────────────────────────────────────────────
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const jitter = (c, h, amt = 14) => {
  const f = 1 + (h - 0.5) * (amt / 128);
  return c.map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
};
const PAL = {
  hutongWall: [hex(0x9a948c), hex(0xa8998a), hex(0x8f8a82), hex(0x9d948a)],
  hutongRoof: hex(0x5e5a54),
  modWall: [hex(0xc8c5bd), hex(0xbfb4a4), hex(0xb4aea6), hex(0xcdc9c0), hex(0xb9b2a4)],
  modRoof: hex(0x8f8a82),
  glassWall: [hex(0x9fb6c4), hex(0xaec6d4), hex(0x8fa8ba), hex(0xb8cdd8)],
  glassRoof: hex(0x5a6e7d),
  fcWall: hex(0x9e2b25),
  fcRoof: hex(0xd9a021),
  thWall: hex(0xa33b2a),
  thRoof: hex(0x2b4d8c),
};

function hash01(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ── 几何工具 ─────────────────────────────────────────────
function ringAreaXZ(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}
/** 规范化：负鞋面积（保证屋顶法线朝上、墙面法线朝外） */
function normalizeRing(ring) {
  if (ringAreaXZ(ring) > 0) ring.reverse();
  return ring;
}
function dedupe(ring, minDist = 1.2) {
  const out = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > minDist) out.push(p);
  }
  while (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= minDist) out.pop();
  return out;
}
const polygonArea = (ring) => Math.abs(ringAreaXZ(ring));

// ── 高度推断 ─────────────────────────────────────────────
function parseNum(v) {
  if (v == null) return NaN;
  const m = String(v).match(/[\d.]+/);
  return m ? parseFloat(m[0]) : NaN;
}
function resolveHeight(tags, id, lat, lon) {
  if (HEIGHT_OVERRIDE[tags.name] != null) return HEIGHT_OVERRIDE[tags.name];
  const h = parseNum(tags.height);
  if (isFinite(h) && h > 1.5) return Math.min(h, 640);
  const lv = parseNum(tags['building:levels']);
  if (isFinite(lv) && lv > 0) return Math.min(lv * 3.3 + 1.2, 640);
  const t = tags.building || tags['building:part'] || 'yes';
  const old = inZone(ZONES.oldCity, lat, lon);
  if (['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'hutong', 'residential'].includes(t)) return old ? 6.5 : 12;
  if (t === 'apartments') return old ? 18 : 30;
  if (['office', 'commercial', 'retail', 'hotel', 'civic', 'public', 'government'].includes(t)) return 18;
  if (['church', 'temple', 'shrine', 'mosque'].includes(t)) return 12;
  if (['garage', 'shed', 'roof', 'hut', 'carport'].includes(t)) return 3.2;
  if (['industrial', 'warehouse', 'service'].includes(t)) return 10;
  return old ? 8 : 15;
}

// ── 配色决策 ─────────────────────────────────────────────
function pickColor(tags, id, lat, lon, isRoof) {
  const name = tags.name || '';
  if (name.includes('中国尊') || name.includes('中信大厦') || name.includes('中央电视台')) return null; // 由程序化地标替换
  const h = hash01(id % 100000);
  // 故宫：红墙金顶
  if (inZone(ZONES.forbiddenCity, lat, lon)) {
    return isRoof ? jitter(PAL.fcRoof, hash01(id % 7777), 10) : jitter(PAL.fcWall, hash01(id % 9999), 8);
  }
  // 天坛：红墙蓝顶
  if (inZone(ZONES.templeOfHeaven, lat, lon)) {
    return isRoof ? PAL.thRoof : jitter(PAL.thWall, hash01(id % 9999), 8);
  }
  // 雍和宫：红墙金顶
  if (inZone(ZONES.yonghegong, lat, lon)) {
    return isRoof ? PAL.fcRoof : jitter(PAL.fcWall, hash01(id % 9999), 8);
  }
  // 天安门广场围合建筑：米白平顶
  if (inZone(ZONES.civic, lat, lon)) {
    return isRoof ? hex(0x8a857c) : jitter(hex(0xd8d2c4), hash01(id % 3333), 6);
  }
  // CBD / 金融街：玻璃幕墙
  if (inZone(ZONES.cbd, lat, lon) || inZone(ZONES.financialStreet, lat, lon)) {
    if (isRoof) return PAL.glassRoof;
    const base = PAL.glassWall[Math.floor(hash01(id % 13131) * PAL.glassWall.length) % PAL.glassWall.length];
    return jitter(base, h, 10);
  }
  const t = tags.building || 'yes';
  // 胡同老城
  if (inZone(ZONES.oldCity, lat, lon)) {
    if (isRoof) return jitter(PAL.hutongRoof, hash01(id % 4242), 12);
    const base = PAL.hutongWall[Math.floor(hash01(id % 8377) * PAL.hutongWall.length) % PAL.hutongWall.length];
    return jitter(base, h, 12);
  }
  if (isRoof) return jitter(PAL.modRoof, hash01(id % 4242), 10);
  const base = PAL.modWall[Math.floor(hash01(id % 8377) * PAL.modWall.length) % PAL.modWall.length];
  return jitter(base, h, 10);
}

// ═══════════════════════════════════════════════════════
function writeMesh(chunk, mode = 'f32') {
  // chunk: { pos, col, idx } → Buffer; mode: f32 | i16c (建筑, 块相对 0.2m) | i16w (世界 0.5m)
  const vCount = chunk.pos.length / 3;
  const iCount = chunk.idx.length;
  const posBytes = mode === 'f32' ? vCount * 12 : vCount * 6;
  const buf = Buffer.alloc(8 + posBytes + vCount * 3 + iCount * 4);
  let off = 0;
  buf.writeUInt32LE(vCount, off); off += 4;
  buf.writeUInt32LE(iCount, off); off += 4;
  if (mode === 'f32') {
    for (let i = 0; i < chunk.pos.length; i++, off += 4) buf.writeFloatLE(chunk.pos[i], off);
  } else {
    const scale = mode === 'i16c' ? 0.2 : 0.5;
    for (let k = 0; k < vCount; k++) {
      for (let a = 0; a < 3; a++) {
        const val = Math.max(-32767, Math.min(32767, Math.round(chunk.pos[k * 3 + a] / scale)));
        buf.writeInt16LE(val, off); off += 2;
      }
    }
  }
  for (let i = 0; i < chunk.col.length; i++, off += 1) buf.writeUInt8(chunk.col[i], off);
  for (let i = 0; i < chunk.idx.length; i++, off += 4) buf.writeUInt32LE(chunk.idx[i], off);
  return buf;
}
const gzip = async (buf) => (await import('node:zlib')).gzipSync(buf, { level: 8 });

async function main() {
  await mkdir(OUT_B, { recursive: true });
  const files = await readdir(RAW).catch(() => []);
  if (!files.length) { console.error('raw/ 目录为空，请先运行 npm run fetch:data'); process.exit(1); }
  const load = async (name) => {
    const f = path.join(RAW, `${name}.json`);
    try {
      const j = JSON.parse(await readFile(f, 'utf8'));
      console.log(`  ✓ ${name}: ${j.elements.length} elements`);
      return j.elements;
    } catch { console.log(`  ⚠ ${name}.json 缺失，跳过`); return []; }
  };

  const stats = {};
  const t0 = Date.now();

  // ═══ 1. 建筑 ═══
  console.log('■ 建筑处理');
  const CELL = 2000; // 米
  const cells = new Map(); // "cx,cz" → { pos:[], col:[], idx:[], ox, oz, vBase }
  const getCell = (x, z) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const key = `${cx},${cz}`;
    let c = cells.get(key);
    if (!c) { c = { pos: [], col: [], idx: [], ox: cx * CELL, oz: cz * CELL, vBase: 0 }; cells.set(key, c); }
    return { c, key };
  };

  let buildings = [];
  for (let i = 0; i < 6; i++) buildings = buildings.concat(await load(`buildings_${i}`));

  // building:part 质心网格（本地米坐标，用于跳过含部件的父轮廓）
  const partGrid = new Map();
  for (const el of buildings) {
    if (el.type === 'way' && el.tags?.['building:part'] && el.geometry) {
      let lat = 0, lon = 0;
      for (const g of el.geometry) { lat += g.lat; lon += g.lon; }
      const n = el.geometry.length;
      const [px, pz] = toXZ(lat / n, lon / n);
      const gx = Math.floor(px / 300), gz = Math.floor(pz / 300);
      const k = `${gx},${gz}`;
      if (!partGrid.has(k)) partGrid.set(k, []);
      partGrid.get(k).push([px, pz]);
    }
  }

  let bCount = 0, skippedParent = 0;
  for (const el of buildings) {
    if (el.type !== 'way' || !el.tags || !(el.tags.building || el.tags['building:part'])) continue;
    if (!el.geometry || el.geometry.length < 4) continue;
    const tags = el.tags;
    let ring = el.geometry.map((g) => toXZ(g.lat, g.lon));
    ring = dedupe(ring, 1.2);
    if (ring.length < 3) continue;
    // 质心（ lat/lon 判断区域）
    let clat = 0, clon = 0;
    for (const g of el.geometry) { clat += g.lat; clon += g.lon; }
    clat /= el.geometry.length; clon /= el.geometry.length;
    if (SKIP_NAME_RE.test(tags.name || '') || SKIP_NAME_RE.test(tags['name:en'] || '')) continue;
    if (inClearCircle(clat, clon)) continue;
    // 父轮廓无高度信息且附近有 building:part → 跳过（避免 z-fighting）
    const isPart = !!tags['building:part'];
    if (!isPart && !tags.height && !tags['building:levels']) {
      const area = polygonArea(ring);
      if (area > 1200) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const [x, z] of ring) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
        let covered = false;
        for (let gx = Math.floor(minX / 300); gx <= Math.floor(maxX / 300) && !covered; gx++)
          for (let gz = Math.floor(minZ / 300); gz <= Math.floor(maxZ / 300) && !covered; gz++) {
            for (const [px, pz] of partGrid.get(`${gx},${gz}`) || []) {
              if (px >= minX - 40 && px <= maxX + 40 && pz >= minZ - 40 && pz <= maxZ + 40) { covered = true; break; }
            }
          }
        if (covered) { skippedParent++; continue; }
      }
    }
    if (polygonArea(ring) < 6) continue;
    normalizeRing(ring);

    const height = resolveHeight(tags, el.id, clat, clon);
    const roofCol = pickColor(tags, el.id, clat, clon, true);
    const wallCol = pickColor(tags, el.id, clat, clon, false);
    if (!roofCol || !wallCol) continue;

    // 屋顶三角化（ earcut 输入 (x,z)，输出为 2D 索引）
    const flat = [];
    for (const [x, z] of ring) flat.push(x, z);
    const tris = earcut(flat);
    const { c, key } = getCell(ring[0][0], ring[0][1]);
    const vb = c.pos.length / 3;

    // 屋顶顶点
    for (const [x, z] of ring) {
      c.pos.push(x - c.ox, height, z - c.oz);
      c.col.push(roofCol[0], roofCol[1], roofCol[2]);
    }
    for (const ti of tris) c.idx.push(vb + ti);

    // 墙面（底边 AO 压暗）
    const wallDim = [Math.round(wallCol[0] * 0.68), Math.round(wallCol[1] * 0.68), Math.round(wallCol[2] * 0.68)];
    for (let i = 0; i < ring.length; i++) {
      const p0 = ring[i], p1 = ring[(i + 1) % ring.length];
      const edgeLen = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (edgeLen < 0.8) continue;
      const b0 = c.pos.length / 3;
      c.pos.push(p0[0] - c.ox, 0, p0[1] - c.oz);
      c.col.push(wallDim[0], wallDim[1], wallDim[2]);
      c.pos.push(p1[0] - c.ox, 0, p1[1] - c.oz);
      c.col.push(wallDim[0], wallDim[1], wallDim[2]);
      c.pos.push(p1[0] - c.ox, height, p1[1] - c.oz);
      c.col.push(wallCol[0], wallCol[1], wallCol[2]);
      c.pos.push(p0[0] - c.ox, height, p0[1] - c.oz);
      c.col.push(wallCol[0], wallCol[1], wallCol[2]);
      c.idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
    }
    bCount++;
  }
  stats.buildings = bCount;
  stats.skippedParents = skippedParent;

  // ═══ 2. 道路 ═══
  console.log('■ 道路处理');
  const ROAD_CLASS = {
    motorway: { w: 46, y: 1.55, c: hex(0x2c2f34) },
    motorway_link: { w: 13, y: 1.45, c: hex(0x2c2f34) },
    trunk: { w: 38, y: 1.5, c: hex(0x2e3136) },
    trunk_link: { w: 12, y: 1.4, c: hex(0x2e3136) },
    primary: { w: 29, y: 1.4, c: hex(0x33363b) },
    primary_link: { w: 11, y: 1.35, c: hex(0x33363b) },
    secondary: { w: 23, y: 1.32, c: hex(0x393c42) },
    secondary_link: { w: 10, y: 1.3, c: hex(0x393c42) },
    tertiary: { w: 17, y: 1.25, c: hex(0x3f434a) },
    residential: { w: 11, y: 1.2, c: hex(0x45484f) },
    unclassified: { w: 9, y: 1.18, c: hex(0x45484f) },
    living_street: { w: 8, y: 1.16, c: hex(0x4d4c48) },
    service: { w: 6, y: 1.14, c: hex(0x4c4f55) },
    pedestrian: { w: 11, y: 1.12, c: hex(0x83756a) },
  };
  let roadEls = [];
  for (let i = 0; i < 6; i++) roadEls = roadEls.concat(await load(`roads_${i}`));  // 道路网格
  const roadMesh = { pos: [], col: [], idx: [] };
  // 主干道车流路径
  const carPaths = [];
  // 路灯点（主干道两侧）
  const lamps = [];
  const pushStrip = (pts, halfW, y, col, mesh) => {
    const n = pts.length;
    if (n < 2) return;
    // 每点法向（相邻段平均 + 斜接限幅）
    const normals = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(n - 1, i + 1)];
      let dx = p1[0] - p0[0], dz = p1[1] - p0[1];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      normals.push([-dz, dx]);
    }
    const vb = mesh.pos.length / 3;
    for (let i = 0; i < n; i++) {
      let [nx, nz] = normals[i];
      // 斜接限幅
      const prev = normals[Math.max(0, i - 1)], next = normals[Math.min(n - 1, i + 1)];
      const dot = prev[0] * next[0] + prev[1] * next[1];
      if (dot < 0.5) { const s = i > 0 && i < n - 1 ? 0.5 : 1; nx *= s; nz *= s; }
      mesh.pos.push(pts[i][0] + nx * halfW, y, pts[i][1] + nz * halfW);
      mesh.pos.push(pts[i][0] - nx * halfW, y, pts[i][1] - nz * halfW);
      mesh.col.push(col[0], col[1], col[2], col[0], col[1], col[2]);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = vb + i * 2;
      mesh.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  let roadCount = 0;
  const plazaRings = []; // 封闭步行广场环（ addPolygon 定义后处理 ）
  for (const el of roadEls) {
    if (el.type !== 'way' || !el.tags?.highway || !el.geometry) continue;
    const cls = ROAD_CLASS[el.tags.highway];
    if (!cls) continue;
    let pts = el.geometry.map((g) => toXZ(g.lat, g.lon));
    if (el.tags.highway === 'pedestrian' && pts.length > 3 &&
        Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 3) {
      const ring = dedupe(pts.slice(0, -1), 1.5);
      if (ring.length >= 3) { plazaRings.push(ring); continue; }
    }
    pts = dedupe(pts, 2.0);
    if (pts.length < 2) continue;
    const layer = Math.max(0, Math.min(4, parseInt(el.tags.layer || '0', 10) || 0));
    const y = cls.y + (el.tags.bridge ? layer * 6 : 0);
    pushStrip(pts, cls.w / 2, y, cls.c, roadMesh);
    roadCount++;
    // 主干道：车流路径 + 路灯
    if (['motorway', 'trunk', 'primary', 'secondary'].includes(el.tags.highway) && pts.length >= 3 && !el.tags.bridge) {
      if (carPaths.length < 600) carPaths.push(pts);
      const halfW = cls.w / 2 + 1.6;
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1];
        const len = Math.hypot(dx, dz);
        acc += len;
        if (acc > 32) {
          acc = 0;
          const nx = -dz / len, nz = dx / len;
          const side = lamps.length % 2 === 0 ? 1 : -1;
          lamps.push(pts[i][0] + nx * halfW * side, cls.y + 0.5, pts[i][1] + nz * halfW * side);
        }
      }
    }
  }
  stats.roads = roadCount;

  // ═══ 2.5 胡同院落填充（二环内沿街生成合院建筑，解决"废墟感"）═══
  console.log('■ 胡同院落填充');
  const oldCity = ZONES.oldCity;
  const inOldCity = (x, z) => {
    const lat = ORIGIN.lat - z / M_LAT, lon = ORIGIN.lon + x / M_LON;
    return inZone(oldCity, lat, lon);
  };
  // 占用网格（24m 格）: OSM 建筑足迹 bbox 占位 + 净空圆
  const occ = new Set();
  const occKey = (x, z) => `${Math.floor(x / 24)},${Math.floor(z / 24)}`;
  for (const el of buildings) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 4) continue;
    if (!(el.tags?.building || el.tags?.['building:part'])) continue;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let clat = 0, clon = 0;
    for (const g of el.geometry) {
      const [x, z] = toXZ(g.lat, g.lon);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      clat += g.lat; clon += g.lon;
    }
    clat /= el.geometry.length; clon /= el.geometry.length;
    if (inClearCircle(clat, clon)) continue;
    for (let gx = Math.floor(minX / 24); gx <= Math.floor(maxX / 24); gx++)
      for (let gz = Math.floor(minZ / 24); gz <= Math.floor(maxZ / 24); gz++)
        occ.add(`${gx},${gz}`);
  }
  let infillCount = 0;
  for (const el of roadEls) {
    if (el.type !== 'way' || !el.tags?.highway || !el.geometry) continue;
    const cls = el.tags.highway;
    if (!['residential', 'unclassified', 'living_street', 'service', 'tertiary'].includes(cls)) continue;
    let pts = dedupe(el.geometry.map((g) => toXZ(g.lat, g.lon)), 2.0);
    if (pts.length < 2) continue;
    // 只处理老城内为主的部分
    if (!pts.some((p) => inOldCity(p[0], p[1]))) continue;
    const halfW = (ROAD_CLASS[cls]?.w || 9) / 2 + 4.2;
    let acc = 6;
    for (let i = 1; i < pts.length && infillCount < 48000; i++) {
      const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const ux = dx / len, uz = dz / len;
      let s = 0;
      while (s < len && infillCount < 48000) {
        const step = 11 + hash01(i * 31.7 + s * 3.1) * 17; // 11-28m 步长, 打破规律行
        if (s + step > len) break;
        s += step;
        if (hash01(s * 7.7 + i * 1.3) > 0.72) continue; // 28% 空缺: 院落间留空地/树
        
        const cx = x0 + ux * s, cz = z0 + uz * s;
        if (!inOldCity(cx, cz)) continue;
        for (const side of (hash01(cx * 0.37 + cz) > 0.5 ? [1, -1] : [-1, 1])) {
          const off = halfW + 2.5 + hash01(cx + cz + side) * 3.0;
          const bx = cx - uz * off * side, bz = cz + ux * off * side;
          const key = occKey(bx, bz);
          if (occ.has(key)) continue;
          occ.add(key);
          if (inClearCircle(ORIGIN.lat - bz / M_LAT, ORIGIN.lon + bx / M_LON)) { occ.delete(key); continue; }
          // 院落建筑: 沿街向长 8-15, 进深 6-10, 高 4-9 (少量 2 层)
          const along = 6.5 + hash01(bx * 1.3 + bz * 2.1) * 11;
          const deep = 5 + hash01(bx * 2.7 + bz) * 5.5;
          const hgt = hash01(bz * 1.9 + bx * 0.7) > 0.8 ? 7.5 + hash01(bx) * 3.5 : 3.8 + hash01(bx + 5) * 3.5;
          const wallCol = PAL.hutongWall[Math.floor(hash01(bx * 3.1 + bz * 7.7) * PAL.hutongWall.length) % PAL.hutongWall.length];
          const roofCol = [Math.round((PAL.hutongRoof[0] + wallCol[0]) / 2), Math.round((PAL.hutongRoof[1] + wallCol[1]) / 2), Math.round((PAL.hutongRoof[2] + wallCol[2]) / 2)];
          // 轴对齐近似 (避免旋转三角化的复杂性): 取长边朝向
          const alongX = Math.abs(ux) > Math.abs(uz);
          const sx = alongX ? along : deep;
          const sz = alongX ? deep : along;
          const { c, key: ckey } = getCell(bx, bz);
          const vb = c.pos.length / 3;
          // 简化: 只生成墙+屋顶盒 (8 顶点 12 三角)
          const x0b = bx - sx / 2, x1b = bx + sx / 2, z0b = bz - sz / 2, z1b = bz + sz / 2;
          const corners = [[x0b, z0b], [x1b, z0b], [x1b, z1b], [x0b, z1b]];
          // 墙 (4 面)
          for (let wi = 0; wi < 4; wi++) {
            const [ax, az] = corners[wi], [bxx, bzz] = corners[(wi + 1) % 4];
            const b0 = c.pos.length / 3;
            c.pos.push(ax - c.ox, 0, az - c.oz); c.col.push(...wallCol.map((v) => Math.round(v * 0.7)));
            c.pos.push(bxx - c.ox, 0, bzz - c.oz); c.col.push(...wallCol.map((v) => Math.round(v * 0.7)));
            c.pos.push(bxx - c.ox, hgt, bzz - c.oz); c.col.push(...wallCol);
            c.pos.push(ax - c.ox, hgt, az - c.oz); c.col.push(...wallCol);
            c.idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
          }
          // 屋顶
          {
            const f = [];
            for (const [px, pz] of corners) f.push(px, pz);
            const tris = earcut(f);
            const rb = c.pos.length / 3;
            for (let ri = 0; ri < 4; ri++) {
              c.pos.push(corners[ri][0] - c.ox, hgt, corners[ri][1] - c.oz);
              c.col.push(...roofCol);
            }
            for (const ti of tris) c.idx.push(rb + ti);
          }
          infillCount++;
        }
      }
    }
  }
  stats.infill = infillCount;
  console.log(`  院落填充: ${infillCount}`);

  // ═══ 3. 水系与绿地 ═══
  console.log('■ 水系与绿地');
  let wgEls = [];
  for (let i = 0; i < 6; i++) wgEls = wgEls.concat(await load(`water_green_${i}`));
  const waterMesh = { pos: [], col: [], idx: [] };
  const greenMesh = { pos: [], col: [], idx: [] };
  const greenPolys = []; // [ring] 用于树种散布
  const WATER_C = hex(0x2a5f8a), WATER2 = hex(0x234f76);
  const GREEN_C = {
    park: hex(0x446b33), forest: hex(0x365628), grass: hex(0x4f7439),
    scrub: hex(0x3f6230), pitch: hex(0x426f3a), garden: hex(0x4d7238), cemetery: hex(0x406034), beach: hex(0xcbb98a),
  };
function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Sutherland–Hodgman 裁剪：把环裁剪到城市范围（防止关系多边形拖出几十公里的长条）
 * 严格防零除与 NaN —— NaN 顶点会被 GPU 渲染成从原点辐射的巨大三角（"绿色阴影"元凶） */
function clipRing(ring) {
  const X = 8000, ZN = -9600, ZS = 9300; // 北界覆盖奥森(数据北缘-9170), 南界收到数据边缘+余量
  const planes = [
    { inside: (p) => p[0] >= -X, inter: (a, b) => { const d = b[0] - a[0]; if (Math.abs(d) < 1e-9) return null; const t = (-X - a[0]) / d; return [-X, a[1] + t * (b[1] - a[1])]; } },
    { inside: (p) => p[0] <= X, inter: (a, b) => { const d = b[0] - a[0]; if (Math.abs(d) < 1e-9) return null; const t = (X - a[0]) / d; return [X, a[1] + t * (b[1] - a[1])]; } },
    { inside: (p) => p[1] >= ZN, inter: (a, b) => { const d = b[1] - a[1]; if (Math.abs(d) < 1e-9) return null; const t = (ZN - a[1]) / d; return [a[0] + t * (b[0] - a[0]), ZN]; } },
    { inside: (p) => p[1] <= ZS, inter: (a, b) => { const d = b[1] - a[1]; if (Math.abs(d) < 1e-9) return null; const t = (ZS - a[1]) / d; return [a[0] + t * (b[0] - a[0]), ZS]; } },
  ];
  const finite = (p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  let out = ring.filter(finite);
  for (const pl of planes) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      const cIn = pl.inside(cur), pIn = pl.inside(prev);
      if (cIn) {
        if (!pIn) { const ip = pl.inter(prev, cur); if (finite(ip)) out.push(ip); }
        out.push(cur);
      } else if (pIn) {
        const ip = pl.inter(prev, cur);
        if (finite(ip)) out.push(ip);
      }
    }
    if (!out.length) break;
  }
  return out;
}
/** 环是否与城市范围有交集（丢弃 relation 带出的远端几何） */
function ringInExtent(ring) {
  const X = 8000, ZN = -9600, ZS = 9300;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return maxX > -X && minX < X && maxZ > ZN && minZ < ZS;
}

function clipPolylineRuns(pts) {
  // 把折线裁剪进城市窗口，返回若干段（每段 ≥2 点）
  const X = 8000, ZN = -9600, ZS = 9300;
  const inside = (p) => p[0] >= -X && p[0] <= X && p[1] >= ZN && p[1] <= ZS;
  const intersect = (a, b) => {
    let lo = a.slice(), hi = b.slice();
    for (let k = 0; k < 24; k++) {
      const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
      if (inside(mid)) lo = mid; else hi = mid;
    }
    return lo;
  };
  const runs = [];
  let cur = [];
  let prev = null;
  for (const p of pts) {
    if (inside(p)) {
      if (cur.length === 0 && prev && !inside(prev)) cur.push(intersect(p, prev));
      cur.push(p);
    } else if (cur.length) {
      cur.push(intersect(cur[cur.length - 1], p));
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    }
    prev = p;
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

const addPolygon = (mesh, rings, col) => {
    // rings[0] 外环，其余为洞；先裁剪到城市范围
    const outerN = dedupe(rings[0], 1.5);
    if (outerN.length < 3) return false;
    const outer = normalizeRing(clipRing(outerN));
    if (outer.length < 3) return false;
    const flat = [];
    const holesIdx = [];
    for (const [x, z] of outer) flat.push(x, z);
    for (let h = 1; h < rings.length; h++) {
      const holeN = dedupe(rings[h], 1.5);
      if (holeN.length < 3) continue;
      if (!pointInRing(holeN[0], outer)) continue; // 洞不在裁剪后的外环内则丢弃
      const hole = normalizeRing(clipRing(holeN));
      if (hole.length < 3) continue;
      hole.reverse(); // 洞取反绕向
      holesIdx.push(flat.length / 2);
      for (const [x, z] of hole) flat.push(x, z);
    }
    // 顶点有限性校验
    for (let k = 0; k < flat.length; k++) if (!Number.isFinite(flat[k])) return false;
    const tris = earcut(flat, holesIdx.length ? holesIdx : undefined);
    if (!tris.length) return false;
    const nv = flat.length / 2;
    for (const ti of tris) if (ti >= nv) return false; // 索引越界防护
    const vb = mesh.pos.length / 3;
    for (let i = 0; i < nv; i++) {
      mesh.pos.push(flat[i * 2], mesh === waterMesh ? 1.0 : 0.6, flat[i * 2 + 1]);
      mesh.col.push(col[0], col[1], col[2]);
    }
    for (const ti of tris) mesh.idx.push(vb + ti);
    return true;
  };
  /** 写盘前的网格体检: 拒绝非有限顶点/越界索引 */
  const meshSanity = (name, mesh) => {
    let bad = 0;
    for (let k = 0; k < mesh.pos.length; k++) if (!Number.isFinite(mesh.pos[k])) bad++;
    const nv = mesh.pos.length / 3;
    for (const ti of mesh.idx) if (ti >= nv) bad++;
    if (bad) console.log(`  ⚠ ${name}: ${bad} 个异常值已跳过写入`);
    return bad === 0;
  };

  let waterCount = 0, greenCount = 0;
  for (const el of wgEls) {
    if (!el.tags || !el.geometry) continue;
    const t = el.tags;
    const isWater = t.natural === 'water' || ['riverbank', 'dock'].includes(t.waterway) || t.water;
    const isWaterway = ['river', 'canal', 'stream'].includes(t.waterway);
    let greenKey = null;
    if (t.leisure === 'park' || t.leisure === 'garden') greenKey = 'park';
    else if (t.leisure === 'pitch' || t.leisure === 'golf_course') greenKey = 'pitch';
    else if (t.landuse === 'grass' || t.landuse === 'village_green') greenKey = 'grass';
    else if (t.landuse === 'forest' || t.natural === 'wood') greenKey = 'forest';
    else if (t.landuse === 'meadow') greenKey = 'grass';
    else if (t.landuse === 'recreation_ground') greenKey = 'pitch';
    else if (t.landuse === 'cemetery') greenKey = 'cemetery';
    else if (t.natural === 'scrub') greenKey = 'scrub';
    else if (t.natural === 'beach') greenKey = 'beach';
    if (!isWater && !isWaterway && !greenKey) continue;

    const geometryRings = [];
    if (el.type === 'way') {
      const ring = el.geometry.map((g) => toXZ(g.lat, g.lon));
      if (isWaterway && isWater !== true) {
        // 线状河流 → 窄带（裁剪到城市范围内，分段）
        const pts = dedupe(ring, 2);
        const width = { river: 26, canal: 14, stream: 6 }[t.waterway] || 10;
        for (const run of clipPolylineRuns(pts)) {
          pushStrip(run, width / 2, 1.0, WATER_C, waterMesh);
          waterCount++;
        }
        continue;
      }
      geometryRings.push(ring);
    } else if (el.type === 'relation' && el.members) {
      // multipolygon：outer/inner —— 每个 inner 只分配给包含它的 outer
      const outers = [], inners = [];
      for (const m of el.members) {
        if (m.role === 'outer' && m.geometry) outers.push(m.geometry.map((g) => toXZ(g.lat, g.lon)));
        else if (m.role === 'inner' && m.geometry) inners.push(m.geometry.map((g) => toXZ(g.lat, g.lon)));
      }
      for (const o of outers) {
        const own = inners.filter((inn) => inn.length && pointInRing(inn[0], o));
        geometryRings.push([o, ...own]);
      }
    }
    for (const rings of geometryRings) {
      if (rings.length && Array.isArray(rings[0][0])) {
        // rings = [outer, ...inners]
        if (isWater) { if (addPolygon(waterMesh, rings, WATER_C)) waterCount++; }
        else {
          const col = GREEN_C[greenKey] || GREEN_C.park;
          if (addPolygon(greenMesh, rings, col)) {
            greenCount++;
            const outerRing = rings[0];
            if (polygonArea(outerRing) > 4000) greenPolys.push(outerRing);
          }
        }
      } else {
        // 单环
        if (isWater) { if (addPolygon(waterMesh, [rings], WATER_C)) waterCount++; }
        else {
          const col = GREEN_C[greenKey] || GREEN_C.park;
          if (addPolygon(greenMesh, [rings], col)) {
            greenCount++;
            if (polygonArea(rings) > 4000) greenPolys.push(rings);
          }
        }
      }
    }
  }
  stats.water = waterCount; stats.green = greenCount;

  // ═══ 3.5 步行广场 → 铺装面片（天安门广场等）═══
  const plazaPolys = [];
  for (const ring of plazaRings) {
    if (addPolygon(roadMesh, [ring], hex(0x9a938a))) {
      plazaPolys.push(ring);
      roadCount++;
    }
  }
  console.log(`  广场面片: ${plazaPolys.length}`);

  // ═══ 4. 铁路 ═══
  console.log('■ 铁路');
  const railEls = await load('rail');
  for (const el of railEls) {
    if (el.type !== 'way' || !el.geometry) continue;
    const pts = dedupe(el.geometry.map((g) => toXZ(g.lat, g.lon)), 2.5);
    if (pts.length < 2) continue;
    const layer = Math.max(0, Math.min(4, parseInt(el.tags?.layer || '0', 10) || 0));
    pushStrip(pts, 3.2, 1.0 + (el.tags?.bridge ? layer * 6 : 0), hex(0x2f3236), roadMesh);
  }

  // ═══ 5. 树木 ═══
  console.log('■ 树木');
  const treeEls = await load('trees');
  const treeList = []; // [x, z, scale]
  for (const el of treeEls) {
    if (el.type !== 'node') continue;
    const [x, z] = toXZ(el.lat, el.lon);
    treeList.push([x, z, 3.5 + hash01(el.id) * 3.5]);
  }
  // 公园内散布
  const areas = greenPolys.map((r) => polygonArea(r));
  const totalArea = areas.reduce((s, a) => s + a, 0);
  const SCATTER = 17000;
  if (totalArea > 0) {
    greenPolys.forEach((ring, idx) => {
      const n = Math.floor((areas[idx] / totalArea) * SCATTER);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
      let placed = 0, tries = 0;
      while (placed < n && tries < n * 4) {
        tries++;
        const x = minX + hash01(tries * 3.7 + idx * 13.1) * (maxX - minX);
        const z = minZ + hash01(tries * 7.3 + idx * 29.7) * (maxZ - minZ);
        // 点在多边形内（射线法）
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, zi] = ring[i], [xj, zj] = ring[j];
          if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
        }
        if (!inside) continue;
        const lat = ORIGIN.lat - z / M_LAT, lon = ORIGIN.lon + x / M_LON;
        if (inClearCircle(lat, lon)) continue;
        treeList.push([x, z, 3.5 + hash01(tries * 1.7 + idx) * 4]);
        placed++;
      }
    });
  }
  stats.trees = treeList.length;

  // ═══ 6. 输出 ═══
  console.log('■ 写出二进制');
  const manifest = { version: 1, stats, buildings: { chunks: [] } };
  const chunkKeys = [...cells.keys()].sort();
  let ci = 0;
  for (const key of chunkKeys) {
    const c = cells.get(key);
    if (!c.idx.length) continue;
    const buf = writeMesh(c, 'i16c');
    const gz = await gzip(buf);
    const file = `b/b${String(ci).padStart(2, '0')}.bin.gz`;
    await writeFile(path.join(OUT, file), gz);
    manifest.buildings.chunks.push({ file, ox: c.ox, oz: c.oz, v: c.pos.length / 3, i: c.idx.length, q: 'i16c' });
    console.log(`  ${file}: ${c.pos.length / 3} verts, ${(gz.length / 1048576).toFixed(2)} MB`);
    ci++;
  }
  const emitMesh = async (name, mesh) => {
    if (!mesh.idx.length || !meshSanity(name, mesh)) {
      if (mesh.idx.length) console.log(`  ⚠ ${name} 网格未通过体检, 已跳过`);
      manifest[name] = { file: '', v: 0, i: 0 };
      return;
    }
    const buf = writeMesh(mesh, 'i16w');
    const gz = await gzip(buf);
    const file = `b/${name}.bin.gz`;
    await writeFile(path.join(OUT, file), gz);
    manifest[name] = { file, v: mesh.pos.length / 3, i: mesh.idx.length, q: 'i16w' };
    console.log(`  ${file}: ${mesh.pos.length / 3} verts, ${(gz.length / 1048576).toFixed(2)} MB`);
  };
  await emitMesh('roads', roadMesh);
  await emitMesh('water', waterMesh);
  await emitMesh('green', greenMesh);

  // 路灯（Points：positions + colors，无索引）
  {
    const lampMesh = { pos: lamps, col: [], idx: [] };
    for (let i = 0; i < lamps.length / 3; i++) lampMesh.col.push(255, 214, 150);
    if (lamps.length) {
      const buf = writeMesh(lampMesh, 'i16w');
      const gz = await gzip(buf);
      await writeFile(path.join(OUT, 'b/streetlights.bin.gz'), gz);
      manifest.streetlights = { file: 'b/streetlights.bin.gz', v: lamps.length / 3, i: 0, q: 'i16w' };
      console.log(`  路灯点: ${lamps.length / 3}`);
    } else manifest.streetlights = { file: '', v: 0, i: 0 };
  }

  // 树木
  {
    const buf = Buffer.alloc(4 + treeList.length * 12);
    buf.writeUInt32LE(treeList.length, 0);
    let off = 4;
    for (const [x, z, s] of treeList) { buf.writeFloatLE(x, off); buf.writeFloatLE(z, off + 4); buf.writeFloatLE(s, off + 8); off += 12; }
    const gz = await gzip(buf);
    await writeFile(path.join(OUT, 'b/trees.bin.gz'), gz);
    manifest.trees = { file: 'b/trees.bin.gz', count: treeList.length };
    console.log(`  树木: ${treeList.length}`);
  }

  // 车流路径
  {
    const paths = carPaths.slice(0, 500);
    let size = 4;
    for (const p of paths) size += 4 + p.length * 8;
    const buf = Buffer.alloc(size);
    buf.writeUInt32LE(paths.length, 0);
    let off = 4;
    for (const p of paths) {
      buf.writeUInt32LE(p.length, off); off += 4;
      for (const [x, z] of p) { buf.writeFloatLE(x, off); buf.writeFloatLE(z, off + 4); off += 8; }
    }
    const gz = await gzip(buf);
    await writeFile(path.join(OUT, 'b/cars.bin.gz'), gz);
    manifest.cars = { file: 'b/cars.bin.gz', count: paths.length };
    console.log(`  车流路径: ${paths.length}`);
  }

  // ═══ 7. 地面纹理烘焙（城市肌理: 街区+建筑足迹+绿地+水面+道路）═══
  console.log('■ 地面纹理烘焙');
  {
    const GW = 4096, GH = 5146; // x ∈ [-8000,8000], z ∈ [-9600,10500]
    const X0 = -8000, Z0 = -9600, SXm = 16000 / GW, SZm = 20100 / GH;
    const px = Buffer.alloc(GW * GH * 3);
    const setPx = (wx, wz, r, g, b) => {
      const ix = Math.floor((wx - X0) / SXm), iz = Math.floor((wz - Z0) / SZm);
      if (ix < 0 || ix >= GW || iz < 0 || iz >= GH) return;
      const o = (iz * GW + ix) * 3;
      px[o] = r; px[o + 1] = g; px[o + 2] = b;
    };

    const checkGreen = (stage) => {
      let c = 0, first = -1;
      for (let k = 0; k < GW * GH; k++) {
        if (px[k * 3] < 30 && px[k * 3 + 1] > 100 && px[k * 3 + 2] < 40) { c++; if (first < 0) first = k; }
      }
      if (c > 1000) console.log(`  ⚠ [${stage}] 纯绿像素 ${c} 首个@${first} (iz=${Math.floor(first / GW)}, ix=${first % GW})`);
      else console.log(`  ✓ [${stage}] 无纯绿污染 (${c})`);
    };

    // 1) 底色街区
    for (let iz = 0; iz < GH; iz++) {
      for (let ix = 0; ix < GW; ix++) {
        const wx = X0 + ix * SXm, wz = Z0 + iz * SZm;
        const h = hash01(wx * 0.011 + wz * 0.017);
        const v = 150 + Math.floor(h * 24);
        const o = (iz * GW + ix) * 3;
        px[o] = v; px[o + 1] = v - 7; px[o + 2] = v - 16;
      }
    }
    const fillPoly = (ring, r, g, b, jitterAmt = 0) => {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of ring) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      const ix0 = Math.max(0, Math.floor((minX - X0) / SXm) - 1), ix1 = Math.min(GW - 1, Math.ceil((maxX - X0) / SXm) + 1);
      const iz0 = Math.max(0, Math.floor((minZ - Z0) / SZm) - 1), iz1 = Math.min(GH - 1, Math.ceil((maxZ - Z0) / SZm) + 1);
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const wx = X0 + ix * SXm, wz = Z0 + iz * SZm;
          let inside = false;
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, zi] = ring[i], [xj, zj] = ring[j];
            if (zi > wz !== zj > wz && wx < ((xj - xi) * (wz - zi)) / (zj - zi) + xi) inside = !inside;
          }
          if (!inside) continue;
          const h = jitterAmt ? (hash01(wx * 0.05 + wz * 0.08) - 0.5) * jitterAmt : 0;
          setPx(wx, wz, Math.max(0, Math.min(255, r + h)), Math.max(0, Math.min(255, g + h)), Math.max(0, Math.min(255, b + h)));
        }
      }
    };
    const thickLine = (x0, z0, x1, z1, halfWm, r, g, b) => {
      const minX = Math.min(x0, x1) - halfWm, maxX = Math.max(x0, x1) + halfWm;
      const minZ = Math.min(z0, z1) - halfWm, maxZ = Math.max(z0, z1) + halfWm;
      const ix0 = Math.max(0, Math.floor((minX - X0) / SXm)), ix1 = Math.min(GW - 1, Math.ceil((maxX - X0) / SXm));
      const iz0 = Math.max(0, Math.floor((minZ - Z0) / SZm)), iz1 = Math.min(GH - 1, Math.ceil((maxZ - Z0) / SZm));
      const dx = x1 - x0, dz = z1 - z0;
      const len2 = dx * dx + dz * dz || 1;
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const wx = X0 + ix * SXm, wz = Z0 + iz * SZm;
          let t = ((wx - x0) * dx + (wz - z0) * dz) / len2;
          t = Math.max(0, Math.min(1, t));
          const cx = x0 + dx * t, cz = z0 + dz * t;
          if (Math.hypot(wx - cx, wz - cz) <= halfWm) setPx(wx, wz, r, g, b);
        }
      }
    };
    checkGreen('底色');
    // 2) 建筑足迹（与底色 55% 混合, 低对比防止远景缩小采样 moiré 条纹）
    let painted = 0;
    const fillPolyC = (ring, r, g, b, jitterAmt, alpha) => {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of ring) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      const ix0 = Math.max(0, Math.floor((minX - X0) / SXm) - 1), ix1 = Math.min(GW - 1, Math.ceil((maxX - X0) / SXm) + 1);
      const iz0 = Math.max(0, Math.floor((minZ - Z0) / SZm) - 1), iz1 = Math.min(GH - 1, Math.ceil((maxZ - Z0) / SZm) + 1);
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const wx = X0 + ix * SXm, wz = Z0 + iz * SZm;
          let inside = false;
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, zi] = ring[i], [xj, zj] = ring[j];
            if (zi > wz !== zj > wz && wx < ((xj - xi) * (wz - zi)) / (zj - zi) + xi) inside = !inside;
          }
          if (!inside) continue;
          const h = jitterAmt ? (hash01(wx * 0.05 + wz * 0.08) - 0.5) * jitterAmt : 0;
          const o = (iz * GW + ix) * 3;
          px[o] = Math.max(0, Math.min(255, Math.round(px[o] * (1 - alpha) + (r + h) * alpha)));
          px[o + 1] = Math.max(0, Math.min(255, Math.round(px[o + 1] * (1 - alpha) + (g + h) * alpha)));
          px[o + 2] = Math.max(0, Math.min(255, Math.round(px[o + 2] * (1 - alpha) + (b + h) * alpha)));
        }
      }
    };
    for (const el of buildings) {
      if (el.type !== 'way' || !el.geometry || el.geometry.length < 4) continue;
      if (!(el.tags?.building || el.tags?.['building:part'])) continue;
      const ring = el.geometry.map((g2) => toXZ(g2.lat, g2.lon));
      fillPolyC(ring, 112, 106, 100, 8, 0.5);
      painted++;
    }
    checkGreen('建筑足迹后');
    // 3) 绿地 / 水面 / 广场（环先裁剪到数据范围, 防止数据外出现大片纯色）
    const paintStat = [];
    for (let gi = 0; gi < greenPolys.length; gi++) {
      const cr = clipRing(greenPolys[gi]);
      if (cr.length < 3) continue;
      const before = JSON.stringify([px[0], px[100000], px[500000]]);
      let cnt = 0;
      // 包装 fillPoly 统计: 直接内联计数
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of cr) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
      fillPoly(cr, 64, 100, 48, 14);
      paintStat.push({ gi, w: Math.round((maxX - minX) / 100) / 10, h: Math.round((maxZ - minZ) / 100) / 10, zMax: Math.round(maxZ) });
    }
    paintStat.sort((a, b) => b.w * b.h - a.w * a.h);
    console.log('  最大绿地绘制包络:', JSON.stringify(paintStat.slice(0, 5)));
    for (const ring of plazaPolys) {
      const cr = clipRing(ring);
      if (cr.length >= 3) fillPoly(cr, 158, 152, 142, 8);
    }
    checkGreen('绿地水面广场后');
    // 水面需要重取 — 从 water mesh 顶点反推太贵, 直接重画主要面: 用 wgEls 再次遍历
    for (const el of wgEls) {
      const t = el.tags || {};
      const isWater = t.natural === 'water' || ['riverbank', 'dock'].includes(t.waterway) || t.water;
      const isWaterway = ['river', 'canal', 'stream'].includes(t.waterway);
      if (!isWater && !isWaterway) continue;
      if (el.type === 'way' && el.geometry) {
        const ring = el.geometry.map((g2) => toXZ(g2.lat, g2.lon));
        if (isWaterway && !isWater) {
          for (const run of clipPolylineRuns(dedupe(ring, 2))) {
            for (let i = 1; i < run.length; i++) thickLine(run[i - 1][0], run[i - 1][1], run[i][0], run[i][1], 11, 42, 84, 122);
          }
        } else {
          const cr = clipRing(ring);
          if (cr.length >= 3) fillPoly(cr, 42, 84, 122, 6);
        }
      } else if (el.type === 'relation' && el.members) {
        for (const m of el.members) {
          if (m.role === 'outer' && m.geometry) {
            const cr = clipRing(m.geometry.map((g2) => toXZ(g2.lat, g2.lon)));
            if (cr.length >= 3) fillPoly(cr, 42, 84, 122, 6);
          }
        }
      }
    }
    checkGreen('水面后');
    // 4) 道路（深色沥青, 与街区对比）
    for (const el of roadEls) {
      if (el.type !== 'way' || !el.tags?.highway || !el.geometry) continue;
      const cls = ROAD_CLASS[el.tags.highway];
      if (!cls) continue;
      const c = cls.c;
      const pts = el.geometry.map((g2) => toXZ(g2.lat, g2.lon));
      for (let i = 1; i < pts.length; i++) {
        const rr = Math.max(28, Math.round(c[0] * 0.75 + 118 * 0.25));
        const gg = Math.max(28, Math.round(c[1] * 0.75 + 110 * 0.25));
        const bb = Math.max(30, Math.round(c[2] * 0.75 + 102 * 0.25));
        thickLine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], cls.w / 2 + 1.2, rr, gg, bb);
      }
    }
    checkGreen('道路后');
    // 5) 铁路
    for (const el of railEls) {
      if (el.type !== 'way' || !el.geometry) continue;
      const pts = el.geometry.map((g2) => toXZ(g2.lat, g2.lon));
      for (let i = 1; i < pts.length; i++) thickLine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], 4, 70, 72, 76);
    }
    checkGreen('铁路后');
    // 轻度 3×3 盒滤波：软化硬边, 进一步抑制远景 moiré
    {
      const src = Buffer.from(px);
      for (let iz = 1; iz < GH - 1; iz++) {
        for (let ix = 1; ix < GW - 1; ix++) {
          const o = (iz * GW + ix) * 3;
          for (let c = 0; c < 3; c++) {
            let sum = 0;
            for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) sum += src[o + (dz * GW + dx) * 3 + c];
            px[o + c] = Math.round(sum / 9);
          }
        }
      }
    }
    checkGreen('模糊后');
    const jpeg = (await import('jpeg-js')).default;
    // jpeg-js encode 期望 RGBA(4通道): 把 RGB 缓冲展开为 RGBA
    const rgba = Buffer.alloc(GW * GH * 4);
    for (let k = 0; k < GW * GH; k++) {
      rgba[k * 4] = px[k * 3];
      rgba[k * 4 + 1] = px[k * 3 + 1];
      rgba[k * 4 + 2] = px[k * 3 + 2];
      rgba[k * 4 + 3] = 255;
    }
    const enc = jpeg.encode({ data: rgba, width: GW, height: GH }, 72);
    await writeFile(path.join(OUT, 'ground.jpg'), enc.data);
    manifest.ground = { file: 'ground.jpg', w: GW, h: GH, x0: X0, z0: Z0, spanX: 16000, spanZ: 20100 };
    console.log(`  ground.jpg ${(enc.data.length / 1048576).toFixed(1)} MB, 建筑 ${painted} 足迹`);
  }

  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`\n烘焙完成 ✓  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  建筑 ${stats.buildings} · 道路 ${stats.roads} · 水系 ${stats.water} · 绿地 ${stats.green} · 树木 ${stats.trees} · 跳过父轮廓 ${stats.skippedParents}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
