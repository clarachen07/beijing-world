/**
 * 地标程序化建模 —— 曼哈顿效果的核心。
 * 每个地标用代码近似建模，落在真实 OSM 坐标上，烘焙脚本已在相应位置跳过原建筑。
 */
import * as THREE from 'three';
import { latLonToLocal } from './geo';

export interface Landmark {
  name: string;
  en: string;
  anchor: THREE.Vector3; // 标签锚点（世界坐标）
  focus: number;         // 飞行观测半径
  group: THREE.Group;
}

// ── 夜间自发光材质注册表 ──
export const nightEmissives: { mat: THREE.MeshLambertMaterial; color: THREE.Color; intensity: number }[] = [];

function glowMat(color: number, emissive: number, intensity: number, opts: Partial<THREE.MeshLambertMaterialParameters> = {}) {
  const mat = new THREE.MeshLambertMaterial({ color, ...opts });
  nightEmissives.push({ mat, color: new THREE.Color(emissive), intensity });
  return mat;
}

const M = {
  red: new THREE.MeshLambertMaterial({ color: 0x9e2b25, flatShading: true }),
  darkRed: new THREE.MeshLambertMaterial({ color: 0x7a1f1a, flatShading: true }),
  gold: glowMat(0xd9a021, 0x8a5a10, 0.55, { flatShading: true }),
  goldBright: glowMat(0xe8b64c, 0xa06a12, 0.8, { flatShading: true }),
  blue: glowMat(0x2b4d8c, 0x16264a, 0.5, { flatShading: true }),
  cream: new THREE.MeshLambertMaterial({ color: 0xd8d2c4, flatShading: true }),
  marble: new THREE.MeshLambertMaterial({ color: 0xcfc9bc, flatShading: true }),
  gray: new THREE.MeshLambertMaterial({ color: 0x8a8580, flatShading: true }),
  darkGray: new THREE.MeshLambertMaterial({ color: 0x4a4e55, flatShading: true }),
  glass: glowMat(0x8fa8ba, 0x24303c, 0.4, { flatShading: true }),
  glassDark: glowMat(0x39434d, 0x141a20, 0.4, { flatShading: true }),
  silver: new THREE.MeshPhongMaterial({ color: 0xb4bac0, shininess: 90, specular: 0x99aabb, flatShading: true }),
  white: new THREE.MeshLambertMaterial({ color: 0xe8e4da, flatShading: true }),
  nestSteel: new THREE.MeshLambertMaterial({ color: 0x9a948c, flatShading: true }),
  nestRed: glowMat(0xa8352a, 0x5a1a12, 0.5, { flatShading: true }),
  hill: new THREE.MeshLambertMaterial({ color: 0x5a7440, flatShading: true }),
  waterDark: new THREE.MeshPhongMaterial({ color: 0x1d4260, shininess: 100, specular: 0x557799 }),
};

// ── 通用构件 ─────────────────────────────────────────────
function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  return m;
}
/** 方形攒尖/庑殿顶（金字塔近似）：顶点朝 ±x/±z，底宽精确等于 w×d */
function pyramid(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.ConeGeometry(0.5, h, 4), mat);
  m.rotation.y = Math.PI / 4;
  m.scale.set(w, 1, d);
  m.position.set(x, y + h / 2, z);
  return m;
}
/** 中国式双重檐屋顶：下檐宽浅 + 上檐高耸 */
function doubleRoof(w: number, d: number, lowH: number, upH: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.add(pyramid(w, lowH, d, mat, x, y, z));
  g.add(box(w * 0.45, lowH * 0.35, d * 0.45, M.red, x, y + lowH * 0.92, z));
  g.add(pyramid(w * 0.6, upH, d * 0.6, mat, x, y + lowH * 1.22, z));
  return g;
}
function cyl(r: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 20): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.set(x, y + h / 2, z);
  return m;
}

/** 单个多重檐圆攒尖亭（祈年殿式） */
function circularHall(r: number, tierH: number, tiers: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  let y = 0;
  for (let i = 0; i < tiers; i++) {
    const rr = r * (1 - i * 0.16);
    g.add(cyl(rr * 0.96, tierH * 0.5, M.red, 0, y, 0, 28));
    y += tierH * 0.5;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(rr, tierH * 0.75, 28), mat);
    cone.position.set(0, y + tierH * 0.375, 0);
    g.add(cone);
    y += tierH * 0.75;
  }
  const finial = new THREE.Mesh(new THREE.SphereGeometry(r * 0.07, 10, 8), M.goldBright);
  finial.position.y = y + r * 0.12;
  g.add(finial);
  const spire = cyl(r * 0.018, r * 0.35, M.goldBright, 0, y, 0, 6);
  g.add(spire);
  return g;
}

