/**
 * 地标系统：坐标全部对齐 OSM 真实数据。
 * 精细模型（故宫各殿/城楼/现代地标）由 legacy.ts 从 Blender GLB 加载；
 * 这里只保留程序化的：故宫城墙环、景山、北海白塔、纪念碑、奥林匹克塔、玲珑塔。
 */
import * as THREE from 'three';
import { latLonToLocal } from './geo';

export interface Landmark {
  name: string;
  en: string;
  anchor: THREE.Vector3;
  focus: number;
  group: THREE.Group;
  showLabel?: boolean;
}

// ── 夜间自发光材质注册表 ──
export const nightEmissives: { mat: THREE.MeshLambertMaterial; color: THREE.Color; intensity: number }[] = [];

function glowMat(color: number, emissive: number, intensity: number, opts: Partial<THREE.MeshLambertMaterialParameters> = {}) {
  const mat = new THREE.MeshLambertMaterial({ color, ...opts });
  nightEmissives.push({ mat, color: new THREE.Color(emissive), intensity });
  return mat;
}

const M = {
  red: new THREE.MeshLambertMaterial({ color: 0x8c211b, flatShading: true }),
  gold: glowMat(0xc79118, 0x6a4408, 0.5, { flatShading: true }),
  goldBright: glowMat(0xd9a52e, 0x8a5a10, 0.8, { flatShading: true }),
  glass: glowMat(0x7f98ab, 0x1c262e, 0.35, { flatShading: true }),
  silver: new THREE.MeshPhongMaterial({ color: 0xb4bac0, shininess: 90, specular: 0x99aabb, flatShading: true }),
  white: new THREE.MeshLambertMaterial({ color: 0xe8e4da, flatShading: true }),
  hill: new THREE.MeshLambertMaterial({ color: 0x4f6b39, flatShading: true }),
};

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  return m;
}
function cyl(r: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 20): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.set(x, y + h / 2, z);
  return m;
}
function pyramid(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.ConeGeometry(0.5, h, 4), mat);
  m.rotation.y = Math.PI / 4;
  m.scale.set(w, 1, d);
  m.position.set(x, y + h / 2, z);
  return m;
}

/** 故宫城墙环 (753×955m, 中心 39.9166N 116.3907E) */
function mkWallRing(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  const wallH = 9.6, t = 5;
  const w = 753, d = 955; // 东西 × 南北
  const walls: [number, number, number, number][] = [
    [w, t, 0, -d / 2], [w, t, 0, d / 2],
    [t, d, -w / 2, 0], [t, d, w / 2, 0],
  ];
  for (const [ww, dd, ox, oz] of walls) {
    g.add(box(ww, wallH, dd, M.red, ox, 0, oz));
    g.add(box(ww + 1.2, 1.0, dd + 1.2, M.gold, ox, wallH, oz));
  }
  return { g, a: new THREE.Vector3(0, 40, 0) };
}

/** 景山：单一平滑山脊网格（真实山形, 非圆锥拼盘）+ 满山树木 */
function mkJingshan(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  // 山脊: 沿南北轴的钟形山体, 东西宽 420m, 南北长 900m, 峰值 45m
  const NX = 36, NZ = 60;
  const LEN_X = 210, LEN_Z = 450; // 半长轴
  const verts: number[] = [];
  const faces: number[] = [];
  const bell = (t: number) => Math.exp(-t * t * 3.2); // 轴向包络
  for (let iz = 0; iz <= NZ; iz++) {
    const tz = iz / NZ;
    const z = (tz - 0.5) * 2 * LEN_Z; // -450..450
    for (let ix = 0; ix <= NX; ix++) {
      const tx = ix / NX;
      const x = (tx - 0.5) * 2 * LEN_X;
      const rx = 1 - Math.pow((tx - 0.5) * 2, 2); // 椭圆截面
      const rz = 1 - Math.pow((tz - 0.5) * 2, 2);
      const rr = Math.max(0, Math.min(rx, rz));
      const env = bell((tz - 0.42) * 2.2); // 峰在偏北
      const h = 45 * env * Math.pow(rr, 1.4) + 2.5 * rr;
      verts.push(x, h, z);
    }
  }
  for (let iz = 0; iz < NZ; iz++) {
    for (let ix = 0; ix < NX; ix++) {
      const a = iz * (NX + 1) + ix;
      const b = a + 1;
      const c = a + NX + 1;
      const d = c + 1;
      faces.push(a, c, d, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(faces);
  geo.computeVertexNormals();
  const hill = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x54683b }));
  g.add(hill);
  // 满山树木（贴坡面）
  const treeVerts: number[] = [];
  const treeIdx: number[] = [];
  const pushTree = (x: number, y: number, z: number, s: number) => {
    const base = treeVerts.length / 3;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      treeVerts.push(x + Math.cos(a) * s * 0.4, y, z + Math.sin(a) * s * 0.4);
    }
    treeVerts.push(x, y + s, z);
    for (let i = 0; i < 6; i++) treeIdx.push(base + i, base + 6, base + (i + 1) % 6);
  };
  const heightAt = (tx: number, tz: number) => {
    const rx = 1 - Math.pow((tx - 0.5) * 2, 2);
    const rz = 1 - Math.pow((tz - 0.5) * 2, 2);
    const rr = Math.max(0, Math.min(rx, rz));
    const env = bell((tz - 0.42) * 2.2);
    return 45 * env * Math.pow(rr, 1.4) + 2.5 * rr;
  };
  for (let i = 0; i < 620; i++) {
    const tx = ((i * 0.757) % 1) * 0.86 + 0.07;
    const tz = ((i * 0.473) % 1) * 0.9 + 0.05;
    const x = (tx - 0.5) * 2 * LEN_X;
    const z = (tz - 0.5) * 2 * LEN_Z;
    pushTree(x, heightAt(tx, tz) - 0.5, z, 4.5 + ((i * 1.37) % 1) * 4);
  }
  const treeGeo = new THREE.BufferGeometry();
  treeGeo.setAttribute('position', new THREE.Float32BufferAttribute(treeVerts, 3));
  treeGeo.setIndex(treeIdx);
  treeGeo.computeVertexNormals();
  g.add(new THREE.Mesh(treeGeo, new THREE.MeshLambertMaterial({ color: 0x33532a, flatShading: true })));
  // 万春亭（峰顶）
  const top = new THREE.Group();
  top.add(box(16, 5, 16, M.red));
  top.add(box(20, 3.5, 20, M.gold, 0, 5));
  top.add(box(10, 4, 10, M.red, 0, 8.5));
  top.add(pyramid(13, 4.5, 13, M.gold, 0, 12.5));
  top.position.set(0, 45, -180 * 0 + (0.42 - 0.5) * 2 * LEN_Z);
  g.add(top);
  return { g, a: new THREE.Vector3(0, 60, (0.42 - 0.5) * 2 * LEN_Z) };
}

