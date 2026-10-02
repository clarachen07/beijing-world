/** Landmark asset streaming, shared decoder/cache ownership and bounded LOD residency. */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import registryText from '../config/landmarks.json?raw';
import { latLonToLocal } from './geo';
import { fetchAssetBytes, resolveAsset } from './asset-fetch';
import { uniforms } from './materials';
import type { Landmark } from './landmarks';

export interface LegacyDef {
  id: string; model: string; file: string; lat: number; lon: number; rotDeg: number;
  name: string; en: string; labelH: number; focus: number; heightM: number;
  elevationM: number; showLabel: boolean; lookAnchor: [number, number, number];
  footprints: [number, number][][];
  lod: { near: string; medium: string; far: string; distancesM: [number, number] };
  collision: string;
}
type RegistryDef = Omit<LegacyDef, 'file'>;
const registry = JSON.parse(registryText) as { landmarks: RegistryDef[] };
export const LANDMARK_DEFS: readonly LegacyDef[] = registry.landmarks.filter(d => d.model).map(d => ({ ...d, file: d.model }));
/** Compatibility name: definitions now come from the one measured registry. */
export const LEGACY_DEFS = LANDMARK_DEFS;
export type LandmarkQuality = 'high' | 'balanced' | 'low' | 'auto';
type Level = 'near' | 'medium' | 'far';
interface CacheEntry { scene: THREE.Group; used: number; level: Level; }
interface Entry { def: LegacyDef; landmark: Landmark; placeholder: THREE.Group; level?: Level; object?: THREE.Group; pending?: Level; task?: Promise<void>; generation: number; failed: boolean; }
export interface LandmarkManagerOptions {
  root?: THREE.Group;
  quality?: LandmarkQuality;
  transcoderPath?: string;
  groundHeight?: (x: number, z: number) => number;
  onProgress?: (fraction: number, label: string) => void;
  onEach?: (def: LegacyDef, object: THREE.Object3D, landmark: Landmark) => void;
  onCollision?: (id: string, object: THREE.Object3D | null) => void;
}
export interface LandmarkModelManager {
  group: THREE.Group;
  landmarks: Landmark[];
  ready: Promise<void>;
  update: (camera: THREE.Camera, deltaSeconds?: number) => void;
  prepareView: (camera: THREE.Camera) => Promise<void>;
  setQuality: (quality: LandmarkQuality) => void;
  setGroundSampler: (sampler: (x: number, z: number) => number) => void;
  retryFailed: () => void;
  dispose: () => void;
  stats: () => { cached: number; pending: number; failed: number; visible: number };
}

