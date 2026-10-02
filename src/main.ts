import './style.css';
import * as THREE from 'three';
import { CityLoader } from './loader';
import { TileManager } from './tiles';
import { CollisionWorld } from './collision';
import { buildLandmarks, updateLandmarkNight } from './landmarks';
import { createLandmarkModelManager, type LandmarkModelManager } from './legacy';
import { Environment } from './environment';
import { Effects } from './effects';
import { Traffic } from './cars';
import { CameraControl, type Mode } from './controls';
import { tourPose, TOUR_DURATION } from './tour';
import { WorldUI } from './ui';
import { latLonToLocal } from './geo';
import { fetchAssetJSON } from './asset-fetch';
import { groundSampler, type GroundGrid } from './ground';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const videoMode = new URLSearchParams(location.search).has('video');
const mobile = matchMedia('(pointer: coarse)').matches || window.innerWidth <= 680;
if (videoMode) document.body.classList.add('video-mode');

class BeijingWorld {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, window.innerWidth/window.innerHeight, 2, 46000);
  readonly env = new Environment(); readonly collision = new CollisionWorld(); readonly loader = new CityLoader();
  readonly ui = new WorldUI(mobile); readonly controls: CameraControl; readonly effects: Effects;
  city?: TileManager; models?: LandmarkModelManager; traffic?: Traffic;
  private landscape?: ReturnType<typeof buildLandmarks>;
  private reflection?: THREE.WebGLRenderTarget;
  private events = new AbortController(); private frame = 0; private lastTime = 0; private elapsed = 0;
  private frameIntervals: number[] = []; private disposed = false; private capturing = false; private contextLost = false;
  private manualNight = false; private sampleGround: (x: number,z: number) => number = () => 0;
  private modeIntent = 0;
  private modelFailures = 0;
  private palaceCollision = false; private palaceBounds?: THREE.Box3;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:mobile ? 'default' : 'high-performance'});
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    const [x,z] = latLonToLocal(39.9166,116.3907);
    this.camera.position.set(x+520,1150,z+850); this.camera.lookAt(x,65,z);
    this.scene.add(this.env.sun,this.env.moon,this.env.hemi,this.env.ambient,this.env.sky); this.scene.fog = this.env.fog;
    this.env.update(0);
    this.effects = new Effects(this.renderer,this.scene,this.camera,mobile);
    this.controls = new CameraControl(this.camera,canvas); this.controls.setCollisionWorld(this.collision);
    this.controls.onModeChange = (mode,previous) => {
      this.modeIntent++;
      if (previous === 'tour') this.manualNight = this.env.target >= .5;
      this.ui.setMode(mode);
    };
    this.controls.onManual = () => { this.modeIntent++; };
    this.controls.onWalkUnavailable = () => this.ui.status('当前位置尚无可步行地面，请先选择地标或稍后重试');
    this.effects.onQualityChange = level => { this.city?.setQuality(level); this.models?.setQuality(level === 0 ? 'balanced' : 'low'); };
    this.ui.onMode = mode => { void this.changeMode(mode); };
    this.ui.onReplay = () => { this.modeIntent++; this.controls.replayTour(); };
    this.ui.onNight = () => {
      this.modeIntent++;
      if (this.controls.mode === 'tour') this.controls.setMode('browse');
      this.manualNight = this.env.target < .5; this.ui.setNight(this.manualNight);
    };
    this.ui.onGo = landmark => { this.modeIntent++; this.controls.flyTo(landmark.lookAnchor ?? landmark.anchor,landmark.focus); };
    this.ui.onRetry = () => { this.city?.retryFailed(); this.models?.retryFailed(); this.ui.status('正在重新载入缺失区域…'); };
    this.ui.onRetryBoot = () => { void start(); };
    this.ui.onWalkInput = (forward,right) => this.controls.setWalkInput(forward,right);
    this.ui.setMode('browse'); this.ui.loading(.05,'正在读取城市资源清单…');
    const signal = this.events.signal;
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth/window.innerHeight; this.camera.updateProjectionMatrix(); this.effects.setSize(window.innerWidth,window.innerHeight);
    }, {signal});
    document.addEventListener('visibilitychange', () => { this.lastTime = 0; }, {signal});
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.contextLost = true; this.controls.clearInput(); this.ui.status('画面暂时中断，正在等待恢复…');
    }, {signal});
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false; this.lastTime = 0;
      void this.renderer.compileAsync(this.scene,this.camera).then(() => this.ui.status('画面已恢复，可继续探索')).catch(() => this.ui.failed('画面恢复失败，请重新载入'));
    }, {signal});
    this.frame = requestAnimationFrame(time => this.animate(time));
  }
  async boot() {
    const manifest = await this.loader.loadManifest();
    if (this.disposed) return;
    this.controls.setBounds(new THREE.Box3(new THREE.Vector3(manifest.bounds[0],0,manifest.bounds[1]),new THREE.Vector3(manifest.bounds[2],15000,manifest.bounds[3])));
    this.city = new TileManager(manifest,this.loader,this.collision,mobile); this.scene.add(this.city.group);
    this.city.onStatus = (message,retry) => this.ui.status(message,retry);
    // The coarse ground grid is small, and also gives models/traffic the same datum.
    if (manifest.trafficGround) {
      const grid = await fetchAssetJSON<GroundGrid>(`data/${manifest.trafficGround.file}`,{priority:100});
      if (this.disposed) return; this.sampleGround = groundSampler(grid);
    }
    this.ui.loading(.3,'展开故宫与四环北京…');
    this.landscape = buildLandmarks({groundHeight:this.sampleGround}); this.scene.add(this.landscape.group);
    const perimeter = this.landscape.landmarks.find(lm=>lm.id==='forbidden-city');
    if (perimeter) this.palaceBounds = new THREE.Box3().setFromObject(perimeter.group);
    await this.city.initialize(this.camera);
    if (this.disposed) return;
    this.ui.loading(1,'欢迎来到北京'); this.ui.ready();
    this.models = createLandmarkModelManager(this.renderer,{
      quality: mobile ? 'low' : 'balanced', groundHeight:this.sampleGround,
      onCollision:(id,obj) => { if (this.disposed) return; this.collision.removeModel(id); if (obj) this.collision.addModel(id,obj); },
    });
    this.scene.add(this.models.group); this.ui.setLandmarks([...this.landscape.landmarks,...this.models.landmarks]);
    // Sky reflections keep glass and metal readable without a remote environment map.
    const skyScene = new THREE.Scene(); skyScene.add(this.env.sky.clone());
    const generator = new THREE.PMREMGenerator(this.renderer); this.reflection = generator.fromScene(skyScene,.06,.1,40000);
    this.scene.environment = this.reflection.texture; generator.dispose();
    void this.models.ready.then(() => {
      if (this.models?.stats().failed) this.ui.status('部分景点细节未载入，可重试',true);
    });
    if (manifest.cars) void this.loader.loadCarPaths(manifest).then(paths => {
      if (this.disposed) return;
      this.traffic = new Traffic(paths,mobile ? 120 : 240,(x,z)=>this.sampleGround(x,z)); this.scene.add(this.traffic.group);
    }).catch(() => this.ui.status('车流暂未载入，城市仍可浏览',true));
    this.publishDebug();
  }
  private async changeMode(mode: Mode) {
    if (mode === 'walk' && this.city) this.controls.adoptPose();
    const intent = ++this.modeIntent;
    if (mode === 'walk' && this.city) {
      this.ui.status('正在准备附近的街道…');
      try { await this.city.ensureNear(this.camera.position.clone()); }
      catch { this.ui.status('附近街道未能载入，请重试',true); return; }
      if (this.disposed || intent !== this.modeIntent) return; this.ui.status('');
    }
    this.controls.setMode(mode);
  }
  private animate(time: number) {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(next => this.animate(next));
    if (document.hidden || this.contextLost) { this.lastTime = 0; return; }
    const interval = this.lastTime ? time-this.lastTime : 16.67, dt = Math.min(.05,interval/1000); this.lastTime = time;
    if (!this.capturing) {
      this.elapsed += dt; this.controls.update(dt);
      this.env.target = this.controls.mode === 'tour' && this.controls.nightOverride !== null ? this.controls.nightOverride : this.manualNight ? 1 : 0;
      this.env.update(dt); this.ui.setNight(this.env.target >= .5);
    }
    this.camera.updateMatrixWorld(); this.city?.update(this.camera,this.controls.mode);
    if (!this.capturing) this.models?.update(this.camera,dt);
    this.updatePalaceCollision();
    const failures = this.models?.stats().failed ?? 0;
    if (failures > this.modelFailures) this.ui.status('部分景点细节未载入，可点击重试',true);
    this.modelFailures = failures;
    if (this.capturing) return;
    this.render(dt,this.elapsed);
    this.effects.observeFrame(interval); this.frameIntervals.push(interval); if (this.frameIntervals.length > 12000) this.frameIntervals.shift();
  }
  private render(dt: number,seconds: number) {
    updateLandmarkNight(this.env.nightT); this.city?.materials.update(this.env.nightT);
    this.scene.environmentIntensity = 1-this.env.nightT*.8;
    this.traffic?.evaluateAt(seconds,this.env.nightT); this.effects.update(this.env.nightT); this.effects.render(dt);
    this.ui.updateLabels(this.camera,this.collision,performance.now());
  }
  private updatePalaceCollision() {
    if (!this.palaceBounds || !this.landscape) return;
    const near = this.camera.position.y < 120 && this.palaceBounds.distanceToPoint(this.camera.position) < 180;
    if (near && !this.palaceCollision) {
      const perimeter=this.landscape.landmarks.find(lm=>lm.id==='forbidden-city');
      if (perimeter) { this.collision.addModel('palace-perimeter',perimeter.group); this.palaceCollision=true; }
    } else if (!near && this.palaceCollision) { this.collision.removeModel('palace-perimeter'); this.palaceCollision=false; }
  }
  private async prepareCapture() {
    this.camera.updateMatrixWorld();
    // RAF keeps assembling queued tiles while capture waits for a fixed view.
    await Promise.all([this.city?.prepareView(this.camera),this.models?.prepareView(this.camera)]);
  }
  private publishDebug() {
    const app = this;
    window.__dbg = {scene:this.scene,env:this.env,camera:this.camera,city:this.city!,effects:this.effects,renderer:this.renderer,THREE,controls:this.controls,collision:this.collision,models:this.models!};
    window.__bjw = {
      totalFrames:Math.round(TOUR_DURATION*30),fps:30,
      async seekFrame(index: number) {
        app.capturing = true; app.controls.clearInput();
        const t = THREE.MathUtils.clamp(index/(TOUR_DURATION*30),0,1), pos = new THREE.Vector3(),look = new THREE.Vector3();
        const night = tourPose(t,pos,look); app.camera.position.copy(pos); app.camera.lookAt(look);
        app.env.nightT = app.env.target = night; app.env.update(0);
        try { await app.prepareCapture(); app.render(1/30,t*TOUR_DURATION); }
        catch (error) { app.controls.adoptPose(); app.capturing=false; app.lastTime=0; throw error; }
      },
      async renderPose(pos: number[],look: number[],night = 0) {
        if (pos.length !== 3 || look.length !== 3 || ![...pos,...look,night].every(Number.isFinite)) throw new Error('Invalid camera pose');
        app.capturing = true; app.controls.clearInput(); app.camera.position.set(pos[0],pos[1],pos[2]); app.camera.lookAt(look[0],look[1],look[2]);
        app.env.nightT = app.env.target = night; app.env.update(0);
        try { await app.prepareCapture(); app.render(1/30,0); }
        catch (error) { app.controls.adoptPose(); app.capturing=false; app.lastTime=0; throw error; }
      },
      resume() { app.controls.adoptPose(); app.capturing = false; app.lastTime = 0; },
      metrics() {
        const sorted = [...app.frameIntervals].sort((a,b)=>a-b);
        return {frames:sorted.length,p95:sorted[Math.floor(sorted.length*.95)] ?? 0,p50:sorted[Math.floor(sorted.length*.5)] ?? 0,
          p99:sorted[Math.floor(sorted.length*.99)] ?? 0,max:sorted.at(-1) ?? 0,over50ms:sorted.filter(ms=>ms>50).length,over250ms:sorted.filter(ms=>ms>250).length,
          resources:{...app.renderer.info.memory},render:{...app.renderer.info.render},tiles:app.city?.stats,landmarks:app.models?.stats(),quality:app.effects.quality};
      },
      resetMetrics() { app.frameIntervals.length = 0; },
    };
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.frame); this.events.abort(); this.controls.dispose(); this.ui.dispose();
    this.city?.dispose(); this.models?.dispose(); this.landscape?.dispose(); this.traffic?.dispose(); this.collision.clear(); this.loader.dispose();
    this.effects.dispose(); this.reflection?.dispose(); this.env.dispose(); this.renderer.dispose();
  }
}

