import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';
import { Octree } from 'three/examples/jsm/math/Octree.js';
import { CameraControl } from '../src/controls';
import { CollisionWorld, type TileCollisionData, WALK_EYE_HEIGHT } from '../src/collision';
import { tourPose } from '../src/tour';

function control(x = 0, y = 100, z = 0) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, y, z);
  camera.lookAt(x, y, z - 100);
  return new CameraControl(camera, {} as HTMLElement, { bindEvents: false });
}
function advance(controller: CameraControl, seconds: number, fps = 60) {
  for (let i = 0; i < Math.round(seconds * fps); i++) controller.update(1 / fps);
}
function flatData(): TileCollisionData {
  return { buildings: [], water: [], ground: { width: 2, height: 2, origin: [-50, -50], step: 100, heights: [0, 0, 0, 0] } };
}
function world(data = flatData()) { const result = new CollisionWorld(); result.updateTile('near', data); return result; }
const square = (radius: number): [number, number][] => [[-radius, -radius], [radius, -radius], [radius, radius], [-radius, radius], [-radius, -radius]];

test('browse starts without changing an existing camera pose', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(100, 80, 150);
  camera.lookAt(150, 40, 0);
  const before = camera.quaternion.clone();
  const controller = new CameraControl(camera, {} as HTMLElement, { bindEvents: false });
  assert.equal(controller.mode, 'browse');
  assert.ok(before.angleTo(camera.quaternion) < 1e-7);
  controller.update(1 / 60);
  assert.ok(before.angleTo(camera.quaternion) < 1e-7);
  controller.dispose();
});

test('movement input interrupts a landmark transition with its current complete pose', () => {
  const controller = control();
  controller.setMode('fly');
  controller.flyTo(new THREE.Vector3(1000, 100, 0), 500);
  advance(controller, 1.3);
  const position = controller.camera.position.clone();
  const rotation = controller.camera.quaternion.clone();
  controller.setKey('KeyW', true);
  assert.equal(controller.flying, false);
  assert.ok(controller.camera.position.distanceTo(position) < 1e-9);
  assert.ok(rotation.angleTo(controller.camera.quaternion) < 1e-7);
  controller.update(1 / 60);
  assert.ok(rotation.angleTo(controller.camera.quaternion) < 1e-7);
  assert.ok(controller.camera.position.distanceTo(position) < 1);
});

test('a mode change cancels a transition and notifies exactly once per actual mode change', () => {
  const controller = control();
  const changes: string[] = [];
  controller.onModeChange = (mode, previous) => changes.push(`${previous}:${mode}`);
  controller.flyTo(new THREE.Vector3(1000, 100, 0), 500);
  advance(controller, 0.5);
  const position = controller.camera.position.clone();
  controller.setMode('fly');
  assert.equal(controller.flying, false);
  controller.update(1 / 60);
  assert.ok(controller.camera.position.distanceTo(position) < 1e-9);
  assert.deepEqual(changes, ['browse:fly']);
});

test('the tour clamps at its exact end and replay begins with a smooth transition', () => {
  const controller = control();
  controller.setMode('tour');
  advance(controller, 2);
  controller.tourT = 0.9999;
  controller.update(0.1);
  assert.equal(controller.tourT, 1);
  assert.equal(controller.tourFinished, true);
  const end = controller.camera.position.clone();
  advance(controller, 1);
  assert.ok(controller.camera.position.distanceTo(end) < 1e-9);
  assert.equal(controller.nightOverride, 1);
  controller.replayTour();
  assert.equal(controller.tourT, 0);
  assert.ok(controller.camera.position.distanceTo(end) < 1e-9);
  controller.update(1 / 60);
  assert.ok(controller.camera.position.distanceTo(end) < 10);
  assert.equal(controller.flying, true);
  advance(controller, 2);
  assert.equal(controller.flying, false);
  assert.ok(controller.tourT > 0 && controller.tourT < 0.01);
  const position = new THREE.Vector3(), look = new THREE.Vector3();
  assert.equal(tourPose(2, position, look), 1);
  assert.ok(position.distanceTo(end) < 1e-9);
});

