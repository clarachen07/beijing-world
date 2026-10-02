import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import * as THREE from 'three';
import { CityLoader } from '../src/loader';
import { TileManager } from '../src/tiles';
import { CollisionWorld } from '../src/collision';
import { uniforms } from '../src/materials';
import type { Manifest, TileDescriptor } from '../src/data';

function meshBytes(roof: boolean) {
  const buffer = new ArrayBuffer(65), view = new DataView(buffer);
  view.setUint32(0, 3, true); view.setUint32(4, 3, true);
  const positions = roof ? [0, 2, 0, 10, 2, 0, 5, 6, 10] : [0, 0, 0, 10, 0, 0, 5, 0, 10];
  positions.forEach((value, index) => view.setFloat32(8 + index * 4, value, true));
  new Uint8Array(buffer, 44, 9).fill(160);
  [0, 2, 1].forEach((value, index) => view.setUint32(53 + index * 4, value, true));
  return buffer;
}
function descriptor(roofs: boolean): TileDescriptor {
  return { id: 'fixture-root', lod: 2, size: 200, bounds: [-100, -100, 100, 100], ox: 0, oz: 0,
    meshes: { buildings: { file: 'fixture-walls.bin', v: 3, i: 3, q: 'f32' },
      ...(roofs ? { roofs: { file: 'fixture-roofs.bin', v: 3, i: 3, q: 'f32' as const } } : {}) } };
}

// Executes the actual worker entry, including structured-clone transfer semantics.
// Browser thread scheduling and GPU shader compilation remain integration checks.
class DecoderWorker {
  static instances: DecoderWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  detachedInputs = 0; detachedOutputs = 0; terminated = false;
  private readonly channel: { onmessage?: (event: { data: unknown }) => Promise<void>; postMessage: (data: unknown, options: { transfer: ArrayBuffer[] }) => void };
  private readonly loaded: Promise<unknown>;
  constructor() {
    DecoderWorker.instances.push(this);
    this.channel = { postMessage: (data, options) => {
      const copy = structuredClone(data, { transfer: options.transfer });
      this.detachedOutputs += options.transfer.filter(buffer => buffer.byteLength === 0).length;
      if (!this.terminated) this.onmessage?.({ data: copy });
    } };
    Object.defineProperty(globalThis, 'self', { configurable: true, value: this.channel });
    this.loaded = import('../src/decode.worker');
  }
  postMessage(message: { buffer: ArrayBuffer }, transfer: ArrayBuffer[]) {
    const copy = structuredClone(message, { transfer });
    this.detachedInputs += transfer.filter(buffer => buffer.byteLength === 0).length;
    void this.loaded.then(() => this.channel.onmessage?.({ data: copy })).catch(error => this.onerror?.(error));
  }
  terminate() { this.terminated = true; }
}

function globals(worker: boolean) {
  const values: Record<string, unknown> = {
    window: { innerHeight: 900 }, self: undefined, Worker: worker ? DecoderWorker : undefined,
    document: { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) },
    fetch: async (url: string) => new Response(meshBytes(String(url).includes('roofs'))),
  };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
  return () => { for (const [key, value] of previous) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); } };
}

test('optional roof meshes pass the fallback and actual decoder worker transfer protocol', async () => {
  for (const useWorker of [false, true]) {
    const restore = globals(useWorker), loader = new CityLoader();
    try {
      const withRoof = await loader.loadTile(descriptor(true)), withoutRoof = await loader.loadTile(descriptor(false));
      assert.deepEqual(Object.keys(withRoof.meshes).sort(), ['buildings', 'roofs']);
      assert.equal(withRoof.meshes.roofs!.positions[7], 6); assert.equal(withRoof.meshes.buildings!.positions[7], 0);
      assert.deepEqual([...withRoof.meshes.roofs!.indices], [0, 2, 1]);
      assert.deepEqual(Object.keys(withoutRoof.meshes), ['buildings']); assert.equal(withoutRoof.meshes.roofs, undefined);
      if (useWorker) {
        const worker = DecoderWorker.instances.at(-1)!;
        assert.equal(worker.detachedInputs, 3); assert.equal(worker.detachedOutputs, 9);
        loader.dispose(); assert.equal(worker.terminated, true);
      }
    } finally { loader.dispose(); restore(); }
  }
});

test('roof geometry contributes to tile budgets and is released without disposing shared roof material', async () => {
  const restore = globals(false), loader = new CityLoader(), tile = descriptor(true);
  const manifest: Manifest = { version: 2, revision: 'roof-fixture', origin: { lat: 39.9475, lon: 116.41 }, bounds: tile.bounds,
    tiles: [tile], coverage: { boundaryFile: 'fixture.json', verified: true, scope: 'fixture', date: '2026-10-02' }, sources: [], stats: {} };
  const manager = new TileManager(manifest, loader, new CollisionWorld());
  try {
    const camera = new THREE.PerspectiveCamera(55, 1, 1, 50000); camera.position.set(0, 20, 40); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    let ready = false; const initializing = manager.initialize(camera).then(() => { ready = true; });
    for (let frame = 0; frame < 100 && !ready; frame++) { manager.update(camera); await setImmediate(); }
    assert.equal(ready, true); await initializing; manager.update(camera);
    assert.equal(manager.stats.meshBytes, 114); assert.equal(manager.stats.triangles, 2);
    const meshes: THREE.Mesh[] = []; manager.group.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
    assert.equal(meshes.length, 2);
    const roof = meshes.find(mesh => mesh.material === manager.materials.layers.roofs)!;
    assert.ok(roof); assert.notEqual(roof.material, manager.materials.layers.buildings);
    assert.equal(manager.materials.layers.roofs.flatShading, true);
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader } as Parameters<THREE.Material['onBeforeCompile']>[0];
    manager.materials.layers.roofs.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    assert.equal(shader.uniforms.uNight, uniforms.uNight, 'Roof daylight/night state must follow the shared scene uniform');
    let geometryDisposed = 0, roofMaterialDisposed = 0;
    meshes.forEach(mesh => mesh.geometry.addEventListener('dispose', () => { geometryDisposed++; }));
    manager.materials.layers.roofs.addEventListener('dispose', () => { roofMaterialDisposed++; });
    const object = (manager as unknown as { entries: Map<string, { object: { dispose(): void } }> }).entries.get(tile.id)!.object;
    object.dispose(); object.dispose();
    assert.equal(geometryDisposed, 2); assert.equal(roofMaterialDisposed, 0);
    manager.dispose(); assert.equal(geometryDisposed, 2); assert.equal(roofMaterialDisposed, 1);
  } finally { loader.dispose(); restore(); }
});
