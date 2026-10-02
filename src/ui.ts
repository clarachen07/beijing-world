import * as THREE from 'three';
import type { Landmark } from './landmarks';
import type { Mode } from './controls';
import type { CollisionWorld } from './collision';

export class WorldUI {
  private events = new AbortController(); private timer = 0;
  private labels: { landmark: Landmark; button: HTMLButtonElement; width: number }[] = [];
  private projected = new THREE.Vector3(); private direction = new THREE.Vector3(); private nextLayout = 0;
  private mode: Mode = 'browse';
  onMode: (mode: Mode) => void = () => {}; onNight = () => {}; onReplay = () => {};
  onGo: (landmark: Landmark) => void = () => {}; onRetry = () => {}; onRetryBoot = () => {};
  onWalkInput: (forward: number, right: number) => void = () => {};
  constructor(readonly mobile: boolean) {
    const signal = this.events.signal;
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.addEventListener('click', () => this.onMode(button.dataset.mode as Mode), { signal }));
    this.element('btn-daynight').addEventListener('click', () => this.onNight(), { signal });
    this.element('btn-replay').addEventListener('click', () => this.onReplay(), { signal });
    this.element('btn-retry-assets').addEventListener('click', () => this.onRetry(), { signal });
    this.element('btn-retry-boot').addEventListener('click', () => this.onRetryBoot(), { signal });
    this.element('btn-help').addEventListener('click', () => {
      const panel = this.element('help-panel'); panel.hidden = !panel.hidden;
      this.element('btn-help').setAttribute('aria-expanded', String(!panel.hidden));
    }, { signal });
    this.element('landmark-picker').addEventListener('change', event => {
      const id = (event.target as HTMLSelectElement).value, landmark = this.labels.find(item => item.landmark.id === id)?.landmark;
      if (landmark) this.onGo(landmark);
      (event.target as HTMLSelectElement).value = '';
    }, { signal });
    const pad = this.element('walk-pad'), knob = this.element('walk-knob'); let pointer: number | null = null;
    const move = (event: PointerEvent) => {
      if (pointer !== event.pointerId) return;
      const box = pad.getBoundingClientRect(), dx = (event.clientX - box.left - box.width/2)/38, dy = (event.clientY - box.top - box.height/2)/38;
      const length = Math.max(1, Math.hypot(dx,dy));
      this.onWalkInput(-dy/length,dx/length); knob.style.transform = `translate(${dx/length*32}px,${dy/length*32}px)`;
    };
    pad.addEventListener('pointerdown', event => { pointer = event.pointerId; pad.setPointerCapture(pointer); move(event); }, { signal });
    pad.addEventListener('pointermove', move, { signal });
    const end = () => { pointer = null; this.onWalkInput(0,0); knob.style.transform = ''; };
    pad.addEventListener('pointerup', end, { signal }); pad.addEventListener('pointercancel', end, { signal });
    window.addEventListener('blur', end, { signal }); document.addEventListener('visibilitychange', end, { signal });
  }
  private element(id: string) { return document.getElementById(id)!; }
  loading(fraction: number, detail: string) {
    this.element('loading').classList.remove('done'); this.element('load-bar').style.width = `${Math.round(fraction*100)}%`;
    this.element('load-detail').textContent = detail; this.element('btn-retry-boot').hidden = true;
  }
  ready() { this.element('loading').classList.add('done'); }
  failed(error: unknown) {
    this.element('loading').classList.remove('done');
    this.element('load-detail').textContent = `载入未完成：${error instanceof Error ? error.message : String(error)}`;
    this.element('btn-retry-boot').hidden = false;
  }
  status(message: string, retry = false) {
    window.clearTimeout(this.timer); this.element('status').hidden = !message; this.element('status-text').textContent = message;
    this.element('btn-retry-assets').hidden = !retry;
    if (message && !retry) this.timer = window.setTimeout(() => { this.element('status').hidden = true; }, 4500);
  }
  setNight(night: boolean) {
    const button = this.element('btn-daynight'); button.textContent = night ? '白天' : '夜景'; button.setAttribute('aria-pressed', String(night));
  }
  setMode(mode: Mode) {
    this.mode = mode;
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
      const active = button.dataset.mode === mode; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    this.element('walk-pad').hidden = mode !== 'walk';
    this.element('hint').textContent = mode === 'browse' ? '左拖平移 · 右拖旋转 · 滚轮缩放' : mode === 'tour' ? '拖动或按方向键，随时接管视角' : mode === 'walk' ? '拖动查看 · WASD 移动 · Shift 快走' : '拖动查看 · WASD 飞行 · Q / E 升降';
    this.nextLayout = 0;
  }
  setLandmarks(landmarks: Landmark[]) {
    const layer = this.element('labels'), picker = this.element('landmark-picker') as HTMLSelectElement;
    layer.replaceChildren(); picker.length = 1; this.labels.length = 0;
    for (const landmark of landmarks.filter(lm => lm.showLabel !== false)) {
      const button = document.createElement('button'); button.className = 'landmark-label'; button.hidden = true; button.setAttribute('aria-label', `前往${landmark.name}`);
      for (const [className,text] of [['name',landmark.name],['en',landmark.en],['dot','']]) {
        const span = document.createElement('div'); span.className = className; span.textContent = text; button.appendChild(span);
      }
      button.addEventListener('click', () => this.onGo(landmark), { signal: this.events.signal }); layer.appendChild(button);
      const option = new Option(landmark.name, landmark.id); picker.add(option);
      this.labels.push({ landmark,button,width: Math.max(this.mobile ? 70 : 100,landmark.name.length*15, this.mobile ? 0 : landmark.en.length*7) });
    }
  }
  updateLabels(camera: THREE.PerspectiveCamera, collision: CollisionWorld, now: number) {
    if (now < this.nextLayout) return; this.nextLayout = now + 100;
    camera.updateMatrixWorld(); camera.getWorldDirection(this.direction);
    const w = window.innerWidth, h = window.innerHeight, used: THREE.Box2[] = [];
    const ranked = [...this.labels].sort((a,b) => camera.position.distanceToSquared(a.landmark.anchor)-camera.position.distanceToSquared(b.landmark.anchor));
    let count = 0;
    for (const item of ranked) {
      const {landmark,button,width} = item, distance = camera.position.distanceTo(landmark.anchor);
      let visible = this.mode !== 'walk' && distance < 12000 && count < (this.mobile ? 5 : 12) && this.projected.copy(landmark.anchor).sub(camera.position).dot(this.direction) > 0;
      this.projected.copy(landmark.anchor).project(camera);
      const x = (this.projected.x*.5+.5)*w, y = (-this.projected.y*.5+.5)*h;
      const rect = new THREE.Box2(new THREE.Vector2(x-width/2-8,y-50),new THREE.Vector2(x+width/2+8,y+8));
      visible = visible && this.projected.z >= -1 && this.projected.z <= 1 && rect.min.x > 12 && rect.max.x < w-12 && rect.min.y > 148 && rect.max.y < h-(this.mobile ? 136 : 105);
      if (visible) visible = !used.some(other => other.intersectsBox(rect)) && !collision.isOccluded(camera.position,landmark.anchor);
      button.hidden = !visible;
      if (visible) { used.push(rect); count++; button.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`; }
    }
  }
  dispose() { this.events.abort(); window.clearTimeout(this.timer); this.element('labels').replaceChildren(); }
}
