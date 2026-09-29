/**
 * 车流：沿主干道路径移动的实例化车辆 + 夜间车灯光点
 */
import * as THREE from 'three';

interface Car {
  path: number;
  dist: number;
  speed: number;
  dir: 1 | -1;
  lane: number;
  color: THREE.Color;
}

export class Traffic {
  group = new THREE.Group();
  cars: Car[] = [];
  private paths: Float32Array[] = [];
  private cumLens: Float32Array[] = [];
  private totalLens: number[] = [];
  private mesh!: THREE.InstancedMesh;
  private lights!: THREE.Points;
  private lightPositions!: Float32Array;
  private m = new THREE.Matrix4();
  private p = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);

  constructor(paths: Float32Array[], count = 380) {
    this.paths = paths;
    // 累积长度表
    for (const pts of paths) {
      const n = pts.length / 2;
      const cum = new Float32Array(n);
      let total = 0;
      for (let i = 0; i < n; i++) {
        if (i > 0) {
          total += Math.hypot(pts[i * 2] - pts[(i - 1) * 2], pts[i * 2 + 1] - pts[(i - 1) * 2 + 1]);
        }
        cum[i] = total;
      }
      this.cumLens.push(cum);
      this.totalLens.push(total);
    }

    // 车辆
    const geo = new THREE.BoxGeometry(2.0, 1.6, 4.4);
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    // 夜间灯光点
    this.lightPositions = new Float32Array(count * 3);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.lightPositions, 3));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,240,1)');
    g.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    this.lights = new THREE.Points(lg, new THREE.PointsMaterial({
      size: 5.5, map: new THREE.CanvasTexture(canvas), transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.lights.frustumCulled = false;
    this.group.add(this.lights);

    const palette = [0xd8d8dc, 0x2a2e34, 0xb8b4aa, 0x8a2f28, 0x2f4a6e, 0xcfc4a8, 0x4a5a50, 0xd0a830];
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const path = Math.floor(Math.random() * paths.length);
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.cars.push({
        path,
        dist: Math.random() * this.totalLens[path],
        speed: 9 + Math.random() * 11,
        dir: dir as 1 | -1,
        lane: dir === 1 ? 3.2 : -3.2,
        color: col.setHex(palette[i % palette.length]).clone(),
      });
      this.mesh.setColorAt(i, col);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private sample(path: number, dist: number, out: { x: number; z: number; dx: number; dz: number }) {
    const pts = this.paths[path];
    const cum = this.cumLens[path];
    const n = cum.length;
    const d = ((dist % this.totalLens[path]) + this.totalLens[path]) % this.totalLens[path];
    // 二分查找
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < d) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(1, lo);
    const segLen = cum[i] - cum[i - 1] || 1;
    const f = (d - cum[i - 1]) / segLen;
    const x0 = pts[(i - 1) * 2], z0 = pts[(i - 1) * 2 + 1];
    const x1 = pts[i * 2], z1 = pts[i * 2 + 1];
    out.x = x0 + (x1 - x0) * f;
    out.z = z0 + (z1 - z0) * f;
    out.dx = (x1 - x0) / segLen;
    out.dz = (z1 - z0) / segLen;
  }

  private tmp = { x: 0, z: 0, dx: 1, dz: 0 };

  update(dt: number, nightT: number) {
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      c.dist += c.speed * c.dir * dt;
      if (this.totalLens[c.path] < 30) continue;
      this.sample(c.path, c.dist, this.tmp);
      const px = this.tmp.x - this.tmp.dz * c.lane;
      const pz = this.tmp.z + this.tmp.dx * c.lane;
      const heading = Math.atan2(this.tmp.dx * c.dir, this.tmp.dz * c.dir);
      this.p.set(px, 1.1, pz);
      this.q.setFromAxisAngle(this.up, heading);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      // 车灯：车头位置
      this.lightPositions[i * 3] = px + this.tmp.dx * c.dir * 2.6;
      this.lightPositions[i * 3 + 1] = 1.2;
      this.lightPositions[i * 3 + 2] = pz + this.tmp.dz * c.dir * 2.6;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    (this.lights.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.lights.material as THREE.PointsMaterial).opacity = nightT * 0.95;
  }
}
