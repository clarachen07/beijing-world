import * as THREE from 'three';
import type { Manifest, TileDescriptor, DecodedTile } from './data';
import { CityLoader } from './loader';
import { fetchAssetJSON } from './asset-fetch';
import { CityMaterials, buildCityTile, tileBox, type CityTile } from './city';
import type { CollisionWorld, TileCollisionData } from './collision';

interface TileEntry {
  descriptor: TileDescriptor; box: THREE.Box3; object?: CityTile;
  collision?: TileCollisionData; collisionActive?: boolean;
  controller?: AbortController; touched: number; failed?: string;
  promise?: Promise<void>; resolve?: () => void; reject?: (error: unknown) => void;
}
interface BuildJob { entry: TileEntry; data: DecodedTile; collision?: TileCollisionData }

/** Hierarchical selection is independent from asynchronous loading, so tests can inspect it. */
export function chooseTiles(manifest: Manifest, camera: THREE.PerspectiveCamera, viewportHeight: number, maxError = 16): Set<string> {
  const byId = new Map(manifest.tiles.map(tile => [tile.id, tile]));
  const childIds = new Set(manifest.tiles.flatMap(tile => tile.children ?? []));
  const roots = manifest.tiles.filter(tile => !childIds.has(tile.id));
  const matrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(matrix);
  const selected = new Set<string>();
  const visit = (tile: TileDescriptor) => {
    const box = tileBox(tile.bounds);
    if (!frustum.intersectsBox(box)) return;
    const distance = Math.max(60, box.distanceToPoint(camera.position));
    const error = (tile.geometricError ?? [0, 12, 70][tile.lod]) * viewportHeight / (2 * Math.tan(camera.fov * Math.PI / 360) * distance);
    if (tile.children?.length && error > maxError) {
      for (const id of tile.children) { const child = byId.get(id); if (child) visit(child); }
    } else selected.add(tile.id);
  };
  for (const root of roots) visit(root);
  return selected;
}