// ── 各地标 ───────────────────────────────────────────────
function mkTiananmen(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  g.add(box(120, 10, 42, M.red));                 // 城台
  g.add(box(126, 1.6, 46, M.marble, 0, 10));      // 白石栏杆
  g.add(box(96, 16, 30, M.red, 0, 11.6));         // 城楼
  g.add(doubleRoof(100, 34, 4.5, 5.5, M.gold, 0, 27.6)); // 双重檐
  return { g, a: new THREE.Vector3(0, 44, 0) };
}

function mkGate(w = 60, d = 22, podiumH = 14, hallH = 14): THREE.Group {
  const g = new THREE.Group();
  g.add(box(w, podiumH, d, M.red));
  g.add(box(w * 0.72, hallH, d * 0.8, M.red, 0, podiumH));
  g.add(doubleRoof(w * 0.85, d * 1.15, 3.5, 4, M.gold, 0, podiumH + hallH));
  return g;
}

function mkForbiddenCity(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  const [x0, z0] = latLonToLocal(39.9206, 116.3928); // 西北角
  const [x1, z1] = latLonToLocal(39.9120, 116.4016); // 东南角
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const w = x1 - x0, d = z1 - z0;
  const wallH = 9.6, t = 4.5;
  // 四面城墙 + 金顶
  const walls: [number, number, number, number][] = [
    [w, t, 0, z0 - cz], [w, t, 0, z1 - cz],
    [t, d, x0 - cx, 0], [t, d, x1 - cx, 0],
  ];
  for (const [ww, dd, ox, oz] of walls) {
    g.add(box(ww, wallH, dd, M.red, ox, 0, oz));
    g.add(box(ww + 1.2, 1.0, dd + 1.2, M.gold, ox, wallH, oz));
  }
  // 四角楼（三重檐方亭）
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const px = (sx * w) / 2, pz = (sz * d) / 2;
    g.add(box(13, 8, 13, M.red, px, wallH, pz));
    g.add(doubleRoof(16, 16, 3, 3.2, M.gold, px, wallH + 8, pz));
  }
  // 午门（南，U 形城台）
  const wmY = z1 - cz; // 南墙 z
  g.add(box(104, 22, 32, M.red, 0, 0, wmY));
  g.add(box(30, 32, 34, M.red, -37, 0, wmY - 8));
  g.add(box(30, 32, 34, M.red, 37, 0, wmY - 8));
  g.add(doubleRoof(60, 20, 4.5, 5, M.gold, 0, 22, wmY));
  g.add(doubleRoof(24, 24, 3.5, 4, M.gold, -37, 32, wmY - 8));
  g.add(doubleRoof(24, 24, 3.5, 4, M.gold, 37, 32, wmY - 8));
  // 神武门（北）
  const wnY = z0 - cz;
  g.add(box(64, 18, 24, M.red, 0, 0, wnY));
  g.add(doubleRoof(58, 18, 4, 4.5, M.gold, 0, 18, wnY));
  // 东华门/西华门
  for (const sx of [-1, 1] as const) {
    g.add(box(24, 16, 56, M.red, (sx * w) / 2, 0, 0));
    g.add(doubleRoof(18, 60, 3.5, 4, M.gold, (sx * w) / 2, 16, 0));
  }
  return { g, a: new THREE.Vector3(0, 46, 0) };
}

function mkJingshan(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  // 山脊（南北向土丘）
  const cones: [number, number, number][] = [
    [170, 24, 130], [150, 34, 40], [130, 45, -40], [150, 32, -120], [170, 22, -200],
  ];
  for (const [r, h, oz] of cones) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 14), M.hill);
    c.scale.set(1.15, 1, 0.72);
    c.position.set(0, h / 2, oz);
    g.add(c);
  }
  // 万春亭
  const top = new THREE.Group();
  top.add(box(16, 5, 16, M.red));
  top.add(doubleRoof(20, 20, 3.5, 4, M.gold, 0, 5));
  top.add(box(10, 4, 10, M.red, 0, 8.5));
  top.add(pyramid(13, 4.5, 13, M.gold, 0, 12.5));
  top.position.set(0, 44, -40);
  g.add(top);
  return { g, a: new THREE.Vector3(0, 66, -40) };
}

