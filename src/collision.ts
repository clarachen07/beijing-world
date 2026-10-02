/** Nearby loaded tiles provide elevation, water exclusion and building proxies. */
import * as THREE from 'three';
import { Octree } from 'three/examples/jsm/math/Octree.js';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';

export type GroundRing = [number, number][];
export interface TileCollisionData {
  buildings: { id: string | number; polygon: GroundRing; holes?: GroundRing[]; minY: number; maxY: number }[];
  water: GroundRing[];
  /** Holes belong to the water outer ring at the same array index. */
  waterHoles?: GroundRing[][];
  ground: { width: number; height: number; origin: [number, number]; step: number; heights: number[] };
}
interface CollisionTile {
  data: TileCollisionData;
  bounds: THREE.Box2;
  octree: Octree;
}
interface ModelCollision { octree: Octree; bounds: THREE.Box3 }
export const WALK_EYE_HEIGHT = 1.7;
const RADIUS = 0.35;
const BODY_HEIGHT = 1.8;
const MIN_HEADROOM = 2;

type TriangleBounds = readonly [number, number, number, number, number, number];
interface TreeBudget { nodes: number; bounds: WeakMap<THREE.Triangle, TriangleBounds> }
class PaddedOctree extends Octree {
  private readonly budget: TreeBudget;
  constructor(box?: THREE.Box3, budget: TreeBudget = { nodes: 1, bounds: new WeakMap() }, private readonly allowance = 2048) {
    super(box); this.budget = budget; this.maxLevel = 8; this.trianglesPerLeaf = 32;
  }
  override calcBox() {
    super.calcBox();
    // Three pads only the minimum; roundoff can otherwise discard top faces.
    this.box?.max.addScalar(0.01);
    return this;
  }
  override split(level: number) {
    if (!this.box || level >= this.maxLevel || this.triangles.length <= this.trianglesPerLeaf || this.allowance < 9 || this.budget.nodes >= 4096) return this;
    const size = this.box.getSize(new THREE.Vector3());
    if (Math.max(size.x, size.y, size.z) <= 0.5) return this;
    const half = size.multiplyScalar(0.5), groups: { box: THREE.Box3; triangles: THREE.Triangle[] }[] = [];
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) {
      const min = this.box.min.clone().add(new THREE.Vector3(x, y, z).multiply(half));
      groups.push({ box: new THREE.Box3(min, min.clone().add(half)), triangles: [] });
    }
    const retained: THREE.Triangle[] = [];
    for (const triangle of this.triangles) {
      let bounds = this.budget.bounds.get(triangle);
      if (!bounds) {
        bounds = [Math.min(triangle.a.x, triangle.b.x, triangle.c.x), Math.max(triangle.a.x, triangle.b.x, triangle.c.x),
          Math.min(triangle.a.y, triangle.b.y, triangle.c.y), Math.max(triangle.a.y, triangle.b.y, triangle.c.y),
          Math.min(triangle.a.z, triangle.b.z, triangle.c.z), Math.max(triangle.a.z, triangle.b.z, triangle.c.z)];
        this.budget.bounds.set(triangle, bounds);
      }
      const [minX, maxX, minY, maxY, minZ, maxZ] = bounds;
      let assigned = false;
      for (const group of groups) {
        const box = group.box;
        if (maxX < box.min.x || minX > box.max.x || maxY < box.min.y || minY > box.max.y || maxZ < box.min.z || minZ > box.max.z) continue;
        // Conservative broad phase only: narrow-phase queries still test the original triangle.
        group.triangles.push(triangle); assigned = true;
      }
      if (!assigned) retained.push(triangle);
    }
    const children = groups.filter(group => group.triangles.length);
    const references = children.reduce((sum, group) => sum + group.triangles.length, 0);
    const largest = Math.max(...children.map(group => group.triangles.length));
    // Coplanar/long faces can duplicate through every level without refining a query.
    if (children.length < 2 || children.length >= this.allowance || this.budget.nodes + children.length > 4096 || (largest >= this.triangles.length * 0.55 && references >= this.triangles.length * 1.75)) return this;
    // Reserve weighted budgets for every sibling before DFS; later quadrants stay refined.
    const extra = this.allowance - 1 - children.length;
    const allowances = children.map(group => 1 + Math.floor(extra * group.triangles.length / references));
    const remainder = this.allowance - 1 - allowances.reduce((sum, value) => sum + value, 0);
    for (let i = 0; i < remainder; i++) allowances[i % allowances.length]++;
    this.triangles = retained;
    this.budget.nodes += children.length;
    for (const [index, group] of children.entries()) {
      const child = new PaddedOctree(group.box, this.budget, allowances[index]); child.triangles = group.triangles;
      this.subTrees.push(child); child.split(level + 1);
    }
    return this;
  }
  private collect(intersects: (box: THREE.Box3) => boolean, triangles: THREE.Triangle[]) {
    const seen = new Set(triangles), stack: Octree[] = [this];
    while (stack.length) {
      const node = stack.pop()!;
      if (!node.box || !intersects(node.box)) continue;
      for (const triangle of node.triangles) if (!seen.has(triangle)) { seen.add(triangle); triangles.push(triangle); }
      stack.push(...node.subTrees);
    }
    return triangles;
  }
  override getRayTriangles(ray: THREE.Ray, triangles: THREE.Triangle[]) { return this.collect(box => ray.intersectsBox(box), triangles); }
  override getCapsuleTriangles(capsule: Capsule, triangles: THREE.Triangle[]) { return this.collect(box => capsule.intersectsBox(box), triangles); }
  override getSphereTriangles(sphere: THREE.Sphere, triangles: THREE.Triangle[]) { return this.collect(box => sphere.intersectsBox(box), triangles); }
}

