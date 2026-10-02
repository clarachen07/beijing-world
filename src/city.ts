import * as THREE from 'three';
import type { DecodedMesh, DecodedTile, Bounds, MeshLayer } from './data';
import { fetchAssetBytes } from './asset-fetch';
import { makeBuildingMaterial, makeRoofMaterial, makeRoadMaterial, makeWaterMaterial, makeGreenMaterial, makeStreetlightMaterial, uniforms } from './materials';

interface TextureEntry { texture: THREE.Texture; references: number; ready: Promise<void>; controller: AbortController }
/** Ground images may be shared by near/far meshes; unload only after the last user. */
class TexturePool {
  private entries = new Map<string, TextureEntry>();
  acquire(file: string): TextureEntry {
    const existing = this.entries.get(file);
    if (existing) { existing.references++; return existing; }
    const texture = new THREE.Texture();
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    const entry: TextureEntry = { texture, references: 1, ready: Promise.resolve(), controller:new AbortController() };
    entry.ready = fetchAssetBytes(`data/${file}`,{signal:entry.controller.signal}).then(async bytes => {
      const bitmap = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'flipY' });
      if (this.entries.get(file) !== entry) { bitmap.close(); return; }
      texture.image = bitmap; texture.flipY = false; texture.needsUpdate = true;
    });
    this.entries.set(file, entry); return entry;
  }
  release(file: string) {
    const entry = this.entries.get(file); if (!entry || --entry.references > 0) return;
    entry.controller.abort(); entry.texture.dispose(); (entry.texture.image as ImageBitmap | undefined)?.close?.(); this.entries.delete(file);
  }
  dispose() { for (const [file, entry] of this.entries) { entry.references = 1; this.release(file); } }
}

export class CityMaterials {
  readonly layers = {
    buildings: makeBuildingMaterial(), roofs: makeRoofMaterial(), roads: makeRoadMaterial(), water: makeWaterMaterial(),
    green: makeGreenMaterial(), streetlights: makeStreetlightMaterial(),
  };
  readonly trunk = new THREE.MeshLambertMaterial({ color: 0x75654b, flatShading: true });
  readonly canopy = new THREE.MeshLambertMaterial({ color: 0x56704b, flatShading: true });
  readonly textures = new TexturePool();
  update(night: number) { this.layers.streetlights.opacity = night * 0.85; }
  dispose() {
    for (const material of Object.values(this.layers)) { if (material instanceof THREE.PointsMaterial) material.map?.dispose(); material.dispose(); }
    this.trunk.dispose(); this.canopy.dispose(); this.textures.dispose();
  }
}

export interface CityTile {
  group: THREE.Group; triangles: number; bytes: number; ready: Promise<void>; dispose(): void;
}
function geometryFromDecoded(mesh: DecodedMesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3, true));
  if (mesh.indices.length) geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere(); return geometry;
}