export class TileManager {
  readonly group = new THREE.Group(); readonly materials = new CityMaterials();
  private entries = new Map<string, TileEntry>(); private roots: TileEntry[] = [];
  private parent = new Map<string, string>(); private wanted = new Set<string>(); private required = new Set<string>();
  private collisionWanted = new Set<string>(); private builds: BuildJob[] = [];
  private prefetch = new Map<string, number>();
  private disposed = false; private nextSelection = 0; private maxError = 16;
  private initializing = true;
  onStatus: ((message: string, failed: boolean) => void) | null = null;
  constructor(readonly manifest: Manifest, readonly loader: CityLoader, readonly collision: CollisionWorld, readonly mobile = false) {
    for (const descriptor of manifest.tiles) {
      this.entries.set(descriptor.id, { descriptor, box: tileBox(descriptor.bounds), touched: 0 });
      for (const child of descriptor.children ?? []) this.parent.set(child, descriptor.id);
    }
    this.roots = [...this.entries.values()].filter(entry => !this.parent.has(entry.descriptor.id));
    this.group.name = 'city'; this.maxError = mobile ? 26 : 16;
  }
  async initialize(camera: THREE.PerspectiveCamera) {
    camera.updateMatrixWorld(); this.select(camera, 'browse');
    const nearest = this.roots.filter(root => this.required.has(root.descriptor.id)).sort((a, b) => a.box.distanceToPoint(camera.position) - b.box.distanceToPoint(camera.position))[0] ?? this.roots[0];
    this.required.add(nearest.descriptor.id);
    await this.request(nearest, 100);
    await nearest.object?.ready;
    this.initializing = false; this.nextSelection = 0;
  }
  private request(entry: TileEntry, priority = 0): Promise<void> {
    if (entry.object) return Promise.resolve();
    if (entry.promise) return entry.promise;
    if (entry.failed) return Promise.reject(new Error(entry.failed));
    const controller = new AbortController(); entry.controller = controller;
    entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
    const options = { signal: controller.signal, priority };
    Promise.all([
      this.loader.loadTile(entry.descriptor, options),
      entry.descriptor.lod === 0 && entry.descriptor.collision
        ? fetchAssetJSON<TileCollisionData>(`data/${entry.descriptor.collision.file}`, options) : undefined,
    ]).then(([data, collision]) => {
      if (this.disposed || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      this.builds.push({ entry, data, collision });
    }).catch(error => {
      entry.reject?.(error); entry.promise = undefined; entry.controller = undefined;
      if (!controller.signal.aborted && !this.disposed) {
        entry.failed = error instanceof Error ? error.message : String(error);
        this.onStatus?.('部分区域加载失败，可点击重试', true);
      }
    });
    return entry.promise;
  }
  private select(camera: THREE.PerspectiveCamera, mode: string) {
    this.wanted = chooseTiles(this.manifest, camera, window.innerHeight, this.initializing ? Infinity : this.maxError);
    if (this.initializing) {
      const nearest = [...this.wanted].map(id=>this.entries.get(id)!).sort((a,b)=>a.box.distanceToPoint(camera.position)-b.box.distanceToPoint(camera.position))[0];
      this.wanted = new Set(nearest ? [nearest.descriptor.id] : [this.roots[0].descriptor.id]);
    }
    this.required = new Set(this.wanted);
    this.collisionWanted.clear();
    // Always keep a coarse ancestor available until every selected child is ready.
    for (const id of this.wanted) {
      let parent = this.parent.get(id);
      while (parent) { this.required.add(parent); parent = this.parent.get(parent); }
    }
    if (mode === 'walk') for (const entry of this.entries.values()) {
      if (entry.descriptor.lod === 0 && entry.box.distanceToPoint(new THREE.Vector3(camera.position.x, 0, camera.position.z)) < 180) {
        this.collisionWanted.add(entry.descriptor.id); this.required.add(entry.descriptor.id);
      }
    }
    const now = performance.now();
    for (const [id, until] of this.prefetch) { if (until > now) this.required.add(id); else this.prefetch.delete(id); }
    for (const id of this.required) this.entries.get(id)!.touched = now;
    const pending = [...this.required].map(id => this.entries.get(id)!).filter(entry => !entry.object && !entry.promise && !entry.failed);
    pending.sort((a, b) => b.descriptor.lod - a.descriptor.lod || a.box.distanceToPoint(camera.position) - b.box.distanceToPoint(camera.position));
    let active = [...this.entries.values()].filter(entry => entry.promise).length;
    for (const entry of pending) {
      if (active >= 10) break;
      void this.request(entry, entry.descriptor.lod * 20 - entry.box.distanceToPoint(camera.position) / 1000).catch(() => {}); active++;
    }
    for (const entry of this.entries.values()) if (entry.controller && !this.required.has(entry.descriptor.id) && now - entry.touched > 1000) entry.controller.abort();
  }
  private display(entry: TileEntry): { objects: CityTile[]; complete: boolean } {
    if (this.wanted.has(entry.descriptor.id)) return { objects: entry.object ? [entry.object] : [], complete: !!entry.object };
    const selectedChildren = (entry.descriptor.children ?? []).map(id => this.entries.get(id)!).filter(child => this.required.has(child.descriptor.id));
    if (!selectedChildren.length) return { objects: [], complete: true };
    const branches = selectedChildren.map(child => this.display(child));
    if (branches.every(branch => branch.complete)) return { objects: branches.flatMap(branch => branch.objects), complete: true };
    return { objects: entry.object ? [entry.object] : [], complete: !!entry.object };
  }
  update(camera: THREE.PerspectiveCamera, mode = 'browse') {
    if (this.disposed) return;
    const now = performance.now();
    if (now >= this.nextSelection) { this.select(camera, mode); this.nextSelection = now + 180; }
    const budget = this.mobile ? 6 : 4, start = performance.now();
    while (this.builds.length && performance.now() - start < budget) {
      const job = this.builds.shift()!, { entry } = job;
      if (entry.controller?.signal.aborted || !this.required.has(entry.descriptor.id)) {
        entry.reject?.(new DOMException('Aborted', 'AbortError')); entry.promise = undefined; entry.controller = undefined; continue;
      }
      try {
        entry.object = buildCityTile(job.data, this.materials, this.mobile);
        entry.object.group.visible = false; this.group.add(entry.object.group); entry.collision = job.collision;
        const object = entry.object;
        object.ready.catch(error => {
          if (this.disposed || entry.object !== object) return;
          entry.failed = String(error);
          this.onStatus?.('部分地表影像加载失败，可点击重试', true);
        });
        entry.resolve?.(); entry.promise = undefined; entry.controller = undefined;
      } catch (error) {
        entry.object?.dispose(); entry.object = undefined; entry.failed = String(error); entry.reject?.(error); entry.promise = undefined; entry.controller = undefined;
        this.onStatus?.('部分区域组装失败，可点击重试',true);
      }
    }
    this.updateCollision(camera.position, mode === 'walk' || camera.position.y < 120);
    const visible = new Set(this.roots.flatMap(root => this.display(root).objects));
    for (const entry of this.entries.values()) if (entry.object) entry.object.group.visible = visible.has(entry.object);
    const maximum = this.mobile ? 90 : 180;
    const resident = [...this.entries.values()].filter(entry => entry.object);
    const bytes = resident.reduce((sum, entry) => sum + entry.object!.bytes, 0);
    if (resident.length > maximum || bytes > (this.mobile ? 64 : 192) * 1048576 || resident.some(entry => !this.required.has(entry.descriptor.id) && now-entry.touched > 15000)) {
      const removable = resident.filter(entry => !this.required.has(entry.descriptor.id) && !visible.has(entry.object!)).sort((a, b) => a.touched - b.touched);
      let count = resident.length, memory = bytes;
      for (const entry of removable) {
        if (count <= maximum && memory <= (this.mobile ? 64 : 192) * 1048576 && now-entry.touched <= 15000) continue;
        memory -= entry.object!.bytes; this.remove(entry); count--;
      }
    }
  }
  async ensureNear(position: THREE.Vector3) {
    const point = new THREE.Vector3(position.x, 0, position.z);
    const entries = [...this.entries.values()].filter(entry => entry.descriptor.lod === 0 && entry.box.distanceToPoint(point) < 90);
    for (const entry of entries) { this.required.add(entry.descriptor.id); entry.touched = performance.now(); this.prefetch.set(entry.descriptor.id, performance.now() + 15_000); }
    await Promise.all(entries.map(entry => this.request(entry, 120)));
    this.updateCollision(position,true);
  }
  private updateCollision(position: THREE.Vector3, enabled: boolean) {
    const point = new THREE.Vector3(position.x,0,position.z);
    for (const entry of this.entries.values()) {
      const active = enabled && !!entry.collision && entry.box.distanceToPoint(point) < 180;
      if (active && !entry.collisionActive) {
        try { this.collision.updateTile(entry.descriptor.id,entry.collision!); entry.collisionActive = true; }
        catch (error) {
          this.collision.removeTile(entry.descriptor.id); entry.collision = undefined; entry.failed = String(error);
          this.onStatus?.('附近街道数据异常，请重试后再漫步',true);
        }
      }
      else if (!active && entry.collisionActive) { this.collision.removeTile(entry.descriptor.id); entry.collisionActive = false; }
    }
  }
  async prepareView(camera: THREE.PerspectiveCamera) {
    this.select(camera,'browse');
    const entries = [...this.wanted].map(id => this.entries.get(id)!);
    const now = performance.now();
    for (const entry of entries) this.prefetch.set(entry.descriptor.id,now+15000);
    await Promise.all(entries.map(entry => this.request(entry,100).then(() => entry.object?.ready)));
  }
  setQuality(level: number) { this.maxError = (this.mobile ? 26 : 16) * (1 + level * 0.5); this.nextSelection = 0; }
  retryFailed() {
    for (const entry of this.entries.values()) if (entry.failed) { this.remove(entry); entry.failed = undefined; }
    this.nextSelection = 0;
  }
  get stats() {
    const loaded = [...this.entries.values()].filter(entry => entry.object);
    return { loaded: loaded.length, pending: [...this.entries.values()].filter(entry => entry.promise).length,
      visible: loaded.filter(entry => entry.object!.group.visible).length,
      meshBytes: loaded.reduce((sum, entry) => sum + entry.object!.bytes, 0),
      triangles: loaded.filter(entry => entry.object!.group.visible).reduce((sum, entry) => sum + entry.object!.triangles, 0),
      failed: [...this.entries.values()].filter(entry => entry.failed).length };
  }
  private remove(entry: TileEntry) { entry.object?.dispose(); entry.object = undefined; entry.collision = undefined; entry.collisionActive = false; this.collision.removeTile(entry.descriptor.id); }
  dispose() {
    this.disposed = true;
    for (const entry of this.entries.values()) { entry.controller?.abort(); entry.reject?.(new DOMException('Aborted', 'AbortError')); this.remove(entry); }
    this.builds.length = 0; this.group.removeFromParent(); this.materials.dispose();
  }
}