function inRing(x: number, z: number, ring: GroundRing): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function capsuleAt(position: THREE.Vector3, height: number, capsule: Capsule): Capsule {
  capsule.start.set(position.x, height + RADIUS, position.z);
  capsule.end.set(position.x, height + BODY_HEIGHT - RADIUS, position.z);
  capsule.radius = RADIUS;
  return capsule;
}
function buildOctree(data: TileCollisionData): Octree {
  const vertices: number[] = [];
  const triangle = (a: [number, number], b: [number, number], c: [number, number], y: number) => vertices.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]);
  for (const building of data.buildings) {
    if (building.polygon.length < 3 || building.maxY <= building.minY) continue;
    const rings = [building.polygon, ...(building.holes ?? [])].map((ring) => {
      const result = ring.slice();
      if (result.length > 1 && result[0][0] === result[result.length - 1][0] && result[0][1] === result[result.length - 1][1]) result.pop();
      return result;
    });
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      vertices.push(a[0], building.minY, a[1], b[0], building.minY, b[1], b[0], building.maxY, b[1]);
      vertices.push(a[0], building.minY, a[1], b[0], building.maxY, b[1], a[0], building.maxY, a[1]);
      // Directional Octree triangles need both sides to stop a walker.
      vertices.push(b[0], building.maxY, b[1], b[0], building.minY, b[1], a[0], building.minY, a[1]);
      vertices.push(a[0], building.maxY, a[1], b[0], building.maxY, b[1], a[0], building.minY, a[1]);
    }
    const contour = rings[0].map(([x, z]) => new THREE.Vector2(x, z));
    const holes = rings.slice(1).map((ring) => ring.map(([x, z]) => new THREE.Vector2(x, z)));
    const points = rings.flat();
    for (const indices of THREE.ShapeUtils.triangulateShape(contour, holes)) {
      triangle(points[indices[0]], points[indices[1]], points[indices[2]], building.maxY);
      triangle(points[indices[2]], points[indices[1]], points[indices[0]], building.maxY);
    }
  }
  const octree = new PaddedOctree();
  if (vertices.length) {
    // The footprint is already in global coordinates; avoid an intermediate GPU geometry.
    const vertex = (offset: number) => new THREE.Vector3(Math.fround(vertices[offset]), Math.fround(vertices[offset + 1]), Math.fround(vertices[offset + 2]));
    for (let offset = 0; offset < vertices.length; offset += 9) octree.addTriangle(new THREE.Triangle(vertex(offset), vertex(offset + 3), vertex(offset + 6)));
    octree.build();
  }
  return octree;
}