test('free movement integration is identical at 30 and 60 FPS', () => {
  const a = control(), b = control();
  for (const controller of [a, b]) { controller.setMode('fly'); controller.setKey('KeyW', true); }
  advance(a, 5, 60); advance(b, 5, 30);
  assert.ok(a.camera.position.distanceTo(b.camera.position) < 1e-7);
});

test('clearing input stops a held movement key without residual drift', () => {
  const controller = control();
  controller.setMode('fly'); controller.setKey('KeyW', true);
  advance(controller, 0.5);
  controller.clearInput();
  const position = controller.camera.position.clone();
  advance(controller, 1);
  assert.ok(controller.camera.position.distanceTo(position) < 1e-9);
});

test('capture resume adopts the complete external pose and stops old navigation', () => {
  const controller = control();
  controller.setMode('fly'); controller.setKey('KeyW', true); advance(controller, 0.5);
  controller.flyTo(new THREE.Vector3(1000, 100, 0), 500);
  controller.camera.position.set(300, 500, 900); controller.camera.lookAt(100, 40, -20);
  const position = controller.camera.position.clone(), rotation = controller.camera.quaternion.clone();
  controller.adoptPose(); advance(controller, 1);
  assert.equal(controller.mode, 'browse'); assert.equal(controller.flying, false);
  assert.ok(controller.camera.position.distanceTo(position) < 1e-8);
  assert.ok(rotation.angleTo(controller.camera.quaternion) < 1e-7);
});

test('walk cannot start without loaded ground, and uses real walk/run speeds', () => {
  const controller = control(-20, 2, 0);
  assert.equal(controller.setMode('walk'), false);
  assert.equal(controller.mode, 'browse');
  controller.setCollisionWorld(world());
  assert.equal(controller.setMode('walk'), true);
  assert.equal(controller.camera.position.y, WALK_EYE_HEIGHT);
  assert.equal(controller.camera.near, 0.08);
  controller.setKey('KeyW', true);
  advance(controller, 1);
  const walked = controller.camera.position.clone();
  advance(controller, 1);
  assert.ok(Math.abs(controller.camera.position.distanceTo(walked) - 1.6) < 1e-5);
  controller.setKey('ShiftLeft', true);
  advance(controller, 1);
  const ran = controller.camera.position.clone();
  advance(controller, 1);
  assert.ok(Math.abs(controller.camera.position.distanceTo(ran) - 4.2) < 1e-5);
});

test('walking stops at unloaded boundaries and leaves walk safely if the active tile is removed', () => {
  const collision = world();
  const position = new THREE.Vector3(49, WALK_EYE_HEIGHT, 0);
  for (let i = 0; i < 10; i++) collision.moveCamera(position, new THREE.Vector3(0.42, 0, 0));
  assert.ok(position.x < 49.66);
  const controller = control(0, 2, 0);
  controller.setCollisionWorld(collision); controller.setMode('walk');
  collision.removeTile('near');
  controller.update(1 / 60);
  assert.equal(controller.mode, 'browse');
});

test('entering walk from above descends smoothly before street movement', () => {
  const controller = control(0, 100, 0); controller.setCollisionWorld(world());
  const rotation = controller.camera.quaternion.clone();
  assert.equal(controller.setMode('walk'), true);
  assert.equal(controller.flying, true); assert.equal(controller.camera.position.y, 100);
  assert.ok(rotation.angleTo(controller.camera.quaternion) < 1e-7);
  advance(controller, 0.8);
  assert.ok(controller.camera.position.y > 40 && controller.camera.position.y < 60);
  advance(controller, 0.9);
  assert.equal(controller.flying, false); assert.equal(controller.mode, 'walk');
  assert.ok(Math.abs(controller.camera.position.y - WALK_EYE_HEIGHT) < 1e-8);
});

