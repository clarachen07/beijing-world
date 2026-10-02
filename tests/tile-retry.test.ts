import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import * as THREE from 'three';
import { TileManager } from '../src/tiles';
import { CollisionWorld } from '../src/collision';
import type { CityLoader } from '../src/loader';
import type { Manifest, DecodedMesh, TileDescriptor } from '../src/data';

function browserStubs(fetcher: typeof fetch, bitmapClosed: () => void) {
  const values = {
    window: { innerHeight: 900 },
    document: { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) },
    fetch: fetcher,
    createImageBitmap: async () => ({ width: 1, height: 1, close: bitmapClosed }),
  };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
  return () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
}

function fixture() {
  const descriptor: TileDescriptor = {
    id: 'root', lod: 2, size: 200, bounds: [-100, -100, 100, 100], ox: 0, oz: 0, meshes: {},
    ground: { mesh: { file: 'fixture-ground.bin', v: 3, i: 3 }, texture: { file: 'fixture-imagery.jpg', bounds: [-100, -100, 100, 100] } },
  };
  const ground: DecodedMesh = { positions: new Float32Array([-10, 0, -10, 10, 0, -10, 0, 0, 10]), colors: new Uint8Array(9).fill(255), indices: new Uint32Array([0, 1, 2]) };
  const manifest: Manifest = {
    version: 2, revision: 'fixture', origin: { lat: 39.9475, lon: 116.41 }, bounds: descriptor.bounds, tiles: [descriptor],
    coverage: { boundaryFile: 'fixture.json', verified: true, scope: 'fixture', date: '2026-10-02' }, sources: [], stats: {},
  };
  const loader = { loadTile: async () => ({ descriptor, meshes: {}, ground }) } as unknown as CityLoader;
  const manager = new TileManager(manifest, loader, new CollisionWorld());
  const camera = new THREE.PerspectiveCamera(55, 1, 1, 50000);
  camera.position.set(0, 20, 40); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  return { manager, camera };
}

async function pump<T>(promise: Promise<T>, manager: TileManager, camera: THREE.PerspectiveCamera): Promise<T> {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  for (let frame = 0; frame < 100 && !settled; frame++) { manager.update(camera); await setImmediate(); }
  assert.ok(settled, 'The fixture must settle within its frame budget');
  return promise;
}

test('a failed ground image can be retried without retaining its rejected shared texture', async () => {
  let fetches = 0, closed = 0, online = false;
  const restore = browserStubs(async () => {
    fetches++;
    if (!online) throw new Error('simulated imagery outage');
    return new Response(new Uint8Array([1, 2, 3]));
  }, () => { closed++; });
  const { manager, camera } = fixture(); const statuses: string[] = [];
  manager.onStatus = text => { statuses.push(text); };
  try {
    await assert.rejects(pump(manager.initialize(camera), manager, camera), /simulated imagery outage/);
    assert.equal(fetches, 1); assert.equal(manager.stats.failed, 1);
    assert.ok(statuses.some(text => text.includes('可点击重试')));
    online = true; manager.retryFailed();
    await pump(manager.initialize(camera), manager, camera);
    assert.equal(fetches, 2, 'Retry must perform a fresh download after a transient image failure');
    assert.equal(manager.stats.failed, 0); assert.equal(manager.stats.loaded, 1);
    let imageVisible = false;
    manager.group.traverse(object => {
      if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshLambertMaterial && object.material.map) imageVisible = true;
    });
    assert.ok(imageVisible, 'The successful image must reach the replacement ground material');
    assert.equal(closed, 0);
  } finally { manager.dispose(); restore(); }
  assert.equal(closed, 1, 'The successful bitmap has exactly one owner and is closed on disposal');
});

test('intentional tile disposal cancels a ground image without raising a retry warning', async () => {
  let started = false;
  const restore = browserStubs(async (_url, options) => {
    started = true;
    return new Promise<Response>((_resolve, reject) => {
      const signal = options?.signal;
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }, () => {});
  const { manager, camera } = fixture(); const statuses: string[] = [];
  manager.onStatus = text => { statuses.push(text); };
  try {
    const initializing = manager.initialize(camera);
    for (let frame = 0; frame < 20 && !started; frame++) { manager.update(camera); await setImmediate(); }
    assert.ok(started); manager.dispose();
    await assert.rejects(initializing, { name: 'AbortError' }); await setImmediate();
    assert.deepEqual(statuses, [], 'A removed tile must not turn cancellation into a visible load failure');
  } finally { manager.dispose(); restore(); }
});