function enhanceMaterial(material: THREE.Material) {
  if (!(material instanceof THREE.MeshStandardMaterial) || !/glass|etfe/i.test(material.name)) return;
  material.onBeforeCompile = shader => {
    shader.uniforms.uNight = uniforms.uNight;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLandmarkWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLandmarkWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLandmarkWorld;\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec2 cell = floor(vec2(vLandmarkWorld.x + vLandmarkWorld.z, vLandmarkWorld.y) / 3.6);
        vec2 f = fract(vec2(vLandmarkWorld.x + vLandmarkWorld.z, vLandmarkWorld.y) / 3.6);
        float lit = step(0.65, fract(sin(dot(cell, vec2(127.1,311.7))) * 43758.5453));
        float windowMask = step(.18,f.x)*step(f.x,.82)*step(.2,f.y)*step(f.y,.8);
        totalEmissiveRadiance += vec3(.8,.62,.34) * lit * windowMask * uNight * .6;`);
  };
  material.customProgramCacheKey = () => 'landmark-night-v2';
  material.needsUpdate = true;
}

function placeholder(def: LegacyDef) {
  const g = new THREE.Group(); g.name = `${def.id}: awaiting detail`;
  const points = def.footprints.flat();
  let w = 24, d = 24;
  if (points.length) {
    const local = points.map(([lon, lat]) => latLonToLocal(lat, lon));
    w = Math.max(4, Math.max(...local.map(p => p[0])) - Math.min(...local.map(p => p[0])));
    d = Math.max(4, Math.max(...local.map(p => p[1])) - Math.min(...local.map(p => p[1])));
  }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, def.heightM, d),
    new THREE.MeshStandardMaterial({ color: def.heightM > 100 ? 0x71808a : 0x9c7954, roughness: .8 }));
  mesh.position.y = def.heightM / 2; mesh.userData.landmarkPlaceholder = true; g.add(mesh);
  return g;
}

function disposeObjects(root: THREE.Object3D) {
  const geometry = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse(o => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    geometry.add(m.geometry);
    (Array.isArray(m.material) ? m.material : [m.material]).forEach(material => {
      materials.add(material);
      for (const v of Object.values(material)) if (v instanceof THREE.Texture) textures.add(v);
    });
  });
  geometry.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
}

function parseWithDeadline(loader: GLTFLoader, bytes: ArrayBuffer, root: string, signal: AbortSignal): Promise<GLTF> {
  return new Promise((resolve,reject) => {
    let settled=false;
    const finish=(error?:unknown,gltf?:GLTF)=>{
      if(settled){if(gltf)disposeObjects(gltf.scene);return;}
      settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);
      if(error)reject(error);else resolve(gltf!);
    };
    const cancel=()=>finish(new DOMException('Landmark decode cancelled','AbortError'));
    const timer=setTimeout(()=>finish(new Error('Landmark decoding exceeded 20 seconds')),20000);
    if(signal.aborted){cancel();return;}
    signal.addEventListener('abort',cancel,{once:true});
    // Loader workers have no public per-parse cancellation API. Dispose any result arriving after timeout.
    void loader.parseAsync(bytes,root).then(gltf=>finish(undefined,gltf),error=>finish(error));
  });
}

export function createLandmarkModelManager(renderer?: THREE.WebGLRenderer, options: LandmarkManagerOptions = {}): LandmarkModelManager {
  const group = options.root ?? new THREE.Group(); group.name ||= 'Landmarks';
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const ktx = renderer ? new KTX2Loader().setTranscoderPath(options.transcoderPath ?? resolveAsset('./decoders/basis/')).detectSupport(renderer) : undefined;
  if (ktx) loader.setKTX2Loader(ktx);
  const abort = new AbortController();
  const cache = new Map<string, CacheEntry>();
  const pending = new Map<string, Promise<CacheEntry>>();
  const collisionCache = new Map<string, {scene:THREE.Group;used:number}>();
  const collisionPending = new Map<string, Promise<THREE.Group>>();
  const collisionBindings = new Map<string, THREE.Group>();
  const collisionFailures = new Map<string, number>();
  let collisionDesired = new Set<string>();
  const queue: { entry: Entry; level: Level; priority: number; generation: number; done: () => void }[] = [];
  let active = 0, disposed = false, quality = options.quality ?? 'balanced', tick = 0, clock = 0;
  const cameraPosition = new THREE.Vector3();
  const entries: Entry[] = LANDMARK_DEFS.map(def => {
    const [x,z] = latLonToLocal(def.lat, def.lon);
    const ground = options.groundHeight?.(x,z) ?? def.elevationM;
    const container = new THREE.Group(); container.name = def.name; container.position.set(x, ground, z);
    container.rotation.y = THREE.MathUtils.degToRad(def.rotDeg); group.add(container);
    const proxy = placeholder(def); container.add(proxy);
    const [lx,ly,lz] = def.lookAnchor;
    const landmark: Landmark = { id: def.id, name: def.name, en: def.en, anchor: new THREE.Vector3(x, def.labelH + ground, z),
      lookAnchor: new THREE.Vector3(x+lx,ly+ground,z+lz), focus: def.focus, group: container, showLabel: def.showLabel };
    return { def, landmark, placeholder: proxy, generation: 0, failed: false };
  });
  const load = (def: LegacyDef, level: Level) => {
    const path = def.lod[level], existing = cache.get(path);
    if (existing) { existing.used = clock; return Promise.resolve(existing); }
    const inFlight = pending.get(path); if (inFlight) return inFlight;
    const promise = fetchAssetBytes(path, { signal: abort.signal, timeoutMs: 24000, priority: level === 'far' ? 0 : 5 })
      .then(buffer => parseWithDeadline(loader,buffer,resolveAsset('./models/landmarks/'),abort.signal))
      .then(gltf => {
        if (disposed) { disposeObjects(gltf.scene); throw new DOMException('Disposed', 'AbortError'); }
        gltf.scene.traverse(o => {
          const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
          mesh.castShadow = false; mesh.receiveShadow = true;
          (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(enhanceMaterial);
        });
        const entry: CacheEntry = { scene: gltf.scene, used: clock, level }; cache.set(path, entry); return entry;
      }).finally(() => pending.delete(path));
    pending.set(path,promise); return promise;
  };
  function updateCollision(ranked: {e:Entry;d:number}[]) {
    if (!options.onCollision) return;
    const desired = ranked.filter(({e}) => Math.hypot(cameraPosition.x-e.landmark.group.position.x,
      cameraPosition.z-e.landmark.group.position.z)<350 && cameraPosition.y-e.landmark.group.position.y<120).slice(0,4);
    collisionDesired = new Set(desired.map(({e}) => e.def.id));
    for(const [id] of collisionBindings)if(!collisionDesired.has(id)){
      options.onCollision(id,null);collisionBindings.delete(id);
    }
    for(const {e} of desired) {
      if(collisionBindings.has(e.def.id))continue;
      const path=e.def.collision;
      if ((collisionFailures.get(path) ?? -Infinity) > clock-30) continue;
      let promise=collisionPending.get(path);
      if(!promise){
        const cached=collisionCache.get(path);
        promise=(cached?Promise.resolve(cached.scene):fetchAssetBytes(path,{signal:abort.signal,timeoutMs:20000,priority:6})
          .then(bytes=>parseWithDeadline(loader,bytes,resolveAsset('./models/landmarks/'),abort.signal))
          .then(gltf=>{
            if(disposed){disposeObjects(gltf.scene);throw new DOMException('Disposed','AbortError');}
            collisionCache.set(path,{scene:gltf.scene,used:clock});return gltf.scene;
          })).finally(()=>collisionPending.delete(path));
        collisionPending.set(path,promise);
      }
      void promise.then(scene=>{
        if(disposed||!collisionDesired.has(e.def.id)||collisionBindings.has(e.def.id))return;
        const object=new THREE.Group();object.name=e.def.id+' collision';
        object.position.copy(e.landmark.group.position);object.quaternion.copy(e.landmark.group.quaternion);
        object.add(scene.clone(true));object.updateMatrixWorld(true);collisionBindings.set(e.def.id,object);
        const cached=collisionCache.get(path);if(cached)cached.used=clock;
        options.onCollision?.(e.def.id,object);
      }).catch(error=>{if(!disposed){const last=collisionFailures.get(path);collisionFailures.set(path,clock);if(last===undefined||last<clock-29)console.warn(`地标碰撞代理 ${e.def.id} 暂未就绪`,error);}});
    }
    const used=new Set(entries.filter(e=>collisionDesired.has(e.def.id)).map(e=>e.def.collision));
    const unused=[...collisionCache.entries()].filter(([path])=>!used.has(path)).sort((a,b)=>a[1].used-b[1].used);
    for(const [path,entry]of unused.slice(0,Math.max(0,collisionCache.size-4))){collisionCache.delete(path);disposeObjects(entry.scene);}
  }
  function evict() {
    // A parsed asset can enter the cache just before its awaiting job installs the clone.
    const pathsInUse = new Set(entries.flatMap(e => [e.level,e.pending].filter((level):level is Level=>!!level).map(level=>e.def.lod[level])));
    const unused = [...cache.entries()].filter(([path, item]) => item.level !== 'far' && !pathsInUse.has(path)).sort((a,b) => a[1].used-b[1].used);
    const max = quality === 'low' ? 4 : 8;
    const detailCount = [...cache.values()].filter(c => c.level !== 'far').length;
    for (const [path,item] of unused.slice(0,Math.max(0,detailCount-max))) { cache.delete(path); disposeObjects(item.scene); }
  }
  function pump() {
    if (disposed) return;
    queue.sort((a,b) => a.priority-b.priority);
    while (active < 3 && queue.length) {
      const job = queue.shift()!;
      if (job.generation !== job.entry.generation) { job.done(); continue; }
      active++;
      void load(job.entry.def,job.level).then(asset => {
        if (disposed || job.generation !== job.entry.generation) return;
        const e = job.entry; const next = asset.scene.clone(true);
        if (e.object) e.landmark.group.remove(e.object);
        e.placeholder.visible = false; e.object = next; e.level = job.level; e.failed = false;
        e.landmark.group.add(next); asset.used = clock;
        options.onEach?.(e.def,e.landmark.group,e.landmark);
      }).catch(error => {
        if (disposed || job.generation !== job.entry.generation) return;
        job.entry.failed = true;
        // Keep the last successful LOD visible. A failed asset never removes its label.
        console.warn(`地标 ${job.entry.def.name} 加载失败，保留占位或已加载模型`,error);
      }).finally(() => {
        if (job.generation === job.entry.generation) {job.entry.pending = undefined;job.entry.task = undefined;}
        active--; job.done(); evict(); pump();
      });
    }
  }
  function request(entry: Entry, level: Level, priority: number) {
    if (disposed || entry.failed || (entry.level === level && !entry.pending)) return Promise.resolve();
    if (entry.pending === level) return entry.task ?? Promise.resolve();
    entry.generation++; entry.pending = level;
    entry.task = new Promise<void>(done => { queue.push({entry,level,priority,generation:entry.generation,done}); pump(); });
    return entry.task;
  }
  function selectLevels(camera: THREE.Camera, hysteresis: boolean) {
    camera.getWorldPosition(cameraPosition);
    const ranked = entries.map(e => ({e,d:cameraPosition.distanceTo(e.landmark.lookAnchor ?? e.landmark.anchor)})).sort((a,b) => a.d-b.d);
    let detail = 0;
    const limit = quality === 'low' ? 4 : 8;
    const selection = ranked.map(({e,d}) => {
      const [near,far] = e.def.lod.distancesM;
      const multiplier = quality === 'high' ? 1.3 : quality === 'low' ? .45 : 1;
      let level: Level = d < near*multiplier && quality !== 'low' ? 'near' : d < far*multiplier ? 'medium' : 'far';
      if (level !== 'far' && ++detail > limit) level = 'far';
      if (hysteresis && detail <= limit) {
        if (e.level === 'near' && level === 'medium' && d < near*multiplier*1.15) level = 'near';
        if (e.level === 'medium' && level === 'far' && d < far*multiplier*1.15) level = 'medium';
      }
      return {e,d,level};
    });
    return {ranked,selection};
  }
  const first = entries.filter(e => ['taihedian','wumen','tiananmen','qiniandian'].includes(e.def.model));
  let finished = 0;
  const ready = Promise.all(first.map(e => request(e,'medium',-100).then(() => options.onProgress?.(++finished/first.length,`加载重点地标 ${finished}/${first.length}`))))
    .then(() => {
      // An immediate user jump/capture may already have chosen a closer detail level.
      if (!disposed) entries.filter(e => !first.includes(e) && !e.level && !e.pending).forEach(e => void request(e,'far',10));
    });
  return {
    group, landmarks: entries.map(e => e.landmark), ready,
    update(camera, deltaSeconds = 1/60) {
      if (disposed) return; clock += deltaSeconds; tick += deltaSeconds; if (tick < .3) return; tick = 0;
      const {ranked,selection} = selectLevels(camera,true);
      updateCollision(ranked);
      for (const {e,d,level} of selection) void request(e,level,d/1000);
    },
    async prepareView(camera) {
      // Fixed captures choose distance bands directly; previous camera history cannot change the result.
      const {selection} = selectLevels(camera,false);
      await Promise.all(selection.map(({e,d,level}) => request(e,level,-20+d/1000)));
      const failed = selection.filter(({e,level}) => e.failed || e.level !== level);
      if (!disposed && failed.length) throw new Error(`地标模型未就绪：${failed.map(({e})=>e.def.name).join('、')}`);
    },
    setQuality(next) { quality = next; tick = 1; },
    setGroundSampler(sampler) {
      for (const e of entries) {
        const p=e.landmark.group.position; const ground=sampler(p.x,p.z);
        if (!Number.isFinite(ground)) continue;
        p.y=ground;e.landmark.anchor.y=ground+e.def.labelH;
        if(e.landmark.lookAnchor)e.landmark.lookAnchor.y=ground+e.def.lookAnchor[1];
        if(e.object)options.onEach?.(e.def,e.landmark.group,e.landmark);
        const collision=collisionBindings.get(e.def.id);if(collision){collision.position.y=ground;collision.updateMatrixWorld(true);options.onCollision?.(e.def.id,collision);}
      }
    },
    retryFailed() { collisionFailures.clear();entries.filter(e => e.failed).forEach(e => {e.failed=false;void request(e,e.level ?? 'far',0);}); },
    stats: () => ({cached:cache.size,pending:pending.size+queue.length,failed:entries.filter(e=>e.failed).length,visible:entries.filter(e=>e.object).length}),
    dispose() {
      if (disposed) return; disposed = true; abort.abort(); queue.splice(0).forEach(job => job.done());
      entries.forEach(e => {group.remove(e.landmark.group);disposeObjects(e.placeholder);});
      collisionBindings.forEach((_,id)=>options.onCollision?.(id,null));collisionBindings.clear();
      collisionCache.forEach(item=>disposeObjects(item.scene));collisionCache.clear();
      cache.forEach(item => disposeObjects(item.scene));cache.clear();ktx?.dispose();
    },
  };
}

/** Old entry point remains usable; new runtime should own the manager lifecycle. */
export async function loadLegacyLandmarks(onProgress: (fraction:number,label:string)=>void,
  onEach:(def:LegacyDef,object:THREE.Object3D,landmark:Landmark)=>void,
  options: LandmarkManagerOptions & {renderer?:THREE.WebGLRenderer} = {}): Promise<void> {
  const manager = createLandmarkModelManager(options.renderer,{...options,onProgress,onEach});
  await manager.ready;
}