export class CollisionWorld {
  private readonly tiles = new Map<string, CollisionTile>();
  private readonly models = new Map<string, ModelCollision>();
  private readonly query = new THREE.Vector2();
  private readonly candidate = new THREE.Vector3();
  private readonly capsule = new Capsule();
  private readonly step = new THREE.Vector3();
  private readonly ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));

  /** Register a nearby, globally positioned proxy or landmark without owning it. */
  addModel(id: string, model: THREE.Object3D) {
    model.updateWorldMatrix(true, true);
    const octree = new PaddedOctree().fromGraphNode(model);
    this.removeModel(id);
    this.models.set(id, { octree, bounds: new THREE.Box3().setFromObject(model) });
  }
  removeModel(id: string) { this.models.get(id)?.octree.clear(); this.models.delete(id); }

  /** Only close, fully loaded tiles should be registered by the tile manager. */
  updateTile(id: string, data: TileCollisionData) {
    const ground = data.ground;
    if (!Number.isInteger(ground.width) || !Number.isInteger(ground.height) || ground.width < 2 || ground.height < 2 || !Number.isFinite(ground.step) || ground.step <= 0 || ground.origin.length !== 2 || !ground.origin.every(Number.isFinite) || ground.heights.length !== ground.width * ground.height || ground.heights.some((value) => !Number.isFinite(value))) {
      throw new Error(`Invalid collision elevation grid for tile ${id}`);
    }
    const validRing = (ring: GroundRing) => ring.length >= 3 && ring.every((point) => point.length === 2 && point.every(Number.isFinite));
    if (!data.water.every(validRing) || (data.waterHoles && (data.waterHoles.length !== data.water.length || !data.waterHoles.every((holes) => holes.every(validRing)))) || !data.buildings.every((building) => Number.isFinite(building.minY) && Number.isFinite(building.maxY) && validRing(building.polygon) && (building.holes ?? []).every(validRing))) {
      throw new Error(`Invalid collision footprint for tile ${id}`);
    }
    if (this.tiles.get(id)?.data === data) return;
    const bounds = new THREE.Box2(new THREE.Vector2(...ground.origin), new THREE.Vector2(ground.origin[0] + (ground.width - 1) * ground.step, ground.origin[1] + (ground.height - 1) * ground.step));
    const octree = buildOctree(data);
    this.tiles.get(id)?.octree.clear();
    this.tiles.set(id, { data, bounds, octree });
  }
  removeTile(id: string) { this.tiles.get(id)?.octree.clear(); this.tiles.delete(id); }
  get tileCount() { return this.tiles.size; }
  clear() {
    for (const id of this.tiles.keys()) this.removeTile(id);
    for (const id of this.models.keys()) this.removeModel(id);
  }
  private tileAt(x: number, z: number): CollisionTile | undefined {
    this.query.set(x, z);
    for (const tile of this.tiles.values()) if (tile.bounds.containsPoint(this.query)) return tile;
    return undefined;
  }
  isReady(x: number, z: number): boolean { return this.tileAt(x, z) !== undefined; }
  /** Near-end intersections belong to the labeled building and are ignored. */
  isOccluded(start: THREE.Vector3, end: THREE.Vector3): boolean {
    const distance = start.distanceTo(end);
    if (distance <= 3) return false;
    this.ray.origin.copy(start);
    this.ray.direction.subVectors(end, start).divideScalar(distance);
    for (const tile of this.tiles.values()) {
      const hit = tile.octree.rayIntersect(this.ray);
      if (hit && hit.distance < distance - 3 && hit.distance > 0.01) return true;
    }
    for (const model of this.models.values()) {
      if (!this.ray.intersectsBox(model.bounds)) continue;
      const hit = model.octree.rayIntersect(this.ray);
      if (hit && hit.distance < distance - 3 && hit.distance > 0.01) return true;
    }
    return false;
  }
  heightAt(x: number, z: number): number | null {
    const tile = this.tileAt(x, z);
    if (!tile) return null;
    const g = tile.data.ground;
    const gx = (x - g.origin[0]) / g.step, gz = (z - g.origin[1]) / g.step;
    const ix = Math.min(g.width - 2, Math.max(0, Math.floor(gx))), iz = Math.min(g.height - 2, Math.max(0, Math.floor(gz)));
    const tx = gx - ix, tz = gz - iz;
    const a = g.heights[iz * g.width + ix], b = g.heights[iz * g.width + ix + 1];
    const c = g.heights[(iz + 1) * g.width + ix], d = g.heights[(iz + 1) * g.width + ix + 1];
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), tz);
  }
  private blocked(x: number, z: number, groundY: number, forSpawn = true): boolean {
    const tile = this.tileAt(x, z);
    if (!tile) return true;
    for (const [index, ring] of tile.data.water.entries()) if (inRing(x, z, ring) && !(tile.data.waterHoles?.[index] ?? []).some(hole => inRing(x, z, hole))) return true;
    for (const building of tile.data.buildings) {
      if (building.minY >= groundY + BODY_HEIGHT || building.maxY <= groundY + 0.05) continue;
      if (inRing(x, z, building.polygon) && !(building.holes ?? []).some((hole) => inRing(x, z, hole))) return true;
    }
    for (const { octree, bounds } of this.models.values()) {
      if (x < bounds.min.x || x > bounds.max.x || z < bounds.min.z || z > bounds.max.z || bounds.max.y <= groundY + 0.05) continue;
      this.ray.origin.set(x, forSpawn ? bounds.max.y + 1 : groundY + 0.05, z);
      this.ray.direction.set(0, forSpawn ? -1 : 1, 0);
      const hit = octree.rayIntersect(this.ray);
      // Landing stays outside covered models; walking can enter a tall open arch.
      if (hit && (forSpawn ? hit.position.y > groundY + 0.15 : hit.position.y < groundY + MIN_HEADROOM)) return true;
    }
    return false;
  }
  private safePoint(position: THREE.Vector3, forSpawn = true): boolean {
    const height = this.heightAt(position.x, position.z);
    if (height == null || this.blocked(position.x, position.z, height, forSpawn)) return false;
    for (const [dx, dz] of [[RADIUS, 0], [-RADIUS, 0], [0, RADIUS], [0, -RADIUS]]) if (this.blocked(position.x + dx, position.z + dz, height, forSpawn)) return false;
    capsuleAt(position, height, this.capsule);
    for (const tile of this.tiles.values()) {
      const result = tile.octree.capsuleIntersect(this.capsule);
      if (result && result.depth > 0.001) return false;
    }
    for (const model of this.models.values()) {
      const result = model.octree.capsuleIntersect(this.capsule);
      if (result && result.depth > 0.001) return false;
    }
    return true;
  }
  /** Camera eye position; never falls back to an unloaded flat plane. */
  findSafePosition(desired: THREE.Vector3, searchRadius = 45): THREE.Vector3 | null {
    this.candidate.copy(desired);
    if (this.safePoint(this.candidate)) {
      this.candidate.y = this.heightAt(desired.x, desired.z)! + WALK_EYE_HEIGHT;
      return this.candidate.clone();
    }
    for (let radius = 2; radius <= searchRadius; radius += 2) {
      const count = Math.max(8, Math.ceil(radius * Math.PI));
      for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2;
        this.candidate.set(desired.x + Math.cos(angle) * radius, desired.y, desired.z + Math.sin(angle) * radius);
        if (!this.safePoint(this.candidate)) continue;
        this.candidate.y = this.heightAt(this.candidate.x, this.candidate.z)! + WALK_EYE_HEIGHT;
        return this.candidate.clone();
      }
    }
    return null;
  }
  /** Substeps stop tunneling and slide against walls while retaining safe elevation. */
  moveCamera(position: THREE.Vector3, displacement: THREE.Vector3, out = position): THREE.Vector3 {
    out.copy(position);
    const count = Math.max(1, Math.ceil(Math.hypot(displacement.x, displacement.z) / 0.18));
    if (count > 32) return out;
    this.step.copy(displacement).setY(0).divideScalar(count);
    for (let i = 0; i < count; i++) {
      this.candidate.copy(out).add(this.step);
      const oldHeight = this.heightAt(out.x, out.z), height = this.heightAt(this.candidate.x, this.candidate.z);
      if (oldHeight == null || height == null || Math.abs(height - oldHeight) > Math.max(0.12, this.step.length() * 0.7)) break;
      if (this.blocked(this.candidate.x, this.candidate.z, height, false)) break;
      capsuleAt(this.candidate, height, this.capsule);
      for (let iteration = 0; iteration < 3; iteration++) {
        let resolved = false;
        for (const tile of this.tiles.values()) {
          const result = tile.octree.capsuleIntersect(this.capsule);
          if (!result || result.depth < 0.0001) continue;
          this.capsule.translate(result.normal.multiplyScalar(result.depth + 0.001));
          resolved = true;
        }
        for (const model of this.models.values()) {
          const result = model.octree.capsuleIntersect(this.capsule);
          if (!result || result.depth < 0.0001) continue;
          this.capsule.translate(result.normal.multiplyScalar(result.depth + 0.001));
          resolved = true;
        }
        if (!resolved) break;
      }
      this.candidate.x = this.capsule.start.x;
      this.candidate.z = this.capsule.start.z;
      if (!this.safePoint(this.candidate, false)) break;
      this.candidate.y = this.heightAt(this.candidate.x, this.candidate.z)! + WALK_EYE_HEIGHT;
      out.copy(this.candidate);
    }
    return out;
  }
}