function mkQianmen(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  const gate = mkGate(44, 20, 16, 13);
  g.add(gate);
  const arrow = mkGate(34, 16, 12, 12);
  arrow.position.z = 34;
  g.add(arrow);
  return { g, a: new THREE.Vector3(0, 44, 16) };
}

function mkBellDrum(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  // 鼓楼
  const drum = new THREE.Group();
  drum.add(box(56, 26, 32, M.gray));
  drum.add(box(40, 9, 22, M.darkRed, 0, 26));
  drum.add(doubleRoof(46, 26, 4, 5, M.gold, 0, 35));
  drum.position.set(0, 0, 90);
  g.add(drum);
  // 钟楼
  const bell = new THREE.Group();
  bell.add(box(34, 34, 34, M.gray));
  bell.add(box(24, 6, 24, M.darkRed, 0, 34));
  bell.add(pyramid(30, 10, 30, M.gold, 0, 40));
  bell.add(cyl(0.5, 8, M.goldBright, 0, 50, 0, 6));
  bell.position.set(0, 0, 0);
  g.add(bell);
  return { g, a: new THREE.Vector3(0, 60, 45) };
}

function mkTempleOfHeaven(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  // 三层汉白玉台基
  const terr = new THREE.Group();
  for (let i = 0; i < 3; i++) terr.add(cyl(30 - i * 3.5, 2.6, M.marble, 0, i * 2.6, 0, 40));
  terr.add(circularHall(17, 7.5, 3, M.blue));
  terr.position.set(0, 0, 0);
  g.add(terr);
  // 台基护栏
  for (let i = 0; i < 3; i++) g.add(cyl(30.6 - i * 3.5, 0.7, M.marble, 0, i * 2.6 + 2.6, 0, 40));
  return { g, a: new THREE.Vector3(0, 52, 0) };
}

function mkChinaZun(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  const H = 528, SEG = 44;
  // 花瓶轮廓：宽度随高度
  const prof: [number, number][] = [[0, 56], [0.16, 46], [0.30, 41], [0.48, 42.5], [0.66, 46.5], [0.84, 50], [1, 45]];
  const widthAt = (t: number) => {
    for (let i = 1; i < prof.length; i++) {
      if (t <= prof[i][0]) {
        const [t0, w0] = prof[i - 1], [t1, w1] = prof[i];
        return w0 + ((t - t0) / (t1 - t0)) * (w1 - w0);
      }
    }
    return prof[prof.length - 1][1];
  };
  const glass = glowMat(0x7f98ab, 0x1c262e, 0.35, { flatShading: true });
  const crown = glowMat(0x93aab8, 0x584820, 0.9, { flatShading: true });
  for (let i = 0; i < SEG; i++) {
    const t0 = i / SEG, t1 = (i + 1) / SEG;
    const w0 = widthAt(t0), w1 = widthAt(t1);
    const y0 = t0 * H, y1 = t1 * H;
    const taper = new THREE.Mesh(makeCyl4(w1, w0, y1 - y0), i >= SEG - 2 ? crown : glass);
    taper.position.y = (y0 + y1) / 2;
    g.add(taper);
  }
  return { g, a: new THREE.Vector3(0, 420, 0) };
}
/** 四棱台（方塔段）几何 */
function makeCyl4(rTop: number, rBottom: number, h: number): THREE.CylinderGeometry {
  const geo = new THREE.CylinderGeometry(rTop * 0.707, rBottom * 0.707, h, 4, 1);
  geo.rotateY(Math.PI / 4);
  return geo;
}

function mkGuomao3(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  const H = 330;
  const body = new THREE.Mesh(makeCyl4(30, 36, H * 0.86), glowMat(0x7c94a6, 0x1a232b, 0.35, { flatShading: true }));
  body.position.y = (H * 0.86) / 2;
  g.add(body);
  g.add(box(52, 14, 52, M.darkGray, 0, H * 0.86));
  g.add(box(30, 34, 30, glowMat(0x8fa4b2, 0x5a4a1a, 0.8, { flatShading: true }), 0, H * 0.86 + 14));
  return { g, a: new THREE.Vector3(0, 280, 0) };
}

