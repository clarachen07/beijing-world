/**
 * 北京世界 · Beijing World — 主入口
 */
import './style.css';
import * as THREE from 'three';
import { loadCityData } from './loader';
import { buildCity, type CityRefs } from './city';
import { buildLandmarks, updateLandmarkNight, type Landmark } from './landmarks';
import { loadLegacyLandmarks } from './legacy';
import { Environment } from './environment';
import { Effects } from './effects';
import { Traffic } from './cars';
import { CameraControl } from './controls';
import { tourPose, TOUR_DURATION } from './tour';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const loadingEl = document.getElementById('loading')!;
const loadBar = document.getElementById('load-bar')!;
const loadDetail = document.getElementById('load-detail')!;
const hintEl = document.getElementById('hint')!;
const labelsEl = document.getElementById('labels')!;
const btnVideo = document.getElementById('btn-video') as HTMLAnchorElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 2, 46000);
camera.position.set(0, 2200, 7000);

const env = new Environment();
scene.add(env.sun, env.moon, env.hemi, env.ambient, env.sky);
scene.fog = env.fog;

let effects: Effects;
let city: CityRefs;
let traffic: Traffic;
let landmarks: Landmark[];
let controls: CameraControl;

// ── 地标 HTML 标签 ──
const labelEls: { lm: Landmark; el: HTMLElement }[] = [];
function createLabels() {
  for (const lm of landmarks) {
    const el = document.createElement('div');
    el.className = 'landmark-label';
    el.innerHTML = `<div class="name">${lm.name}</div><div class="en">${lm.en}</div><div class="dot"></div>`;
    el.addEventListener('click', () => {
      controls.flyTo(lm.anchor, lm.focus);
      if (mode === 'tour') setMode('fly');
    });
    labelsEl.appendChild(el);
    labelEls.push({ lm, el });
  }
}

const projV = new THREE.Vector3();
const camDir = new THREE.Vector3();
function updateLabels() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.getWorldDirection(camDir);
  for (const { lm, el } of labelEls) {
    const behind = projV.copy(lm.anchor).sub(camera.position).dot(camDir) <= 0;
    const dist = camera.position.distanceTo(lm.anchor);
    const visible = !behind && dist <= 9000 && mode !== 'walk';
    if (!visible) {
      // 内联样式优先级高于 .hidden 类规则，必须用内联控制
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      continue;
    }
    projV.copy(lm.anchor).project(camera);
    const x = (projV.x * 0.5 + 0.5) * w;
    const y = (-projV.y * 0.5 + 0.5) * h;
    const fade = dist > 6500 ? 1 - (dist - 6500) / 2500 : 1;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    el.style.opacity = fade.toFixed(2);
    el.style.pointerEvents = 'auto';
  }
}

// ── 模式与 UI ──
let mode: 'tour' | 'fly' | 'walk' = 'tour';
let manualNight = false; // fly/walk 下的昼夜状态

function setMode(m: 'tour' | 'fly' | 'walk') {
  mode = m;
  controls.setMode(m);
  document.querySelectorAll('#mode-seg button').forEach((b) => {
    b.classList.toggle('active', (b as HTMLElement).dataset.mode === m);
  });
  if (m === 'tour') controls.tourT = 0;
}

document.querySelectorAll('#mode-seg button').forEach((b) => {
  b.addEventListener('click', () => setMode((b as HTMLElement).dataset.mode as any));
});
document.getElementById('btn-daynight')!.addEventListener('click', (e) => {
  manualNight = !manualNight;
  (e.target as HTMLElement).textContent = manualNight ? '☀ 白天' : '🌙 夜景';
  if (mode === 'tour') setMode('fly'); // 手动切换时退出漫游
});
document.getElementById('btn-replay')!.addEventListener('click', () => {
  setMode('tour');
});

// 检测视频文件是否存在 → 显示下载按钮
fetch('./video/beijing-world.mp4', { method: 'HEAD' }).then((r) => {
  if (r.ok) btnVideo.style.display = '';
}).catch(() => { });

// ── 主循环 ──
const clock = new THREE.Clock();
let hintTimer: number | undefined;
let paused = false; // 视频渲染确定性帧时暂停实时循环