let current: BeijingWorld | undefined;
async function start() {
  current?.dispose(); current = undefined;
  try { current = new BeijingWorld(); await current.boot(); }
  catch (error) {
    console.error(error);
    if (current) current.ui.failed(error);
    else {
      document.getElementById('load-detail')!.textContent = '当前浏览器无法启动三维画面，请使用支持 WebGL 2 的浏览器。';
      const retry = document.getElementById('btn-retry-boot')!; retry.hidden = false; retry.onclick = () => { void start(); };
    }
  }
}
window.__bjwReady = start();
if ('serviceWorker' in navigator && import.meta.env.PROD) void window.__bjwReady.then(() => {
  window.setTimeout(() => { void navigator.serviceWorker.register('./sw.js').catch(() => {}); },3000);
});

declare global {
  interface Window {
    __bjwReady: Promise<void>;
    __dbg: {scene:THREE.Scene;env:Environment;camera:THREE.PerspectiveCamera;city:TileManager;effects:Effects;renderer:THREE.WebGLRenderer;THREE:typeof THREE;controls:CameraControl;collision:CollisionWorld;models:LandmarkModelManager};
    __bjw: {totalFrames:number;fps:number;seekFrame(index:number):Promise<void>;renderPose(pos:number[],look:number[],night?:number):Promise<void>;resume():void;metrics():unknown;resetMetrics():void};
  }
}