test('input and mode changes cancel street descent while preserving altitude and heading', () => {
  const controller = control(0, 100, 0); controller.setCollisionWorld(world()); controller.setMode('walk');
  advance(controller, 0.8);
  const position = controller.camera.position.clone(), rotation = controller.camera.quaternion.clone();
  controller.setKey('KeyW', true);
  assert.equal(controller.mode, 'fly'); assert.equal(controller.flying, false);
  assert.ok(controller.camera.position.distanceTo(position) < 1e-9);
  controller.update(1 / 60);
  assert.ok(Math.abs(controller.camera.position.y - position.y) < 1e-9);
  assert.ok(rotation.angleTo(controller.camera.quaternion) < 1e-7);
  const low = control(0, 100, 0); low.setCollisionWorld(world()); low.setMode('walk'); advance(low, 1.55);
  const altitude = low.camera.position.y; assert.ok(altitude < 3);
  low.setMode('browse'); low.update(1 / 60);
  assert.ok(Math.abs(low.camera.position.y - altitude) < 1e-9);
});

test('an unloaded landing is cancelled before it can drop onto missing ground', () => {
  const collision = world(), controller = control(0, 100, 0);
  controller.setCollisionWorld(collision); controller.setMode('walk'); advance(controller, 0.5);
  const position = controller.camera.position.clone(); collision.removeTile('near'); controller.update(1 / 60);
  assert.equal(controller.mode, 'fly'); assert.equal(controller.flying, false);
  assert.ok(controller.camera.position.distanceTo(position) < 1e-9);
});

test('a landmark collider arriving during descent cancels the unsafe landing in place', () => {
  const controller = control(); const collision = world(); controller.setCollisionWorld(collision);
  assert.equal(controller.setMode('walk'), true); advance(controller, 0.8);
  const position = controller.camera.position.clone(), rotation = controller.camera.quaternion.clone();
  const model = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10)); model.position.y = 5;
  collision.addModel('late-landmark', model);
  assert.equal(collision.findSafePosition(new THREE.Vector3(0, 1.7, 0), 0), null);
  controller.update(1 / 60);
  assert.equal(controller.mode, 'fly'); assert.equal(controller.flying, false);
  assert.ok(controller.camera.position.distanceTo(position) < 1e-9);
  assert.ok(controller.camera.quaternion.angleTo(rotation) < 1e-7);
  advance(controller, 1); assert.ok(controller.camera.position.distanceTo(position) < 1e-9);
  controller.dispose(); collision.clear(); model.geometry.dispose(); (model.material as THREE.Material).dispose();
});

test('safe landing avoids buildings and water while preserving true courtyards', () => {
  const data = flatData();
  data.buildings.push({ id: 1, polygon: square(10), holes: [square(5)], minY: 0, maxY: 10 });
  data.water.push([[20, -10], [30, -10], [30, 10], [20, 10]]);
  const collision = world(data);
  const courtyard = collision.findSafePosition(new THREE.Vector3(0, 1000, 0), 0);
  assert.ok(courtyard);
  assert.equal(courtyard.x, 0);
  assert.equal(collision.findSafePosition(new THREE.Vector3(8, 1000, 0), 0), null);
  assert.equal(collision.findSafePosition(new THREE.Vector3(25, 1000, 0), 0), null);
  const dry = new THREE.Vector3(19, WALK_EYE_HEIGHT, 0);
  for (let i = 0; i < 10; i++) collision.moveCamera(dry, new THREE.Vector3(0.42, 0, 0));
  assert.ok(dry.x < 19.66);
});

test('islands remain dry inside water outer rings and invalid holes are rejected', () => {
  const data = flatData(); data.water.push(square(20)); data.waterHoles = [[square(5)]];
  const collision = world(data);
  assert.ok(collision.findSafePosition(new THREE.Vector3(0, 100, 0), 0));
  assert.equal(collision.findSafePosition(new THREE.Vector3(8, 100, 0), 0), null);
  const position = new THREE.Vector3(4, WALK_EYE_HEIGHT, 0);
  for (let i = 0; i < 10; i++) collision.moveCamera(position, new THREE.Vector3(0.42, 0, 0));
  assert.ok(position.x < 4.66);
  const invalid = flatData(); invalid.water.push(square(20)); invalid.waterHoles = [[[[0, 0], [2, 0], [NaN, 2]]]];
  assert.throws(() => collision.updateTile('bad', invalid), /Invalid collision footprint/);
});