function animate() {
  requestAnimationFrame(animate);
  if (paused) return;
  const dt = Math.min(0.1, clock.getDelta());

  controls.update(dt);
  // 昼夜驱动：tour 用路径插值，其他模式用手动开关
  if (mode === 'tour' && controls.nightOverride != null) {
    env.target = controls.nightOverride;
  } else {
    env.target = manualNight ? 1 : 0;
  }
  env.update(dt);
  updateLandmarkNight(env.nightT);
  effects.update(env.nightT);
  city.streetlightMat.opacity = env.nightT * 0.9;
  traffic?.update(dt, env.nightT);

  effects.render(dt);
  updateLabels();
}

function animateVideoFrame(t: number) {
  // 视频渲染确定性帧
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const night = tourPose(t, pos, look);
  camera.position.copy(pos);
  camera.lookAt(look);
  env.nightT = night;
  env.target = night;
  env.update(1);
  updateLandmarkNight(night);
  effects.update(night);
  city.streetlightMat.opacity = night * 0.9;
  traffic?.update(1 / 30, night);
  effects.render(1 / 30);
  updateLabels();
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  effects?.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

// ── 启动 ──
// Service Worker: 二次访问秒开（仅生产部署, 本地 dev 不启用）
if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  navigator.serviceWorker.register('./sw.js').catch(() => { });
}

async function boot() {
  // 视频渲染模式：?video=1（隐藏控制 UI，保留标题与地标标签）
  const isVideoMode = new URLSearchParams(location.search).has('video');
  if (isVideoMode) {
    renderer.setPixelRatio(1);
    document.body.classList.add('video-mode');
  }

  const data = await loadCityData((frac, label) => {
    loadBar.style.width = `${(frac * 100).toFixed(0)}%`;
    loadDetail.textContent = label;
  });

  loadDetail.textContent = '组装城市…';
  await new Promise((r) => setTimeout(r, 30));

  city = buildCity(data);
  scene.add(city.group);

  const lm = buildLandmarks();
  landmarks = lm.landmarks;
  scene.add(lm.group);

  // Blender 精细地标（GLB）
  await loadLegacyLandmarks((frac, label) => {
    loadBar.style.width = `${(92 + frac * 6).toFixed(0)}%`;
    loadDetail.textContent = label;
  }, (def, obj, landmark) => {
    scene.add(obj);
    if ((landmark as any)._showLabel !== false) landmarks.push(landmark);
  });
  createLabels();

  traffic = new Traffic(data.carPaths, isVideoMode ? 420 : 360);
  scene.add(traffic.group);

  effects = new Effects(renderer, scene, camera);

  controls = new CameraControl(camera, canvas);
  controls.onManual = () => {
    document.querySelectorAll('#mode-seg button').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.mode === 'fly');
    });
    mode = 'fly';
  };
  setMode('tour');

  loadBar.style.width = '100%';
  loadDetail.textContent = '欢迎来到北京 ✓';
  setTimeout(() => {
    loadingEl.classList.add('done');
    hintTimer = window.setTimeout(() => hintEl.classList.add('gone'), 9000);
  }, 500);

  // 暴露视频渲染钩子
  (window as any).__bjw = {
    totalFrames: Math.round(TOUR_DURATION * 30),
    fps: 30,
    seekFrame(i: number) {
      paused = true;
      clock.stop();
      const t = Math.min(0.99999, i / this.totalFrames);
      animateVideoFrame(t);
    },
    /** 调试：以任意相机位姿渲染一帧 */
    renderPose(pos: number[], look: number[]) {
      paused = true;
      clock.stop();
      camera.position.set(pos[0], pos[1], pos[2]);
      camera.lookAt(look[0], look[1], look[2]);
      effects.render(1 / 30);
      updateLabels();
    },
  };
  // 调试句柄
  (window as any).__dbg = { scene, env, camera, city, effects, renderer, THREE };

  animate();
}

boot().catch((err) => {
  loadDetail.textContent = `加载失败：${err.message}（请刷新重试）`;
  console.error(err);
});
