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

// 地标净空圆（lat, lon, r米）：跳过区域内建筑/树（程序化地标替代）
const CLEAR_CIRCLES = [
  [39.8822, 116.4066, 110], // 祈年殿
  [39.9929, 116.3966, 210], // 鸟巢
  [39.9934, 116.3903, 130], // 水立方
  [39.9043, 116.3832, 90],  // 国家大剧院
  [39.9133, 116.4114, 55],  // 中国尊
  [39.9087, 116.4610, 45],  // 国贸三期
  [39.9153, 116.4642, 130], // 央视大楼
  [39.9918, 116.3866, 55],  // 奥林匹克塔
  [39.9906, 116.3902, 30],  // 玲珑塔
  [39.9087, 116.3976, 90],  // 天安门
  [39.8988, 116.3983, 80],  // 前门/箭楼
  [39.9410, 116.3902, 90],  // 钟鼓楼
  [39.8727, 116.3980, 60],  // 永定门
  [39.9252, 116.3959, 90],  // 景山万春亭
  [39.9255, 116.3888, 75],  // 北海白塔
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
function writeMesh(chunk) {
  // chunk: { pos: number[], col: number[], idx: number[] } → Buffer
  const vCount = chunk.pos.length / 3;
  const iCount = chunk.idx.length;
  const buf = Buffer.alloc(8 + vCount * 15 + iCount * 4);
  let off = 0;
  buf.writeUInt32LE(vCount, off); off += 4;
  buf.writeUInt32LE(iCount, off); off += 4;
  for (let i = 0; i < chunk.pos.length; i++, off += 4) buf.writeFloatLE(chunk.pos[i], off);
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
    motorway: { w: 46, y: 0.85, c: hex(0x2c2f34) },
    motorway_link: { w: 13, y: 0.75, c: hex(0x2c2f34) },
    trunk: { w: 38, y: 0.8, c: hex(0x2e3136) },
    trunk_link: { w: 12, y: 0.7, c: hex(0x2e3136) },
    primary: { w: 29, y: 0.7, c: hex(0x33363b) },
    primary_link: { w: 11, y: 0.65, c: hex(0x33363b) },
    secondary: { w: 23, y: 0.62, c: hex(0x393c42) },
    secondary_link: { w: 10, y: 0.6, c: hex(0x393c42) },
    tertiary: { w: 17, y: 0.55, c: hex(0x3f434a) },
    residential: { w: 11, y: 0.5, c: hex(0x45484f) },
    unclassified: { w: 9, y: 0.48, c: hex(0x45484f) },
    living_street: { w: 8, y: 0.46, c: hex(0x4d4c48) },
    service: { w: 6, y: 0.44, c: hex(0x4c4f55) },
    pedestrian: { w: 11, y: 0.42, c: hex(0x83756a) },
  };
  let roadEls = [];
  for (let i = 0; i < 6; i++) roadEls = roadEls.concat(await load(`roads_${i}`));
  // 道路网格
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
  for (const el of roadEls) {
    if (el.type !== 'way' || !el.tags?.highway || !el.geometry) continue;
    const cls = ROAD_CLASS[el.tags.highway];
    if (!cls) continue;
    let pts = el.geometry.map((g) => toXZ(g.lat, g.lon));
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

  // ═══ 3. 水系与绿地 ═══
  console.log('■ 水系与绿地');
  let wgEls = [];
  for (let i = 0; i < 6; i++) wgEls = wgEls.concat(await load(`water_green_${i}`));
  const waterMesh = { pos: [], col: [], idx: [] };
  const greenMesh = { pos: [], col: [], idx: [] };
  const greenPolys = []; // [ring] 用于树种散布
  const WATER_C = hex(0x2a5f8a), WATER2 = hex(0x234f76);
  const GREEN_C = {
    park: hex(0x527a3f), forest: hex(0x3f6531), grass: hex(0x5d8548),
    scrub: hex(0x4a6f38), pitch: hex(0x4d7c46), garden: hex(0x5c8544), cemetery: hex(0x4c6b40), beach: hex(0xcbb98a),
  };
function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Sutherland–Hodgman 裁剪：把环裁剪到城市范围（防止关系多边形拖出几十公里的长条） */
function clipRing(ring) {
  const X = 8000, ZN = -8000, ZS = 10500;
  const planes = [
    { inside: (p) => p[0] >= -X, inter: (a, b) => { const t = (-X - a[0]) / (b[0] - a[0]); return [-X, a[1] + t * (b[1] - a[1])]; } },
    { inside: (p) => p[0] <= X, inter: (a, b) => { const t = (X - a[0]) / (b[0] - a[0]); return [X, a[1] + t * (b[1] - a[1])]; } },
    { inside: (p) => p[1] >= ZN, inter: (a, b) => { const t = (ZN - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), ZN]; } },
    { inside: (p) => p[1] <= ZS, inter: (a, b) => { const t = (ZS - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), ZS]; } },
  ];
  let out = ring;
  for (const pl of planes) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      const cIn = pl.inside(cur), pIn = pl.inside(prev);
      if (cIn) {
        if (!pIn) out.push(pl.inter(prev, cur));
        out.push(cur);
      } else if (pIn) {
        out.push(pl.inter(prev, cur));
      }
    }
    if (!out.length) break;
  }
  return out;
}
/** 环是否与城市范围有交集（丢弃 relation 带出的远端几何） */
function ringInExtent(ring) {
  const X = 8000, ZN = -8000, ZS = 10500;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return maxX > -X && minX < X && maxZ > ZN && minZ < ZS;
}