test('capsule collision stops crossing walls and model interiors are not safe spawns', () => {
  const data = flatData();
  data.buildings.push({ id: 1, polygon: square(2), minY: 0, maxY: 10 });
  const collision = world(data);
  const position = new THREE.Vector3(-4, WALK_EYE_HEIGHT, 0);
  for (let i = 0; i < 20; i++) collision.moveCamera(position, new THREE.Vector3(0.42, 0, 0));
  assert.ok(position.x < -2.34);
  const model = new THREE.Mesh(new THREE.BoxGeometry(4, 10, 4));
  model.position.set(20, 5, 0);
  collision.addModel('landmark', model);
  assert.equal(collision.findSafePosition(new THREE.Vector3(20, 1000, 0), 0), null);
  collision.removeModel('landmark');
  assert.ok(collision.findSafePosition(new THREE.Vector3(20, 1000, 0), 0));
});

test('walking crosses a high arch while landing avoids its roof and low ceilings stay blocked', () => {
  const collision = world();
  const arch = new THREE.Group();
  const roof = new THREE.Mesh(new THREE.BoxGeometry(5.6, 1, 2));
  roof.position.y = 3.5; arch.add(roof);
  for (const x of [-2.4, 2.4]) {
    const column = new THREE.Mesh(new THREE.BoxGeometry(0.8, 3, 2));
    column.position.set(x, 1.5, 0); arch.add(column);
  }
  collision.addModel('arch', arch);
  assert.equal(collision.findSafePosition(new THREE.Vector3(0, 100, 0), 0), null, 'An overhead model is unsuitable for a fresh aerial landing');
  const position = new THREE.Vector3(0, WALK_EYE_HEIGHT, -4);
  for (let i = 0; i < 20; i++) collision.moveCamera(position, new THREE.Vector3(0, 0, 0.42));
  assert.ok(position.z > 4, 'A loaded open passage with three-meter clearance must permit walking through');
  assert.equal(position.y, WALK_EYE_HEIGHT);
  const intoColumn = new THREE.Vector3(3.5, WALK_EYE_HEIGHT, 0);
  for (let i = 0; i < 10; i++) collision.moveCamera(intoColumn, new THREE.Vector3(-0.42, 0, 0));
  assert.ok(intoColumn.x > 3.14, 'The arch support remains a solid Capsule obstacle');
  collision.removeModel('arch');
  roof.position.y = 2.4; collision.addModel('low-ceiling', roof);
  const low = new THREE.Vector3(0, WALK_EYE_HEIGHT, -4);
  for (let i = 0; i < 20; i++) collision.moveCamera(low, new THREE.Vector3(0, 0, 0.42));
  assert.ok(low.z < -1.34, 'A ceiling with only 1.9-meter clearance must block the walker');
});

test('ground interpolation is accurate and invalid elevation cannot unlock walking', () => {
  const data = flatData();
  data.ground.heights = [0, 10, 20, 30];
  const collision = world(data);
  assert.equal(collision.heightAt(0, 0), 15);
  assert.equal(collision.heightAt(60, 0), null);
  const invalid = flatData(); invalid.ground.heights[0] = NaN;
  assert.throws(() => collision.updateTile('bad', invalid), /Invalid collision elevation/);
});

test('label occlusion sees nearby walls, ignores the last three meters, and releases unloaded blockers', () => {
  const data = flatData();
  data.buildings.push({ id: 1, polygon: square(2), minY: 0, maxY: 10 });
  const collision = world(data);
  assert.equal(collision.isOccluded(new THREE.Vector3(-10, 1, 0), new THREE.Vector3(10, 1, 0)), true);
  assert.equal(collision.isOccluded(new THREE.Vector3(-10, 1, 0), new THREE.Vector3(-1, 1, 0)), false);
  assert.equal(collision.isOccluded(new THREE.Vector3(-10, 20, 0), new THREE.Vector3(10, 20, 0)), false);
  collision.removeTile('near');
  assert.equal(collision.isOccluded(new THREE.Vector3(-10, 1, 0), new THREE.Vector3(10, 1, 0)), false);
});