export function buildCityTile(data: DecodedTile, materials: CityMaterials, mobile = false): CityTile {
  const { descriptor } = data; const group = new THREE.Group();
  group.name = `tile:${descriptor.id}`; group.position.set(descriptor.ox, 0, descriptor.oz);
  group.matrixAutoUpdate = false; group.updateMatrix();
  const geometries: THREE.BufferGeometry[] = [], ownMaterials: THREE.Material[] = [];
  let triangles = 0, bytes = 0, textureFile: string | undefined;
  const imageJobs: Promise<void>[] = [];
  for (const [key, mesh] of Object.entries(data.meshes)) {
    const geometry = geometryFromDecoded(mesh!); geometries.push(geometry);
    const object = key === 'streetlights'
      ? new THREE.Points(geometry, materials.layers.streetlights)
      : new THREE.Mesh(geometry, materials.layers[key as Exclude<MeshLayer, 'streetlights'>]);
    object.matrixAutoUpdate = false; object.updateMatrix();
    group.add(object); triangles += mesh!.indices.length / 3;
    bytes += mesh!.positions.byteLength + mesh!.colors.byteLength + mesh!.indices.byteLength;
  }
  if (data.ground) {
    const geometry = geometryFromDecoded(data.ground); geometries.push(geometry); geometry.computeVertexNormals();
    const material = new THREE.MeshLambertMaterial({ color: 0xb9b6a5, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const image = descriptor.ground?.texture;
    if (image) {
      textureFile = image.file;
      const entry = materials.textures.acquire(image.file);
      const uv = new Float32Array(data.ground.positions.length / 3 * 2);
      const [x0, z0, x1, z1] = image.bounds;
      for (let i = 0; i < uv.length / 2; i++) {
        uv[i * 2] = (data.ground.positions[i * 3] + descriptor.ox - x0) / (x1 - x0);
        uv[i * 2 + 1] = 1 - (data.ground.positions[i * 3 + 2] + descriptor.oz - z0) / (z1 - z0);
      }
      geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      imageJobs.push(entry.ready.then(() => { material.map = entry.texture; material.color.setHex(0xffffff); material.needsUpdate = true; }));
    }
    material.onBeforeCompile = shader => {
      shader.uniforms.uNight = uniforms.uNight;
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(1.0, 0.25, uNight);');
    };
    ownMaterials.push(material); group.add(new THREE.Mesh(geometry, material)); triangles += data.ground.indices.length / 3;
    bytes += data.ground.positions.byteLength + data.ground.colors.byteLength + data.ground.indices.byteLength;
  }
  if (data.trees?.length && descriptor.lod === 0) {
    const count = Math.ceil(data.trees.length / 3 / (mobile ? 2 : 1));
    const trunkGeometry = new THREE.CylinderGeometry(0.25, 0.4, 2.6, 4); trunkGeometry.translate(0, 1.3, 0);
    const crownGeometry = new THREE.IcosahedronGeometry(2.8, 0); crownGeometry.scale(1, 1.2, 1); crownGeometry.translate(0, 4.2, 0);
    geometries.push(trunkGeometry, crownGeometry);
    const trunks = new THREE.InstancedMesh(trunkGeometry, materials.trunk, count);
    const crowns = new THREE.InstancedMesh(crownGeometry, materials.canopy, count);
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
    const terrain = data.ground;
    const heightAt = (x: number, z: number) => {
      if (!terrain) return 0;
      let distance = Infinity, height = 0;
      for (let i = 0; i < terrain.positions.length; i += 3) {
        const d = (x - terrain.positions[i]) ** 2 + (z - terrain.positions[i + 2]) ** 2;
        if (d < distance) { distance = d; height = terrain.positions[i + 1]; }
      }
      return height;
    };
    for (let i = 0; i < count; i++) {
      const source = i * (mobile ? 2 : 1) * 3;
      const x = data.trees[source], z = data.trees[source + 1], s = data.trees[source + 2] / 5.5;
      position.set(x, heightAt(x, z), z); scale.setScalar(s); rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, i * 2.399);
      matrix.compose(position, rotation, scale); trunks.setMatrixAt(i, matrix); crowns.setMatrixAt(i, matrix);
    }
    trunks.instanceMatrix.needsUpdate = true; crowns.instanceMatrix.needsUpdate = true;
    trunks.computeBoundingSphere(); crowns.computeBoundingSphere(); group.add(trunks, crowns);
    triangles += count * ((trunkGeometry.index?.count ?? 0) + (crownGeometry.index?.count ?? crownGeometry.attributes.position.count)) / 3;
    bytes += count * 2 * 64;
  }
  let disposed = false;
  return { group, triangles, bytes, ready: Promise.all(imageJobs).then(() => undefined),
    dispose() {
      if (disposed) return; disposed = true; group.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const material of ownMaterials) material.dispose();
      if (textureFile) materials.textures.release(textureFile);
      group.clear();
    } };
}

export function tileBox(bounds: Bounds) { return new THREE.Box3(new THREE.Vector3(bounds[0], -100, bounds[1]), new THREE.Vector3(bounds[2], 700, bounds[3])); }
