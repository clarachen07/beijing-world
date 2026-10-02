/** Decode final GLBs and test the five local form repairs; no photo or survey acceptance. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const snapshotPath = 'tests/fixtures/model-form-before.json';
const registry = JSON.parse(await readFile('config/landmarks.json', 'utf8'));
const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
const models = ['confucius-guozijian', 'yuetan', 'zhengyangmen', 'linglong', 'olympic-tower'];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
await MeshoptDecoder.ready;
const errors = [], assets = [], registration = [], preservation = [], preservedPaths = new Set();
const sha = data => createHash('sha256').update(data).digest('hex');
const round = n => Math.round(n * 1e5) / 1e5;
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const pointKey = p => p.map(v => Math.round(v * 1000)).join(',');
const materialIs = (part, name) => part.material === name || part.material.startsWith(name + '.');
function bounds(points) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
  return points.length ? { min, max, size: max.map((v, i) => v - min[i]) } : null;
}
function printableBounds(b) {
  return b && Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.map(round)]));
}
function firstHit(parts, origin, direction, maxDistance) {
  let closest = Infinity, material = null;
  for (const part of parts) for (const [a, b, c] of part.triangles) {
    const e1 = sub(b, a), e2 = sub(c, a), p = cross(direction, e2), det = dot(e1, p);
    if (Math.abs(det) < 1e-9) continue;
    const v = sub(origin, a), u = dot(v, p) / det;
    if (u < -1e-5 || u > 1.00001) continue;
    const q = cross(v, e1), w = dot(direction, q) / det;
    if (w < -1e-5 || u + w > 1.00001) continue;
    const distance = dot(e2, q) / det;
    if (distance > .003 && distance < maxDistance && distance < closest) { closest = distance; material = part.material; }
  }
  return Number.isFinite(closest) ? { distanceM: round(closest), material } : null;
}
function components(triangles) {
  const ids = new Map(), parent = [], points = [];
  const id = p => { const key = pointKey(p); if (!ids.has(key)) { ids.set(key, points.length); parent.push(points.length); points.push(p); } return ids.get(key); };
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const indexed = triangles.map(t => { const ids = t.map(id); parent[find(ids[1])] = find(ids[0]); parent[find(ids[2])] = find(ids[0]); return ids; });
  const groups = new Map();
  for (let i = 0; i < points.length; i++) { const root = find(i); if (!groups.has(root)) groups.set(root, { points: [], triangleCount: 0 }); groups.get(root).points.push(points[i]); }
  for (const t of indexed) groups.get(find(t[0])).triangleCount++;
  return [...groups.values()].map(g => ({ ...g, bounds: bounds(g.points) }));
}
function localTriangles(parts, building) {
  const x = building.x, z = -building.y, rx = building.w / 2 + 4, rz = building.d / 2 + 4;
  return parts.flatMap(p => p.triangles).filter(t => t.every(p => Math.abs(p[0] - x) < rx && Math.abs(p[2] - z) < rz));
}
function roofLayers(parts, building, material) {
  const area = building.w * building.d;
  return components(localTriangles(parts.filter(p => materialIs(p, material)), building))
    .filter(g => g.bounds.size[0] * g.bounds.size[2] >= area * .35 && g.triangleCount >= 12)
    .sort((a, b) => a.bounds.min[1] - b.bounds.min[1])
    .map(g => ({ triangleCount: g.triangleCount, boundsGLTFMetres: printableBounds(g.bounds), planAreaM2: round(g.bounds.size[0] * g.bounds.size[2]) }));
}
function sectionAtHeight(triangles, height) {
  const points = [], seen = new Set();
  const add = p => { const key = pointKey(p); if (!seen.has(key)) { seen.add(key); points.push(p); } };
  for (const triangle of triangles) for (let i = 0; i < 3; i++) {
    const a = triangle[i], b = triangle[(i + 1) % 3], dy = b[1] - a[1];
    if (Math.abs(a[1] - height) < 1e-6) add(a);
    if (Math.abs(dy) < 1e-9) continue;
    const t = (height - a[1]) / dy;
    if (t >= 0 && t <= 1) add(a.map((v, k) => v + t * (b[k] - v)));
  }
  return points;
}
function diagonalEdges(triangles, minimumVerticalM, minimumPlanM) {
  const edges = new Map();
  for (const triangle of triangles) {
    const normal = cross(sub(triangle[1], triangle[0]), sub(triangle[2], triangle[0]));
    const length = Math.hypot(...normal);
    if (length < 1e-9) continue;
    const unit = normal.map(v => v / length);
    for (let i = 0; i < 3; i++) {
      const a = triangle[i], b = triangle[(i + 1) % 3];
      const verticalM = Math.abs(a[1] - b[1]), planM = Math.hypot(a[0] - b[0], a[2] - b[2]);
      if (verticalM < minimumVerticalM || planM < minimumPlanM) continue;
      const key = [pointKey(a), pointKey(b)].sort().join('|');
      if (!edges.has(key)) edges.set(key, { verticalM, planM, normals: [] });
      edges.get(key).normals.push(unit);
    }
  }
  // Face triangulation diagonals are coplanar, unlike the longitudinal creases of box/cylinder rods.
  const creases = [...edges.values()].filter(e => e.normals.some((a, i) => e.normals.slice(i + 1).some(b => Math.abs(dot(a, b)) < .95)));
  return { count: creases.length, coplanarOrBoundaryEdgesExcluded: edges.size - creases.length, maxVerticalM: round(Math.max(0, ...creases.map(e => e.verticalM))), maxPlanM: round(Math.max(0, ...creases.map(e => e.planM))) };
}
function check(row, name, passed, evidence) {
  row.checks.push({ name, passed, ...evidence });
  if (!passed) errors.push(`${row.model}/${row.level}: ${name}`);
}
function probe(row, parts, name, origin, direction, distance, expectedClear, expectedMaterial = null) {
  const hit = firstHit(parts, origin, direction, distance);
  const passed = expectedClear ? hit === null : hit !== null && (!expectedMaterial || hit.material === expectedMaterial || hit.material.startsWith(expectedMaterial + '.'));
  check(row, name, passed, { originGLTFMetres: origin.map(round), direction, maxDistanceM: distance, expectedClear, expectedMaterial, firstHit: hit });
}
async function decode(def, level) {
  const path = 'public/' + (level === 'collision' ? def.collision : def.lod[level]).replace(/^\.\//, '');
  const bytes = await readFile(path), doc = await io.readBinary(new Uint8Array(bytes)), parts = [];
  for (const node of doc.getRoot().listNodes()) for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
    if (primitive.getMode() !== 4) throw Error(`${path}: non-triangle primitive`);
    const matrix = node.getWorldMatrix(), positions = primitive.getAttribute('POSITION');
    if (!positions) throw Error(`${path}: primitive has no positions`);
    const points = [];
    for (let i = 0; i < positions.getCount(); i++) {
      const p = positions.getElement(i, []);
      points.push([0, 1, 2].map(k => matrix[k]*p[0] + matrix[4+k]*p[1] + matrix[8+k]*p[2] + matrix[12+k]));
    }
    const indices = primitive.getIndices()?.getArray() ?? points.map((_, i) => i), triangles = [];
    if (indices.length % 3) throw Error(`${path}: incomplete triangle indices`);
    for (let i = 0; i < indices.length; i += 3) triangles.push([points[indices[i]], points[indices[i+1]], points[indices[i+2]]]);
    parts.push({ material: primitive.getMaterial()?.getName() ?? '', points, triangles });
  }
  return { parts, path, sha256: sha(bytes), bounds: bounds(parts.flatMap(p => p.points)) };
}

// Compare the complete registration except generated GLB paths, including layout and all height fields.
const withoutPaths = def => {
  const value = structuredClone(def); delete value.collision;
  if (value.lod) for (const level of ['near', 'medium', 'far']) delete value.lod[level];
  return value;
};
for (const before of snapshot.registry.landmarks) {
  const after = registry.landmarks.find(d => d.id === before.id);
  const passed = Boolean(after && isDeepStrictEqual(withoutPaths(before), withoutPaths(after)));
  registration.push({ id: before.id, model: before.model, passed, unchangedFields: 'all registration fields except generated lod/collision paths' });
  if (!passed) errors.push(`${before.model}: registration differs from pre-form snapshot`);
  if (models.includes(before.model) || !after) continue;
  for (const level of ['near', 'medium', 'far', 'collision']) {
    const relativePath = level === 'collision' ? before.collision : before.lod[level];
    const currentPath = level === 'collision' ? after.collision : after.lod[level];
    if (relativePath !== currentPath) errors.push(`${before.model}/${level}: unrelated asset path changed`);
    if (preservedPaths.has(currentPath)) continue;
    preservedPaths.add(currentPath);
    const expectedSHA256 = snapshot.glbs[basename(relativePath)];
    const actualSHA256 = sha(await readFile('public/' + currentPath.replace(/^\.\//, '')));
    const unchanged = relativePath === currentPath && Boolean(expectedSHA256) && actualSHA256 === expectedSHA256;
    preservation.push({ model: before.model, level, path: currentPath, sha256: actualSHA256, passed: unchanged });
    if (!unchanged) errors.push(`${before.model}/${level}: unrelated asset changed`);
  }
}
if (registry.landmarks.length !== snapshot.registry.landmarks.length) errors.push('landmark count differs from pre-form snapshot');
for (const field of ['version', 'origin', 'coordinates', 'modelCoordinates'])
  if (!isDeepStrictEqual(registry[field], snapshot.registry[field])) errors.push(`registry ${field} differs from pre-form snapshot`);

for (const model of models) for (const level of model === 'yuetan' ? ['near', 'medium', 'collision'] : ['near', 'medium']) {
  const def = registry.landmarks.find(d => d.model === model);
  if (!def) throw Error(`Missing registry model ${model}`);
  const decoded = await decode(def, level), { parts } = decoded;
  const row = { model, level, path: decoded.path, sha256: decoded.sha256, boundsGLTFMetres: printableBounds(decoded.bounds), checks: [], materialEvidence: parts.map(p => ({ material: p.material, triangleCount: p.triangles.length, boundsGLTFMetres: printableBounds(bounds(p.points)) })) };
  check(row, 'registered model height retained', Math.abs(decoded.bounds.min[1]) < .08 && Math.abs(decoded.bounds.max[1] - def.heightM) < .08, { expectedHeightM: def.heightM, actualMinMaxYMetres: [decoded.bounds.min[1], decoded.bounds.max[1]].map(round) });
  if (model === 'confucius-guozijian') {
    const building = def.layout.find(b => b.name === '辟雍');
    if (!building) throw Error('No registered Biyong layout');
    row.building = { name: building.name, centreGLTFXZMetres: [building.x, -building.y].map(round), footprintWDMetres: [building.w, building.d].map(round) };
    row.roofLayers = roofLayers(parts, building, 'glazed_gold');
    check(row, 'Biyong two separate full-size gold roof layers', row.roofLayers.length === 2 && row.roofLayers[1].boundsGLTFMetres.min[1] - row.roofLayers[0].boundsGLTFMetres.max[1] > 1, { expectedLayers: 2, minimumPlanAreaM2: round(building.w * building.d * .35), actualLayers: row.roofLayers.length });
  }
  if (model === 'yuetan') {
    const building = def.layout.find(b => b.name === '钟楼');
    if (!building) throw Error('No registered Yuetan bell tower layout');
    const x = building.x, z = -building.y, distance = building.d + 10, start = z + distance / 2;
    row.building = { name: building.name, centreGLTFXZMetres: [x, z].map(round), roofAndRidgeHeightM: def.heightM };
    if (level !== 'collision') {
      row.roofLayers = roofLayers(parts, building, 'glazed_green');
      check(row, 'bell tower two separate full-size green roof layers', row.roofLayers.length === 2 && row.roofLayers[1].boundsGLTFMetres.min[1] - row.roofLayers[0].boundsGLTFMetres.max[1] > 1, { expectedLayers: 2, actualLayers: row.roofLayers.length });
      const red = parts.filter(p => materialIs(p, 'wall_red'));
      const redBounds = bounds(localTriangles(red, building).flat());
      check(row, 'bell tower red masonry base', Boolean(redBounds && redBounds.min[1] < .08 && redBounds.max[1] > 3.5 && redBounds.size[0] > building.w * .75 && redBounds.size[2] > building.d * .75), { redBoundsGLTFMetres: printableBounds(redBounds) });
    }
    for (const offset of [-.9, 0, .9]) {
      probe(row, parts, `central arch clear south to north x=${offset}`, [x + offset, 1.5, start], [0, 0, -1], distance, true);
      probe(row, parts, `central arch clear north to south x=${offset}`, [x + offset, 1.5, z - distance / 2], [0, 0, 1], distance, true);
    }
    for (const offset of [-2.5, 2.5]) probe(row, parts, `solid side wall x=${offset}`, [x + offset, 1.5, start], [0, 0, -1], distance, false);
    probe(row, parts, 'masonry above arch blocks passage', [x, 3.6, start], [0, 0, -1], distance, false);
  }
  if (model === 'zhengyangmen') {
    const grey = parts.filter(p => materialIs(p, 'grey_brick'));
    const lower = grey.flatMap(p => p.triangles).filter(t => t.every(v => v[1] >= -.08 && v[1] <= 14.85));
    const podium = bounds(lower.flat());
    check(row, 'large grey brick podium retained', Boolean(podium && podium.min[1] < .08 && podium.max[1] > 14.6 && podium.size[0] > 90 && podium.size[2] > 30), { podiumBoundsGLTFMetres: printableBounds(podium), triangleCount: lower.length });
    // Red gable panels above the podium remain legitimate; test the actual lower masonry region.
    const lowerRed = parts.filter(p => materialIs(p, 'wall_red')).flatMap(p => p.triangles).filter(t => t.some(v => v[1] <= 14.85));
    check(row, 'red masonry podium removed', lowerRed.length === 0, { inspectedHeightMaxM: 14.85, lowerRedTriangleCount: lowerRed.length, lowerRedBoundsGLTFMetres: printableBounds(bounds(lowerRed.flat())) });
    for (const x of [-35, -20, 20, 35]) for (const y of [2, 10]) probe(row, parts, `grey podium wall x=${x} y=${y}`, [x, y, 30], [0, 0, -1], 60, false, 'grey_brick');
  }
  if (model === 'linglong') {
    const steel = parts.filter(p => materialIs(p, 'painted_white_steel')), triangles = steel.flatMap(p => p.triangles);
    const steelBounds = bounds(triangles.flat());
    check(row, 'exterior white frame spans building', Boolean(steelBounds && steelBounds.min[1] < .5 && steelBounds.max[1] > 122 && steelBounds.size[0] > 27 && steelBounds.size[2] > 27), { steelBoundsGLTFMetres: printableBounds(steelBounds) });
    row.frameSections = [12, 40, 75, 112].map(height => {
      const section = sectionAtHeight(triangles, height).filter(p => Math.hypot(p[0], p[2]) > 8), b = bounds(section);
      const quadrants = new Set(section.map(p => (p[0] >= 0 ? 1 : 0) + (p[2] >= 0 ? 2 : 0)));
      const corners = [-1, 1].flatMap(sx => [-1, 1].map(sz => ({ x: sx * 14, z: sz * 14 }))).map(c => ({ centreXZMetres: [c.x, c.z], closestSteelDistanceM: round(Math.min(Infinity, ...section.map(p => Math.hypot(p[0] - c.x, p[2] - c.z)))) }));
      const passed = Boolean(b && b.size[0] > 25 && b.size[2] > 25 && corners.every(c => c.closestSteelDistanceM < .8));
      check(row, `four corner steel columns at ${height}m`, passed, { heightM: height, intersectionPoints: section.length, occupiedQuadrants: quadrants.size, corners, boundsGLTFMetres: printableBounds(b) });
      return { heightM: height, intersectionPoints: section.length, occupiedQuadrants: quadrants.size, corners, boundsGLTFMetres: printableBounds(b) };
    });
    row.diagonalSteelEdges = diagonalEdges(triangles, 5, 5);
    check(row, 'actual perimeter diagonal brace edges', row.diagonalSteelEdges.count >= 12, row.diagonalSteelEdges);
    const pods = components(parts.filter(p => materialIs(p, 'glass_curtainwall')).flatMap(p => p.triangles)).filter(g => g.bounds.size[0] * g.bounds.size[2] > 120 && g.bounds.size[1] > 5);
    check(row, 'six glass pods retained', pods.length === 6, { expectedPods: 6, actualPods: pods.length, podBoundsGLTFMetres: pods.map(g => printableBounds(g.bounds)) });
  }
  if (model === 'olympic-tower') {
    const steel = parts.filter(p => materialIs(p, 'painted_white_steel')), triangles = steel.flatMap(p => p.triangles);
    const crowns = components(parts.filter(p => materialIs(p, 'glass_curtainwall')).flatMap(p => p.triangles)).filter(g => g.bounds.size[0] > 15 && g.bounds.size[2] > 15 && g.bounds.size[1] > 5).sort((a, b) => b.bounds.min[1] - a.bounds.min[1]);
    check(row, 'five glass observation crowns retained', crowns.length === 5, { expectedCrowns: 5, actualCrowns: crowns.length, crownBoundsGLTFMetres: crowns.map(g => printableBounds(g.bounds)) });
    row.branchSections = [];
    for (const [i, crown] of crowns.entries()) {
      const centre = [ (crown.bounds.min[0] + crown.bounds.max[0]) / 2, (crown.bounds.min[2] + crown.bounds.max[2]) / 2 ];
      const height = crown.bounds.min[1] - .8;
      const section = sectionAtHeight(triangles, height).filter(p => Math.hypot(p[0] - centre[0], p[2] - centre[1]) < 12);
      const outer = section.filter(p => Math.hypot(p[0] - centre[0], p[2] - centre[1]) > 7), b = bounds(outer);
      const sectors = new Set(outer.map(p => Math.floor(((Math.atan2(p[2] - centre[1], p[0] - centre[0]) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4))));
      const branchRegion = triangles.filter(t => t.every(p => p[1] >= crown.bounds.min[1] - 16.5 && p[1] <= crown.bounds.min[1] + .5) && t.every(p => Math.hypot(p[0] - centre[0], p[2] - centre[1]) < 12));
      const diagonals = diagonalEdges(branchRegion, 2, 1);
      const evidence = { centreGLTFXZMetres: centre.map(round), sectionHeightM: round(height), outerIntersectionPoints: outer.length, occupiedAngularSectors: sectors.size, outerBoundsGLTFMetres: printableBounds(b), diagonalEdges: diagonals };
      row.branchSections.push(evidence);
      check(row, `crown ${i + 1} branching white steel below glass`, Boolean(b && b.size[0] > 17 && b.size[2] > 17 && sectors.size >= 6 && diagonals.count >= 12), evidence);
    }
    for (const height of [48, 100, 151]) for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5, b = (i + 1) * Math.PI * 2 / 5;
      const start = [13 * Math.cos(a), -13 * Math.sin(a)], end = [13 * Math.cos(b), -13 * Math.sin(b)];
      const length = Math.hypot(end[0] - start[0], end[1] - start[1]), direction = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
      const shaftParts = parts.filter(p => materialIs(p, 'white_stucco'));
      const startBoundary = firstHit(shaftParts, [start[0], height, start[1]], [direction[0], 0, direction[1]], length);
      const endBoundary = firstHit(shaftParts, [end[0], height, end[1]], [-direction[0], 0, -direction[1]], length);
      const clearStart = startBoundary?.distanceM ?? Infinity, clearEnd = length - (endBoundary?.distanceM ?? Infinity);
      const candidates = components(triangles.filter(t => t.every(p => Math.abs(p[1] - height) < 1.1)));
      const beams = candidates.filter(g => {
        const along = g.points.map(p => (p[0] - start[0]) * direction[0] + (p[2] - start[1]) * direction[1]);
        const lateral = g.points.map(p => Math.abs((p[0] - start[0]) * direction[1] - (p[2] - start[1]) * direction[0]));
        return startBoundary && endBoundary && clearEnd > clearStart && Math.min(...along) < clearStart + .1 && Math.max(...along) > clearEnd - .1 && Math.max(...lateral) < 1.2 && g.bounds.size[1] > .1 && g.triangleCount >= 4;
      });
      const samples = Array.from({ length: 9 }, (_, n) => {
        const fraction = n / 8, along = clearStart + fraction * (clearEnd - clearStart), x = start[0] + along * direction[0], z = start[1] + along * direction[1];
        return { fraction, originGLTFMetres: [x, height + 2, z].map(round), firstHit: firstHit(steel, [x, height + 2, z], [0, -1, 0], 4) };
      });
      check(row, `connected white steel link between shafts ${i + 1}-${(i + 1) % 5 + 1} at ${height}m`, beams.length > 0 && samples.every(s => s.firstHit), { towerAxisXZMetres: [start.map(round), end.map(round)], actualShaftBoundaryDistancesM: [startBoundary?.distanceM ?? null, endBoundary?.distanceM ?? null], gapLengthM: round(clearEnd - clearStart), narrowConnectedComponents: beams.map(g => ({ triangleCount: g.triangleCount, boundsGLTFMetres: printableBounds(g.bounds) })), verticalRaySamples: samples });
    }
  }
  assets.push(row);
}
await mkdir('tests/reports', { recursive: true });
await writeFile('tests/reports/model-form.json', JSON.stringify({
  generatedAt: new Date().toISOString(), assetVersion: registry.assetVersion,
  snapshot: { path: snapshotPath, assetVersion: snapshot.assetVersion, registrySHA256: snapshot.registrySHA256 },
  method: 'NodeIO Meshopt-decoded final GLB world triangles. Connected full-size gold/green roof surfaces, material bounds and first-hit portal rays, four-corner steel plane intersections, diagonal dihedral crease edges excluding coplanar face diagonals, glass pod components, and thin connected cross-shaft components covering actual shaft boundaries with nine vertical ray samples per gap. Registration and unrelated published GLB hashes compared with the pre-form snapshot.',
  limitations: 'Verifies stated local components and passage geometry only. Steel member dimensions and arrangement, inferred arch dimensions, roof curves and decoration are not a measured as-built reconstruction. No new GPU image or photograph acceptance; no independent 3m position survey.',
  errors, registration, preservation, assets
}, null, 2) + '\n');
console.log(JSON.stringify({ errors, registrationCount: registration.length, registrationUnchanged: registration.every(r => r.passed), unrelatedUniqueAssetsUnchanged: preservation.filter(r => r.passed).length, assets: assets.map(r => ({ model: r.model, level: r.level, passed: r.checks.every(c => c.passed), checks: r.checks.length })) }));
if (errors.length) process.exitCode = 1;
