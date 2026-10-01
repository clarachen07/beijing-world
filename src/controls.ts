/**
 * 相机控制：tour（电影漫游）/ fly（自由飞行）/ walk（第一人称街景）+ 地标飞行过渡。
 * 任何手动输入会从 tour 切到 fly。
 */
import * as THREE from 'three';
import { TOUR_DURATION, tourPose } from './tour';

export type Mode = 'tour' | 'fly' | 'walk';

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraControl {
  camera: THREE.PerspectiveCamera;
  mode: Mode = 'tour';
  private dom: HTMLElement;

  // 漫游
  tourT = 0;
  private paused = false;

  // 姿态（fly/walk 共用）
  private yaw = 0;   // 绕 Y
  private pitch = 0;
  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private keys = new Set<string>();

  // 飞向地标
  private flyFrom = new THREE.Vector3();
  private flyLookFrom = new THREE.Vector3();
  private flyTarget = new THREE.Vector3();
  private flyLookTo = new THREE.Vector3();
  private flyT = 1; // 1 = 无动画
  private flyDur = 2.6;

  // 拖拽
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  onManual: (() => void) | null = null;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    this.dom = dom;
    // 初始位置由 main 设定 tour 起点
    this.bind();
  }

  private bind() {
    const dom = this.dom;
    dom.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      dom.setPointerCapture(e.pointerId);
      if (this.flyT < 1) {
        // 飞行中按下 = 接管: 取消飞行, 内部位置同步到当前相机
        this.flyT = 1;
        this.pos.copy(this.camera.position);
        this.vel.set(0, 0, 0);
      }
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      // 抓取世界式: 拖右画面右移(相机左转), 拖下画面下移(相机上仰)
      this.yaw += dx * 0.0032;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dy * 0.0028));
      if (this.flyT < 1) {
        // 飞行途中拖拽 = 用户接管: 取消飞行并同步到当前相机位
        this.flyT = 1;
        this.pos.copy(this.camera.position);
        this.vel.set(0, 0, 0);
      }
      if (Math.abs(dx) + Math.abs(dy) > 1) {
        this.debug.clicks++;
        this.manual();
      }
    });
    // pointerup 可能发生在标签/DOM 其他元素上(按下画布、松开标签), 必须在 window 层收尾
    window.addEventListener('pointerup', () => { this.dragging = false; });
    window.addEventListener('pointercancel', () => { this.dragging = false; });
    window.addEventListener('blur', () => { this.dragging = false; });
    dom.addEventListener('wheel', (e) => {
      if (this.mode === 'fly') {
        if (this.flyT < 1) {
          this.flyT = 1;
          this.pos.copy(this.camera.position);
        }
        const fwd = this.forward();
        this.pos.addScaledVector(fwd, -e.deltaY * 0.6);
        this.camera.position.copy(this.pos);
        this.manual();
      }
    }, { passive: true });
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE'].includes(e.code)) this.manual();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  private manual() {
    if (this.mode === 'tour') {
      this.setMode('fly');
      this.onManual?.();
    }
  }

  private forward(): THREE.Vector3 {
    // 与 setMode 的 yaw/pitch 反解一致：yaw=0 → 北(-z)，yaw=π/2 → 西(-x)
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
  }

  setMode(m: Mode) {
    if (m === this.mode) return;
    // 从当前相机姿态同步内部状态
    this.pos.copy(this.camera.position);
    const look = this.lookTarget();
    const d = look.clone().sub(this.camera.position).normalize();
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
    this.vel.set(0, 0, 0);
    this.mode = m;
    this.nightOverride = null;
    if (m === 'walk') this.pos.y = 1.7;
  }

  private lookTarget(): THREE.Vector3 {
    const t = new THREE.Vector3();
    this.camera.getWorldDirection(t);
    return this.camera.position.clone().addScaledVector(t, 100);
  }

  debug = { flyToCalls: 0, clicks: 0 };

  /** 点击地标飞往 */
  flyTo(anchor: THREE.Vector3, focus: number) {
    this.debug.flyToCalls++;
    this.setMode('fly');
    const dist = Math.max(180, focus * 0.75);
    // 从当前相机方向的反方向观察地标
    const dir = this.camera.position.clone().sub(anchor);
    dir.y = 0;
    if (dir.lengthSq() < 1) dir.set(0.6, 0, 0.8);
    dir.normalize();
    this.flyFrom.copy(this.camera.position);
    const lookFrom = this.lookTarget();
    this.flyLookFrom.copy(lookFrom);
    this.flyTarget.set(anchor.x + dir.x * dist, Math.max(anchor.y * 0.75, 60), anchor.z + dir.z * dist);
    this.flyLookTo.copy(anchor);
    this.flyT = 0;
  }

  get flying() {
    return this.flyT < 1;
  }

  update(dt: number) {
    // 地标飞行动画
    if (this.flyT < 1) {
      this.flyT = Math.min(1, this.flyT + dt / this.flyDur);
      const k = easeInOut(this.flyT);
      this.camera.position.lerpVectors(this.flyFrom, this.flyTarget, k);
      const look = new THREE.Vector3().lerpVectors(this.flyLookFrom, this.flyLookTo, k);
      this.camera.lookAt(look);
      if (this.flyT >= 1) {
        // 落位: 同步内部状态, 否则下一帧 fly 模式会把相机复制回起飞点 ("跳回远景"根因)
        this.pos.copy(this.camera.position);
        const d = look.clone().sub(this.camera.position).normalize();
        this.yaw = Math.atan2(-d.x, -d.z);
        this.pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
        this.vel.set(0, 0, 0);
      }
      return;
    }

    if (this.mode === 'tour') {
      this.tourT = (this.tourT + dt / TOUR_DURATION) % 1;
      const pos = new THREE.Vector3();
      const look = new THREE.Vector3();
      const night = tourPose(this.tourT, pos, look);
      this.camera.position.copy(pos);
      this.camera.lookAt(look);
      this.nightOverride = night;
      return;
    }

    // fly / walk
    const fwd = this.forward();
    const moveDir = this.mode === 'walk' ? new THREE.Vector3(fwd.x, 0, fwd.z).normalize() : fwd;
    const speedBase = this.mode === 'walk' ? 42 : Math.max(60, this.camera.position.y * 1.4);
    const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? speedBase * 2.6 : speedBase;
    const right = new THREE.Vector3(-moveDir.z, 0, moveDir.x).normalize();
    const acc = new THREE.Vector3();
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) acc.add(moveDir);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) acc.sub(moveDir);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) acc.sub(right);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) acc.add(right);
    if (this.mode === 'fly') {
      if (this.keys.has('KeyE')) acc.y += 1;
      if (this.keys.has('KeyQ')) acc.y -= 1;
    }
    if (acc.lengthSq() > 0) {
      acc.normalize().multiplyScalar(speed);
      this.vel.lerp(acc, Math.min(1, dt * 4));
    } else {
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 3));
    }
    this.pos.addScaledVector(this.vel, dt);
    if (this.mode === 'walk') {
      this.pos.y = 1.7;
    } else {
      this.pos.y = Math.max(3, this.pos.y);
      // 不要钻出边界太远
      const lim = 16000;
      this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x));
      this.pos.z = Math.max(-lim + 2600, Math.min(lim + 2600, this.pos.z));
    }
    this.camera.position.copy(this.pos);
    const look = this.pos.clone().addScaledVector(fwd, 100);
    this.camera.lookAt(look);
  }

  nightOverride: number | null = null;
}