test('the densest real tile stays bounded and retains every exact face across the whole tile', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/data/manifest.json', import.meta.url), 'utf8'));
  const descriptor = manifest.tiles.find((entry: { id: string }) => entry.id === 'l0_x-4_z6');
  assert.ok(descriptor?.collision, 'The highest-edge-count measured tile must remain available for regression');
  const data = JSON.parse(gunzipSync(readFileSync(new URL(`../public/data/${descriptor.collision.file}`, import.meta.url))).toString()) as TileCollisionData;
  const collision = world(data);
  const tree = (collision as unknown as { tiles: Map<string, { octree: Octree }> }).tiles.get('near')!.octree;
  const triangles = new Set<THREE.Triangle>(); let nodes = 0, maxDepth = 0;
  const stack: [Octree, number][] = [[tree, 0]];
  while (stack.length) {
    const [node, depth] = stack.pop()!; nodes++; maxDepth = Math.max(depth, maxDepth);
    node.triangles.forEach((triangle) => triangles.add(triangle));
    stack.push(...node.subTrees.map((child): [Octree, number] => [child, depth + 1]));
  }
  assert.ok(nodes <= 4096, `Node budget exceeded: ${nodes}`); assert.ok(maxDepth <= 8, `Depth exceeded: ${maxDepth}`);
  let expected = 0;
  for (const building of data.buildings) {
    if (building.maxY <= building.minY) continue;
    const rings = [building.polygon, ...(building.holes ?? [])].map((ring) => {
      const points = ring.slice(), first = points[0], last = points.at(-1)!;
      if (first[0] === last[0] && first[1] === last[1]) points.pop();
      return points.map(([x, z]) => new THREE.Vector2(x, z));
    });
    expected += rings.reduce((sum, ring) => sum + ring.length * 4, 0) + 2 * THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1)).length;
  }
  assert.equal(triangles.size, expected, 'Budget limits must not discard exact walls or roof triangles');
  const all = [...triangles].sort((a, b) => a.getMidpoint(new THREE.Vector3()).x - b.getMidpoint(new THREE.Vector3()).x);
  const ray = new THREE.Ray(), point = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let sample = 0; sample < 32; sample++) {
    const triangle = all[Math.floor((all.length - 1) * sample / 31)]; triangle.getNormal(normal);
    if (normal.lengthSq() < 0.5) continue;
    triangle.getMidpoint(ray.origin); ray.origin.addScaledVector(normal, 3); ray.direction.copy(normal).negate();
    let nearest = Infinity;
    for (const face of all) if (ray.intersectTriangle(face.a, face.b, face.c, true, point)) nearest = Math.min(nearest, ray.origin.distanceTo(point));
    const hit = tree.rayIntersect(ray);
    assert.ok(hit, `A face was lost in quadrant sample ${sample}`);
    assert.ok(Math.abs(hit.distance - nearest) < 1e-5, `Broad phase changed the exact nearest face at sample ${sample}`);
    const candidates = tree.getRayTriangles(ray, []);
    assert.equal(new Set(candidates).size, candidates.length, 'Duplicated broad-phase references must not repeat narrow-phase work');
  }
  collision.clear(); assert.equal(collision.tileCount, 0);
});

test('coincident wide planes remain exact even when a tree stops splitting at its root', () => {
  const collision = world(), group = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(40, 40), material = new THREE.MeshBasicMaterial();
  for (let i = 0; i < 40; i++) {
    const plane = new THREE.Mesh(geometry, material); plane.position.z = i / 1000; group.add(plane);
  }
  collision.addModel('coplanar', group);
  assert.equal(collision.isOccluded(new THREE.Vector3(0, 1, 5), new THREE.Vector3(0, 1, -5)), true);
  assert.equal(collision.isOccluded(new THREE.Vector3(25, 1, 5), new THREE.Vector3(25, 1, -5)), false);
  const position = new THREE.Vector3(0, WALK_EYE_HEIGHT, 2);
  for (let i = 0; i < 12; i++) collision.moveCamera(position, new THREE.Vector3(0, 0, -0.4));
  assert.ok(position.z >= 0.35, 'The exact planar wall must still stop a walker after subdivision stops');
  collision.removeModel('coplanar');
  assert.equal(collision.isOccluded(new THREE.Vector3(0, 1, 5), new THREE.Vector3(0, 1, -5)), false);
  geometry.dispose(); material.dispose(); collision.clear();
});