function mkCCTV(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  const lean = 0.105;
  const t1 = box(46, 205, 56, M.glassDark);
  t1.position.set(-52, 102, 0); t1.rotation.z = lean;
  const t2 = box(46, 205, 56, M.glassDark);
  t2.position.set(52, 102, 0); t2.rotation.z = -lean;
  g.add(t1, t2);
  // 底部连体 + 顶部悬挑
  g.add(box(150, 34, 52, M.glassDark, 0, 17));
  const top = box(215, 52, 52, M.glassDark, 8, 200);
  g.add(top);
  // 悬挑角部圆管
  const knee1 = cyl(26, 58, M.glassDark, -88, 196, 0, 14);
  knee1.rotation.x = Math.PI / 2;
  const knee2 = cyl(26, 58, M.glassDark, 105, 196, 0, 14);
  knee2.rotation.x = Math.PI / 2;
  g.add(knee1, knee2);
  return { g, a: new THREE.Vector3(0, 240, 0) };
}

function mkBirdNest(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  const RX = 163, RZ = 108, H = 66;
  // 外皮：椭圆环面（分层椭圆圈）
  const rings: [number, number][] = [[0, 1.0], [20, 1.02], [42, 0.97], [58, 0.82], [66, 0.6]];
  for (let i = 0; i < rings.length - 1; i++) {
    const [y0, s0] = rings[i], [y1, s1] = rings[i + 1];
    const seg = 44;
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1.05) / seg) * Math.PI * 2;
      const quad = new THREE.BufferGeometry();
      const p = (a: number, y: number, s: number) => [Math.cos(a) * RX * s, y, Math.sin(a) * RZ * s] as const;
      const [x0, , z0] = p(a0, y0, s0), [x1, , z1] = p(a1, y0, s0);
      const [x2, , z2] = p(a1, y1, s1), [x3, , z3] = p(a0, y1, s1);
      quad.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0, z0, x1, y0, z1, x2, y1, z2, x3, y1, z3], 3));
      quad.setIndex([0, 1, 2, 0, 2, 3]);
      quad.computeVertexNormals();
      g.add(new THREE.Mesh(quad, M.nestSteel));
    }
  }
  // 编织钢架：随机倾斜椭圆环管
  for (let i = 0; i < 22; i++) {
    const torus = new THREE.Mesh(new THREE.TorusGeometry(120 + (i % 4) * 14, 2.4 + (i % 3), 4, 40, Math.PI * (0.55 + (i % 5) * 0.18)), M.nestSteel);
    torus.rotation.x = Math.PI / 2 + (((i * 7) % 10) - 5) * 0.05;
    torus.rotation.z = (i / 22) * Math.PI * 2;
    torus.scale.set(RX / 130, RZ / 130, 1);
    torus.position.y = 4 + (i % 3) * 26;
    g.add(torus);
  }
  // 红色碗状看台
  const bowl = new THREE.Mesh(new THREE.TorusGeometry(95, 30, 12, 40), M.nestRed);
  bowl.rotation.x = Math.PI / 2;
  bowl.scale.set(RX / 130, RZ / 130, 1.35);
  bowl.position.y = 26;
  g.add(bowl);
  return { g, a: new THREE.Vector3(0, 88, 0) };
}

function mkWaterCube(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  // 气泡纹理
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#2f6da8';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 130; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 8 + Math.random() * 20;
    const grd = ctx.createRadialGradient(x, y, 1, x, y, r);
    grd.addColorStop(0, 'rgba(190,225,250,0.85)');
    grd.addColorStop(1, 'rgba(80,140,200,0.05)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 2);
  const bubble = glowMat(0x3f7fb8, 0x2a5f96, 0.7, { map: tex, transparent: true, opacity: 0.92 });
  g.add(box(177, 30, 177, bubble));
  g.add(box(160, 26, 160, new THREE.MeshLambertMaterial({ color: 0x9fc8e8 })), box(163, 2, 163, M.white, 0, 30));
  return { g, a: new THREE.Vector3(0, 48, 0) };
}

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
    const m = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 7, len, 8), glowMat(0x93aab8, 0x222c34, 0.35, { flatShading: true }));
    m.position.set((bx + tx) / 2, H / 2, (bz + tz) / 2);
    m.quaternion.setFromUnitVectors(up, dir.normalize());
    g.add(m);
  }
  for (const [r, y] of [[13, 190], [10, 150], [8, 100]] as const) g.add(cyl(r, 3.4, M.glass, 0, y, 0, 16));
  g.add(cyl(0.9, 30, M.silver, 0, 218, 0, 6));
  return { g, a: new THREE.Vector3(0, 215, 0) };
}