/** 北海白塔 (覆钵式) */
function mkWhiteDagoba(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  const c = new THREE.Mesh(new THREE.ConeGeometry(60, 32, 12), M.hill);
  c.position.y = 16;
  g.add(c);
  g.add(cyl(9, 3, M.white, 0, 32, 0, 20));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(8.2, 20, 14), M.white);
  dome.scale.y = 1.15;
  dome.position.y = 41;
  g.add(dome);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(3.4, 12, 14), M.white);
  tip.position.y = 53;
  g.add(tip);
  g.add(cyl(0.4, 7, M.goldBright, 0, 62, 0, 6));
  return { g, a: new THREE.Vector3(0, 76, 0) };
}

/** 人民英雄纪念碑 */
function mkMonument(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  g.add(box(32, 3, 32, M.white));
  const ob = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 5.5, 36, 4), M.white);
  ob.rotation.y = Math.PI / 4;
  ob.position.y = 21;
  g.add(ob);
  g.add(pyramid(8, 3, 8, M.gold, 0, 39));
  return { g, a: new THREE.Vector3(0, 48, 0) };
}

/** 奥林匹克塔 (五塔环抱 246m) */
function mkOlympicTower(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  const H = 218;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const bx = Math.cos(a) * 20, bz = Math.sin(a) * 20;
    const tx = Math.cos(a) * 7, tz = Math.sin(a) * 7;
    const dir = new THREE.Vector3(tx - bx, H, tz - bz);
    const len = dir.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 7, len, 8), M.glass);
    m.position.set((bx + tx) / 2, H / 2, (bz + tz) / 2);
    m.quaternion.setFromUnitVectors(up, dir.normalize());
    g.add(m);
  }
  for (const [r, y] of [[13, 190], [10, 150], [8, 100]] as const) g.add(cyl(r, 3.4, M.glass, 0, y, 0, 16));
  g.add(cyl(0.9, 30, M.silver, 0, 218, 0, 6));
  return { g, a: new THREE.Vector3(0, 215, 0) };
}

/** 玲珑塔 */
function mkLinglong(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  const H = 128;
  const body = new THREE.Mesh(new THREE.BoxGeometry(22, H, 22), M.glass);
  body.position.y = H / 2 + 4;
  g.add(body);
  g.add(box(30, 4, 30, M.silver, 0, 0));
  g.add(cyl(0.6, 14, M.silver, 0, H + 4, 0, 6));
  return { g, a: new THREE.Vector3(0, 140, 0) };
}

export function buildLandmarks(): { group: THREE.Group; landmarks: Landmark[] } {
  const root = new THREE.Group();
  const landmarks: Landmark[] = [];
  const add = (name: string, en: string, lat: number, lon: number, mk: () => { g: THREE.Group; a: THREE.Vector3 }, focus: number, showLabel = true) => {
    const { g, a } = mk();
    const [x, z] = latLonToLocal(lat, lon);
    g.position.set(x, 0, z);
    root.add(g);
    if (showLabel) landmarks.push({ name, en, anchor: new THREE.Vector3(x + a.x, a.y, z + a.z), focus, group: g });
  };

  add('故宫', 'THE FORBIDDEN CITY', 39.9166, 116.3907, mkWallRing, 1400);
  add('景山', 'JINGSHAN PARK', 39.92435, 116.39008, mkJingshan, 400);
  add('北海白塔', 'WHITE DAGOBA', 39.9255, 116.3889, mkWhiteDagoba, 200);
  add('人民英雄纪念碑', 'MONUMENT TO THE PEOPLE HEROES', 39.9046, 116.3913, mkMonument, 90);
  add('奥林匹克塔', 'OLYMPIC TOWER', 40.00655, 116.3879, mkOlympicTower, 380);
  add('玲珑塔', 'LINGLONG TOWER', 39.9934, 116.3902, mkLinglong, 220);
  // 什刹海（仅标签）
  {
    const [x, z] = latLonToLocal(39.94, 116.386);
    landmarks.push({ name: '什刹海', en: 'SHICHAHAI LAKES', anchor: new THREE.Vector3(x, 12, z), focus: 500, group: new THREE.Group() });
  }

  return { group: root, landmarks };
}

export function updateLandmarkNight(t: number) {
  for (const e of nightEmissives) {
    e.mat.emissive.copy(e.color).multiplyScalar(t * e.intensity);
  }
}
