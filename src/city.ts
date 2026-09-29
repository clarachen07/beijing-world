/**
 * 城市网格装配：加载的数据 → three.js 场景对象
 */
import * as THREE from 'three';
import type { LoadedData, DecodedMesh } from './loader';
import { makeBuildingMaterial, makeRoadMaterial, makeWaterMaterial, makeGreenMaterial, makeStreetlightMaterial, uniforms } from './materials';

export interface CityRefs {
  group: THREE.Group;
  streetlightMat: THREE.PointsMaterial;
  waterMat: THREE.MeshPhongMaterial;
  greenMat: THREE.MeshLambertMaterial;
  chunkMeshes: THREE.Mesh[];
}

function meshFromDecoded(d: DecodedMesh, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(d.colors, 3));
  geo.setIndex(new THREE.BufferAttribute(d.indices, 1));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  return mesh;
}

export function buildCity(data: LoadedData): CityRefs {
  const group = new THREE.Group();

  // ── 地面 ──（polygonOffset 把地面压向深处，让绿地/水面/道路贴片稳定获胜，消除远距离深度冲突）
  const groundMat = new THREE.MeshLambertMaterial({
    color: 0x97897a,
    polygonOffset: true,
    polygonOffsetFactor: 3,
    polygonOffsetUnits: 3,
  });
  groundMat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uniforms.uNight;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uNight;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= mix(1.0, 0.26, uNight);`
      );
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(26000, 32000), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 2600);
  ground.matrixAutoUpdate = false;
  ground.updateMatrix();
  group.add(ground);

  // ── 建筑分块 ──
  const buildingMat = makeBuildingMaterial();
  const chunkMeshes: THREE.Mesh[] = [];
  data.manifest.buildings.chunks.forEach((chunk, i) => {
    const mesh = meshFromDecoded(data.buildings[i], buildingMat);
    mesh.position.set(chunk.ox ?? 0, 0, chunk.oz ?? 0);
    mesh.updateMatrix();
    mesh.frustumCulled = true;
    // 计算包围球（供视锥剔除）
    mesh.geometry.computeBoundingSphere();
    group.add(mesh);
    chunkMeshes.push(mesh);
  });

  // ── 道路 ──
  const roadMat = makeRoadMaterial();
  const roads = meshFromDecoded(data.roads, roadMat);
  roads.geometry.computeBoundingSphere();
  group.add(roads);

  // ── 水面 ──
  const waterMat = makeWaterMaterial();
  const water = meshFromDecoded(data.water, waterMat);
  water.geometry.computeBoundingSphere();
  group.add(water);

  // ── 绿地 ──
  const greenMat = makeGreenMaterial();
  const green = meshFromDecoded(data.green, greenMat);
  green.geometry.computeBoundingSphere();
  group.add(green);

  // ── 树木（实例化）──
  const treeCount = data.trees.length / 3;
  if (treeCount > 0) {
    const trunkGeo = new THREE.CylinderGeometry(0.32, 0.5, 2.8, 5);
    trunkGeo.translate(0, 1.4, 0);
    const canopyGeo = new THREE.IcosahedronGeometry(3.1, 1);
    canopyGeo.scale(1, 1.2, 1);
    canopyGeo.translate(0, 5.6, 0);

    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5d4a38, flatShading: true });
    const canopyMat = new THREE.MeshLambertMaterial({ color: 0x3e6b30, flatShading: true });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    for (let i = 0; i < treeCount; i++) {
      const x = data.trees[i * 3], z = data.trees[i * 3 + 1], sc = data.trees[i * 3 + 2];
      p.set(x, 0, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * 2.399) % (Math.PI * 2));
      s.set(sc / 4, sc / 4, sc / 4);
      m.compose(p, q, s);
      trunks.setMatrixAt(i, m);
      canopies.setMatrixAt(i, m);
      const g = 0.7 + ((i * 0.618) % 1) * 0.6;
      col.setRGB(0.15 * g, 0.33 * g, 0.11 * g);
      canopies.setColorAt(i, col);
    }
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    trunks.frustumCulled = false;
    canopies.frustumCulled = false;
    group.add(trunks, canopies);
  }

  // ── 路灯 ──
  const streetlightMat = makeStreetlightMaterial();
  if (data.streetlights.positions.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.streetlights.positions.slice(), 3));
    const points = new THREE.Points(geo, streetlightMat);
    points.frustumCulled = false;
    group.add(points);
  }

  return { group, streetlightMat, waterMat, greenMat, chunkMeshes };
}