function clipPolylineRuns(pts) {
  // 把折线裁剪进城市窗口，返回若干段（每段 ≥2 点）
  const X = 8000, ZN = -8000, ZS = 10500;
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
    const tris = earcut(flat, holesIdx.length ? holesIdx : undefined);
    if (!tris.length) return false;
    const vb = mesh.pos.length / 3;
    for (let i = 0; i < flat.length / 2; i++) {
      mesh.pos.push(flat[i * 2], mesh === waterMesh ? 0.5 : 0.3, flat[i * 2 + 1]);
      mesh.col.push(col[0], col[1], col[2]);
    }
    for (const ti of tris) mesh.idx.push(vb + ti);
    return true;
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
          pushStrip(run, width / 2, 0.5, WATER_C, waterMesh);
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

  // ═══ 4. 铁路 ═══
  console.log('■ 铁路');
  const railEls = await load('rail');
  for (const el of railEls) {
    if (el.type !== 'way' || !el.geometry) continue;
    const pts = dedupe(el.geometry.map((g) => toXZ(g.lat, g.lon)), 2.5);
    if (pts.length < 2) continue;
    const layer = Math.max(0, Math.min(4, parseInt(el.tags?.layer || '0', 10) || 0));
    pushStrip(pts, 3.2, 0.4 + (el.tags?.bridge ? layer * 6 : 0), hex(0x2f3236), roadMesh);
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
  const SCATTER = 26000;
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
    const buf = writeMesh(c);
    const gz = await gzip(buf);
    const file = `b/b${String(ci).padStart(2, '0')}.bin.gz`;
    await writeFile(path.join(OUT, file), gz);
    manifest.buildings.chunks.push({ file, ox: c.ox, oz: c.oz, v: c.pos.length / 3, i: c.idx.length });
    console.log(`  ${file}: ${c.pos.length / 3} verts, ${(gz.length / 1048576).toFixed(2)} MB`);
    ci++;
  }
  const emitMesh = async (name, mesh) => {
    if (!mesh.idx.length) {
      manifest[name] = { file: '', v: 0, i: 0 };
      return;
    }
    const buf = writeMesh(mesh);
    const gz = await gzip(buf);
    const file = `b/${name}.bin.gz`;
    await writeFile(path.join(OUT, file), gz);
    manifest[name] = { file, v: mesh.pos.length / 3, i: mesh.idx.length };
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
      const buf = writeMesh(lampMesh);
      const gz = await gzip(buf);
      await writeFile(path.join(OUT, 'b/streetlights.bin.gz'), gz);
      manifest.streetlights = { file: 'b/streetlights.bin.gz', v: lamps.length / 3, i: 0 };
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

  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`\n烘焙完成 ✓  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  建筑 ${stats.buildings} · 道路 ${stats.roads} · 水系 ${stats.water} · 绿地 ${stats.green} · 树木 ${stats.trees} · 跳过父轮廓 ${stats.skippedParents}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
