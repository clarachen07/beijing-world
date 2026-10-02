/** Navigation owns the camera pose; input, transitions and modes share that pose. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TOUR_DURATION, tourPose } from './tour';
import { CollisionWorld, WALK_EYE_HEIGHT } from './collision';

export type Mode = 'browse' | 'fly' | 'tour' | 'walk';
export interface CameraControlOptions {
  /** Pure navigation tests and deterministic capture do not need DOM listeners. */
  bindEvents?: boolean;
  bounds?: THREE.Box3;
}
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE']);
const UP = new THREE.Vector3(0, 1, 0);
const ease = (t: number) => t * t * (3 - 2 * t);
interface Transition {
  kind: 'camera' | 'walk';
  from: THREE.Vector3;
  to: THREE.Vector3;
  fromRotation: THREE.Quaternion;
  toRotation: THREE.Quaternion;
  elapsed: number;
  duration: number;
  startNight: number | null;
  endNight: number | null;
}

export class CameraControl {
  readonly camera: THREE.PerspectiveCamera;
  mode: Mode = 'browse';
  tourT = 0;
  nightOverride: number | null = null;
  onManual: (() => void) | null = null;
  onModeChange: ((mode: Mode, previous: Mode) => void) | null = null;
  onWalkUnavailable: (() => void) | null = null;
  debug = { flyToCalls: 0, clicks: 0 };
  private readonly dom: HTMLElement;
  private readonly orbit: OrbitControls;
  private readonly listeners = new AbortController();
  private readonly pos = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly keys = new Set<string>();
  private readonly forwardVector = new THREE.Vector3();
  private readonly moveVector = new THREE.Vector3();
  private readonly rightVector = new THREE.Vector3();
  private readonly displacement = new THREE.Vector3();
  private readonly posePosition = new THREE.Vector3();
  private readonly poseLook = new THREE.Vector3();
  private readonly pointers = new Map<number, THREE.Vector2>();
  private readonly walkInput = new THREE.Vector2();
  private readonly bounds = new THREE.Box3(new THREE.Vector3(-16000, 0, -16000), new THREE.Vector3(16000, 16000, 18600));
  private collision: CollisionWorld | null = null;
  private transition: Transition | null = null;
  private yaw = 0;
  private pitch = 0;
  private suspended = false;
  private activePointer: number | null = null;
  private readonly gestureCenter = new THREE.Vector2();
  private gestureDistance = 0;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement, options: CameraControlOptions = {}) {
    this.camera = camera;
    this.dom = dom;
    if (options.bounds) this.bounds.copy(options.bounds);
    const initialPosition = camera.position.clone();
    const initialRotation = camera.quaternion.clone();
    this.orbit = new OrbitControls(camera, options.bindEvents === false ? undefined : dom);
    camera.position.copy(initialPosition);
    camera.quaternion.copy(initialRotation);
    this.orbit.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.orbit.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.orbit.screenSpacePanning = false;
    this.orbit.minDistance = 5;
    this.orbit.maxDistance = 35000;
    this.orbit.maxPolarAngle = Math.PI - 0.01;
    // Direct manipulation avoids event-rate-dependent inertia and delayed input.
    this.orbit.enableDamping = false;
    this.syncPose();
    this.setNearPlane();
    if (options.bindEvents !== false) this.bind();
  }

  private bind() {
    const signal = this.listeners.signal;
    // Capture runs before OrbitControls, so the first gesture interrupts a tour.
    this.dom.addEventListener('pointerdown', (event) => {
      this.takeControl('pointer');
      this.activePointer = event.pointerId;
      this.pointers.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));
      if (this.mode !== 'browse') {
        try { this.dom.setPointerCapture(event.pointerId); } catch { /* Synthetic input has no active pointer. */ }
      }
      this.resetGesture();
    }, { capture: true, signal });
    this.dom.addEventListener('pointermove', (event) => {
      const previous = this.pointers.get(event.pointerId);
      if (!previous) return;
      const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
      previous.set(event.clientX, event.clientY);
      if (this.mode === 'browse') return;
      if (this.pointers.size > 1 && this.mode === 'fly') {
        const [a, b] = [...this.pointers.values()];
        const center = this.moveVector.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
        const distance = a.distanceTo(b);
        this.camera.getWorldDirection(this.forwardVector);
        this.rightVector.crossVectors(this.forwardVector, UP).normalize();
        const scale = Math.max(0.05, this.camera.position.y / Math.max(1, this.dom.clientHeight));
        this.pos.addScaledVector(this.rightVector, -(center.x - this.gestureCenter.x) * scale);
        this.pos.addScaledVector(this.forwardVector, (center.y - this.gestureCenter.y) * scale + (distance - this.gestureDistance) * scale);
        this.clampPosition();
        this.camera.position.copy(this.pos);
        this.gestureCenter.set(center.x, center.y);
        this.gestureDistance = distance;
      } else if (this.activePointer === event.pointerId) {
        this.yaw -= dx * 0.0032;
        this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0028, -1.45, 1.45);
        this.applyDirection();
      }
      if (dx || dy) this.debug.clicks++;
    }, { signal });
    const endPointer = (event: PointerEvent) => {
      this.pointers.delete(event.pointerId);
      if (this.activePointer === event.pointerId) this.activePointer = this.pointers.keys().next().value ?? null;
      this.resetGesture();
    };
    window.addEventListener('pointerup', endPointer, { signal });
    window.addEventListener('pointercancel', endPointer, { signal });
    this.dom.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
    this.dom.addEventListener('wheel', (event) => {
      this.takeControl('pointer');
      if (this.mode === 'fly') {
        event.preventDefault();
        this.camera.getWorldDirection(this.forwardVector);
        const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.dom.clientHeight : 1);
        this.pos.addScaledVector(this.forwardVector, -pixels * Math.max(0.08, this.pos.y * 0.0006));
        this.clampPosition();
        this.camera.position.copy(this.pos);
      }
    }, { capture: true, passive: false, signal });
    window.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return;
      if (MOVE_KEYS.has(event.code)) event.preventDefault();
      this.setKey(event.code, true);
    }, { signal });
    window.addEventListener('keyup', (event) => this.setKey(event.code, false), { signal });
    window.addEventListener('blur', () => {
      this.suspended = true;
      this.clearInput();
    }, { signal });
    window.addEventListener('focus', () => { this.suspended = document.hidden; }, { signal });
    document.addEventListener('visibilitychange', () => {
      this.suspended = document.hidden;
      this.clearInput();
    }, { signal });
  }

  private resetGesture() {
    if (this.pointers.size < 2) { this.gestureDistance = 0; return; }
    const [a, b] = [...this.pointers.values()];
    this.gestureCenter.copy(a).add(b).multiplyScalar(0.5);
    this.gestureDistance = a.distanceTo(b);
  }

  setKey(code: string, pressed: boolean) {
    if (pressed) {
      if (MOVE_KEYS.has(code)) this.takeControl('keyboard');
      this.keys.add(code);
    } else this.keys.delete(code);
  }

  /** The mobile joystick supplies normalized forward/right axes. */
  setWalkInput(forward: number, right: number) {
    this.walkInput.set(Number.isFinite(right) ? right : 0, Number.isFinite(forward) ? forward : 0).clampLength(0, 1);
    if (this.walkInput.lengthSq()) this.takeControl('keyboard');
  }

  clearInput() {
    this.keys.clear();
    if (this.orbit.domElement && typeof PointerEvent !== 'undefined') {
      for (const pointerId of this.pointers.keys()) {
        this.dom.dispatchEvent(new PointerEvent('pointercancel', { pointerId }));
      }
    }
    this.pointers.clear();
    this.activePointer = null;
    this.walkInput.set(0, 0);
    this.velocity.set(0, 0, 0);
    this.orbit.enabled = this.mode === 'browse' && !this.transition;
  }

  setBounds(bounds: THREE.Box3) { this.bounds.copy(bounds); }
  setCollisionWorld(world: CollisionWorld | null) { this.collision = world; }

  /** Resume browsing from a camera pose placed by capture or another subsystem. */
  adoptPose() {
    this.transition = null;
    this.clearInput();
    this.syncPose();
    this.changeMode('browse');
  }

  private syncPose() {
    this.pos.copy(this.camera.position);
    this.camera.getWorldDirection(this.forwardVector);
    this.yaw = Math.atan2(-this.forwardVector.x, -this.forwardVector.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(this.forwardVector.y, -1, 1));
    const distance = this.forwardVector.y < -0.01
      ? Math.max(5, Math.min(35000, this.pos.y / -this.forwardVector.y))
      : Math.max(100, Math.min(12000, this.pos.y * 2));
    this.orbit.target.copy(this.pos).addScaledVector(this.forwardVector, distance);
    this.velocity.set(0, 0, 0);
  }

  private takeControl(kind: 'pointer' | 'keyboard') {
    if (this.transition) {
      const landing = this.transition.kind === 'walk';
      this.transition = null;
      this.syncPose();
      if (landing) this.changeMode('fly');
    }
    if (this.mode === 'tour') {
      this.syncPose();
      this.changeMode(kind === 'pointer' ? 'browse' : 'fly');
    }
    this.orbit.enabled = this.mode === 'browse';
    this.onManual?.();
  }

  private changeMode(mode: Mode) {
    const previous = this.mode;
    this.mode = mode;
    this.orbit.enabled = mode === 'browse' && !this.transition;
    this.setNearPlane();
    if (mode !== 'tour') this.nightOverride = null;
    if (mode !== previous) this.onModeChange?.(mode, previous);
  }

  private setNearPlane() {
    const near = this.mode === 'walk' ? 0.08 : 1;
    if (this.camera.near !== near) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  /** False means street-level collision and elevation data are not ready. */
  setMode(mode: Mode): boolean {
    if (!['browse', 'fly', 'tour', 'walk'].includes(mode)) return false;
    this.transition = null;
    this.syncPose();
    this.clearInput();
    if (mode === 'walk') {
      const safe = this.collision?.findSafePosition(this.camera.position);
      if (!safe) { this.onWalkUnavailable?.(); return false; }
      const pitch = THREE.MathUtils.clamp(this.pitch, -0.7, 0.7);
      if (Math.abs(this.camera.position.y - (safe.y - WALK_EYE_HEIGHT)) > 3) {
        this.moveVector.set(-Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(this.yaw) * Math.cos(pitch));
        this.poseLook.copy(safe).add(this.moveVector);
        this.changeMode('walk');
        this.beginTransition(safe, this.poseLook, 1.6, null, null, 'walk');
        return true;
      }
      this.pos.copy(safe);
      this.camera.position.copy(safe);
      this.pitch = pitch;
      this.applyDirection();
    }
    this.changeMode(mode);
    if (mode === 'tour') this.transitionToTour();
    return true;
  }

  /** Explicit replay returns to the beginning smoothly, then plays once. */
  replayTour() {
    const oldNight = this.nightOverride;
    this.transition = null;
    this.syncPose();
    this.clearInput();
    this.tourT = 0;
    this.changeMode('tour');
    this.transitionToTour(oldNight);
  }

  private transitionToTour(startNight: number | null = this.nightOverride) {
    this.tourT = THREE.MathUtils.clamp(this.tourT, 0, 1);
    const night = tourPose(this.tourT, this.posePosition, this.poseLook);
    this.beginTransition(this.posePosition, this.poseLook, 1.8, startNight, night);
  }

  private beginTransition(position: THREE.Vector3, look: THREE.Vector3, duration: number, startNight: number | null = null, endNight: number | null = null, kind: 'camera' | 'walk' = 'camera') {
    this.transition = {
      kind,
      from: this.camera.position.clone(), to: position.clone(),
      fromRotation: this.camera.quaternion.clone(), toRotation: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(position, look, UP)),
      elapsed: 0, duration, startNight, endNight,
    };
    this.orbit.enabled = false;
  }

  flyTo(anchor: THREE.Vector3, focus: number) {
    this.debug.flyToCalls++;
    const nextMode = this.mode === 'fly' ? 'fly' : 'browse';
    this.setMode(nextMode);
    this.moveVector.copy(this.camera.position).sub(anchor).setY(0);
    if (this.moveVector.lengthSq() < 1) this.moveVector.set(0.6, 0, 0.8);
    this.moveVector.normalize();
    const distance = Math.max(180, focus * 0.75);
    this.posePosition.copy(anchor).addScaledVector(this.moveVector, distance);
    this.posePosition.y = Math.max(60, anchor.y * 0.75);
    this.beginTransition(this.posePosition, anchor, 2.6);
  }

  get flying() { return this.transition !== null; }
  get tourFinished() { return this.mode === 'tour' && !this.transition && this.tourT >= 1; }

  private applyDirection() {
    this.forwardVector.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    this.poseLook.copy(this.camera.position).add(this.forwardVector);
    this.camera.lookAt(this.poseLook);
  }

  private clampPosition() {
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, this.bounds.min.x, this.bounds.max.x);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, this.bounds.min.z, this.bounds.max.z);
    const minimumY = Math.max(this.bounds.min.y, this.camera.near * 1.1);
    this.pos.y = THREE.MathUtils.clamp(this.pos.y, minimumY, Math.max(minimumY, this.bounds.max.y));
  }

  update(deltaTime: number) {
    if (this.suspended || !Number.isFinite(deltaTime) || deltaTime <= 0) return;
    const dt = Math.min(0.1, deltaTime);
    if (this.transition) {
      const transition = this.transition;
      if (transition.kind === 'walk' && !this.collision?.findSafePosition(transition.to, 0)) {
        this.transition = null;
        this.syncPose();
        this.changeMode('fly');
        this.onWalkUnavailable?.();
        return;
      }
      transition.elapsed = Math.min(transition.duration, transition.elapsed + dt);
      const t = ease(transition.elapsed / transition.duration);
      this.camera.position.lerpVectors(transition.from, transition.to, t);
      this.camera.quaternion.slerpQuaternions(transition.fromRotation, transition.toRotation, t);
      // Keep the geographic horizon upright; slerp alone introduces a small roll
      // between different yaw/pitch pairs, which OrbitControls would later remove.
      this.poseLook.set(0, 0, -1).applyQuaternion(this.camera.quaternion).add(this.camera.position);
      this.camera.lookAt(this.poseLook);
      if (transition.endNight != null) this.nightOverride = THREE.MathUtils.lerp(transition.startNight ?? transition.endNight, transition.endNight, t);
      if (transition.elapsed >= transition.duration) {
        this.transition = null;
        this.syncPose();
        this.orbit.enabled = this.mode === 'browse';
      }
      return;
    }
    if (this.mode === 'tour') {
      this.tourT = Math.min(1, this.tourT + dt / TOUR_DURATION);
      this.nightOverride = tourPose(this.tourT, this.posePosition, this.poseLook);
      this.camera.position.copy(this.posePosition);
      this.camera.lookAt(this.poseLook);
      return;
    }
    if (this.mode === 'browse') {
      this.orbit.update(dt);
      this.pos.copy(this.camera.position);
      this.posePosition.copy(this.pos);
      this.clampPosition();
      this.posePosition.subVectors(this.pos, this.posePosition);
      this.orbit.target.add(this.posePosition);
    }
    this.camera.getWorldDirection(this.forwardVector);
    this.moveVector.copy(this.forwardVector);
    if (this.mode !== 'fly') this.moveVector.setY(0).normalize();
    this.rightVector.crossVectors(this.moveVector, UP).normalize();
    let forward = this.walkInput.y, right = this.walkInput.x;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) forward++;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) forward--;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) right++;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) right--;
    this.moveVector.multiplyScalar(forward).addScaledVector(this.rightVector, right);
    if (this.mode === 'fly') {
      if (this.keys.has('KeyE')) this.moveVector.y++;
      if (this.keys.has('KeyQ')) this.moveVector.y--;
    }
    const fast = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = this.mode === 'walk' ? (fast ? 4.2 : 1.6) : Math.max(20, this.pos.y * 0.65) * (fast ? 2 : 1);
    this.moveVector.clampLength(0, 1).multiplyScalar(speed);
    const rate = this.mode === 'walk' ? 14 : 6;
    const decay = Math.exp(-rate * dt);
    this.displacement.copy(this.velocity).sub(this.moveVector).multiplyScalar((1 - decay) / rate).addScaledVector(this.moveVector, dt);
    this.velocity.sub(this.moveVector).multiplyScalar(decay).add(this.moveVector);
    if (this.mode === 'walk') {
      if (!this.collision?.isReady(this.pos.x, this.pos.z)) {
        this.clearInput();
        this.changeMode('browse');
        this.syncPose();
        this.onWalkUnavailable?.();
        return;
      }
      this.collision.moveCamera(this.pos, this.displacement, this.pos);
    } else {
      this.posePosition.copy(this.pos);
      this.pos.add(this.displacement);
      this.clampPosition();
      if (this.mode === 'browse') this.orbit.target.add(this.displacement.subVectors(this.pos, this.posePosition));
    }
    this.camera.position.copy(this.pos);
    if (this.mode !== 'browse') this.applyDirection();
  }

  dispose() {
    this.listeners.abort();
    this.clearInput();
    this.transition = null;
    if (this.orbit.domElement) this.orbit.dispose();
  }
}