function mkLinglong(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  const H = 128;
  g.add(new THREE.Mesh(new THREE.BoxGeometry(22, H, 22), glowMat(0x86a0b4, 0x22303a, 0.4, { flatShading: true })));
  (g.children[0] as THREE.Mesh).position.y = H / 2 + 4;
  g.add(box(30, 4, 30, M.darkGray, 0, 0));
  g.add(cyl(0.6, 14, M.silver, 0, H + 4, 0, 6));
  return { g, a: new THREE.Vector3(0, 140, 0) };
}

function mkNCPA(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  // 银蛋
  const egg = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 24), M.silver);
  egg.scale.set(106, 46, 73);
  egg.position.y = 6;
  g.add(egg);
  // 水池
  const pool = new THREE.Mesh(new THREE.CircleGeometry(160, 40), M.waterDark);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.5;
  g.add(pool);
  return { g, a: new THREE.Vector3(0, 62, 0) };
}

function mkMonument(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  g.add(box(32, 3, 32, M.marble));
  const ob = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 5.5, 36, 4), M.white);
  ob.rotation.y = Math.PI / 4;
  ob.position.y = 21;
  g.add(ob);
  g.add(pyramid(8, 3, 8, M.gold, 0, 39));
  return { g, a: new THREE.Vector3(0, 48, 0) };
}

function mkWhiteDagoba(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  const c = new THREE.Mesh(new THREE.ConeGeometry(60, 32, 12), M.hill);
  c.position.y = 16;
  g.add(c);
  // 覆钵式白塔
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

function mkYongdingmen(): { g: THREE.Group; a: THREE.Vector3 } {
  const g = new THREE.Group();
  g.add(mkGate(40, 18, 14, 12));
  return { g, a: new THREE.Vector3(0, 40, 0) };
}

// ── 汇总 ─────────────────────────────────────────────────
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

  add('天安门', 'TIANANMEN', 39.9087, 116.3976, mkTiananmen, 320);
  add('故宫', 'THE FORBIDDEN CITY', 39.9163, 116.3972, mkForbiddenCity, 1400);
  add('景山', 'JINGSHAN PARK', 39.9252, 116.3959, mkJingshan, 400);
  add('前门', 'QIANMEN', 39.8988, 116.3983, mkQianmen, 260);
  add('钟鼓楼', 'BELL & DRUM TOWERS', 39.9410, 116.3902, mkBellDrum, 300);
  add('天坛', 'TEMPLE OF HEAVEN', 39.8822, 116.4066, mkTempleOfHeaven, 420);
  add('中国尊', 'CHINA ZUN · 528M', 39.9133, 116.4114, mkChinaZun, 700);
  add('国贸三期', 'CHINA WORLD TOWER', 39.9087, 116.4610, mkGuomao3, 600);
  add('央视大楼', 'CCTV HEADQUARTERS', 39.9153, 116.4642, mkCCTV, 520);
  add('鸟巢', "BIRD'S NEST", 39.9929, 116.3966, mkBirdNest, 500);
  add('水立方', 'WATER CUBE', 39.9934, 116.3903, mkWaterCube, 320);
  add('奥林匹克塔', 'OLYMPIC TOWER', 39.9918, 116.3866, mkOlympicTower, 380);
  add('玲珑塔', 'LINGLONG TOWER', 39.9906, 116.3902, mkLinglong, 220);
  add('国家大剧院', 'NATIONAL GRAND THEATRE', 39.9043, 116.3832, mkNCPA, 420);
  add('人民英雄纪念碑', 'MONUMENT TO THE PEOPLE HEROES', 39.9042, 116.3976, mkMonument, 90);
  add('北海白塔', 'WHITE DAGOBA', 39.9255, 116.3888, mkWhiteDagoba, 200);
  add('永定门', 'YONGDINGMEN GATE', 39.8727, 116.3980, mkYongdingmen, 240);
  // 什刹海（无模型，仅标签）
  {
    const [x, z] = latLonToLocal(39.9395, 116.3850);
    landmarks.push({ name: '什刹海', en: 'SHICHAHAI LAKES', anchor: new THREE.Vector3(x, 12, z), focus: 500, group: new THREE.Group() });
  }

  return { group: root, landmarks };
}

/** 夜间发光更新 */
export function updateLandmarkNight(t: number) {
  for (const e of nightEmissives) {
    e.mat.emissive.copy(e.color).multiplyScalar(t * e.intensity);
  }
}
