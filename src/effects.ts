import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

/** Bounded quality changes preserve responsiveness without changing scene state. */
export class Effects {
  readonly composer: EffectComposer; readonly bloom: UnrealBloomPass; readonly aa: ShaderPass;
  quality = 0; onQualityChange: ((level: number) => void) | null = null;
  private width = 1; private height = 1; private frames: number[] = []; private lastAdjustment = 0;
  constructor(readonly renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, readonly mobile = false) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: mobile ? 0 : Math.min(4, renderer.capabilities.maxSamples) });
    this.composer = new EffectComposer(renderer, target); this.composer.addPass(new RenderPass(scene, camera));
    this.aa = new ShaderPass(FXAAShader); this.aa.enabled = mobile; this.composer.addPass(this.aa);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.18, 0.45, 0.9); this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass()); renderer.info.autoReset = false;
    this.setSize(window.innerWidth, window.innerHeight);
  }
  setSize(width: number, height: number) {
    this.width = Math.max(1, width); this.height = Math.max(1, height);
    const limit = (this.mobile ? 1.25 : 1.5) * [1, 0.8, 0.6][this.quality];
    const ratio = Math.min(window.devicePixelRatio || 1, limit);
    this.renderer.setPixelRatio(ratio); this.renderer.setSize(this.width, this.height);
    this.composer.setPixelRatio(ratio); this.composer.setSize(this.width, this.height);
    this.aa.uniforms.resolution.value.set(1 / (this.width * ratio), 1 / (this.height * ratio));
    this.bloom.setSize(Math.floor(this.width * ratio * 0.5), Math.floor(this.height * ratio * 0.5));
  }
  update(night: number) {
    this.bloom.enabled = night > 0.15 && !(this.mobile && this.quality > 0);
    this.bloom.strength = 0.15 + night * 0.3; this.bloom.threshold = 0.9 - night * 0.16;
  }
  observeFrame(intervalMs: number) {
    if (intervalMs < 5 || intervalMs > 250 || document.hidden) return;
    this.frames.push(intervalMs); if (this.frames.length < 180) return;
    const sorted = [...this.frames].sort((a, b) => a - b), p95 = sorted[Math.floor(sorted.length * 0.95)]; this.frames.length = 0;
    const now = performance.now(), target = this.mobile ? 40 : 22;
    if (p95 > target && this.quality < 2 && now - this.lastAdjustment > 5000) {
      this.quality++; this.lastAdjustment = now; this.setSize(this.width, this.height); this.onQualityChange?.(this.quality);
    } else if (p95 < (this.mobile ? 30 : 18) && this.quality > 0 && now - this.lastAdjustment > 30000) {
      this.quality--; this.lastAdjustment = now; this.setSize(this.width, this.height); this.onQualityChange?.(this.quality);
    }
  }
  render(dt: number) { this.renderer.info.reset(); this.composer.render(dt); }
  dispose() {
    this.bloom.dispose(); this.aa.dispose();
    for (const pass of this.composer.passes) if (pass !== this.bloom && pass !== this.aa) pass.dispose();
    this.composer.dispose();
  }
}
