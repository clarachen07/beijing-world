import type { Manifest, MeshChunk, DecodedMesh, DecodedTile, TileDescriptor, MeshLayer } from './data';
import { fetchAssetBytes, fetchAssetJSON } from './asset-fetch';
import type { FetchOptions } from './asset-fetch';
import { decodeCarPaths, decodeMesh, decodeTrees, gunzip } from './decode';

export type { Manifest, MeshChunk, DecodedMesh, DecodedTile, TileDescriptor } from './data';
export { resolveAsset, fetchAssetBytes, fetchAssetJSON } from './asset-fetch';

export function validateManifest(value: unknown): Manifest {
  const manifest = value as Manifest;
  if (!manifest || manifest.version !== 2 || !Array.isArray(manifest.tiles) || !manifest.tiles.length || !manifest.revision) throw new Error('城市档案版本不匹配，请更新城市资源');
  if (manifest.coverage?.verified !== true || Object.values(manifest.coverage.complete ?? {}).some(value=>value===false)) throw new Error('城市数据快照未通过完整性验证');
  const ids = new Set<string>();
  if (manifest.bounds?.length !== 4 || !manifest.bounds.every(Number.isFinite) || !Number.isFinite(manifest.origin?.lat) || !Number.isFinite(manifest.origin?.lon)) throw new Error('城市坐标档案无效');
  for (const tile of manifest.tiles) {
    if (!tile.id || ids.has(tile.id) || ![0, 1, 2].includes(tile.lod) || tile.bounds?.length !== 4 || !tile.bounds.every(Number.isFinite) || !Number.isFinite(tile.ox) || !Number.isFinite(tile.oz) || !tile.meshes || tile.complete === false) throw new Error('城市分块档案无效');
    ids.add(tile.id);
  }
  for (const tile of manifest.tiles) if (tile.children?.some(id => !ids.has(id))) throw new Error('城市分块存在缺失的子块');
  const byId = new Map(manifest.tiles.map(tile=>[tile.id,tile]));
  const visited = new Set<string>(), active = new Set<string>(), parents = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) throw new Error('城市分块层级存在循环'); if (visited.has(id)) return;
    active.add(id);
    const tile = byId.get(id)!;
    for (const child of tile.children ?? []) {
      if (parents.has(child) || byId.get(child)!.lod >= tile.lod) throw new Error('城市分块层级无效');
      parents.add(child); visit(child);
    }
    active.delete(id); visited.add(id);
  };
  // Roots first avoids counting a child twice when the flat manifest lists it first.
  const children = new Set(manifest.tiles.flatMap(tile=>tile.children ?? []));
  for (const tile of manifest.tiles.filter(tile=>!children.has(tile.id))) visit(tile.id);
  if (visited.size !== manifest.tiles.length) throw new Error('城市分块层级存在循环');
  return manifest;
}

export class CityLoader {
  private worker: Worker | null = null; private nextId = 0; private disposed = false;
  private pending = new Map<number, { resolve: (data: DecodedMesh | Float32Array) => void; reject: (error: unknown) => void }>();
  constructor() {
    if (typeof Worker !== 'undefined') {
      try { this.worker = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' }); } catch { return; }
      this.worker.onmessage = event => {
        const { id, data, error } = event.data;
        const job = this.pending.get(id); if (!job) return;
        this.pending.delete(id); if (error) job.reject(new Error(error)); else job.resolve(data);
      };
      this.worker.onerror = () => {
        for (const job of this.pending.values()) job.reject(new Error('城市解码失败，请重试'));
        this.pending.clear(); this.worker?.terminate(); this.worker = null;
      };
    }
  }
  private async decode(buffer: ArrayBuffer, mode?: MeshChunk['q'], trees?: number): Promise<DecodedMesh | Float32Array> {
    if (this.disposed) throw new Error('加载器已关闭');
    if (!this.worker) { const raw = await gunzip(buffer); return trees === undefined ? decodeMesh(raw, mode) : decodeTrees(raw, trees); }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, buffer, mode, trees }, [buffer]);
    });
  }
  async loadMesh(chunk: MeshChunk, options: FetchOptions = {}): Promise<DecodedMesh> {
    const mesh = await this.decode(await fetchAssetBytes(`data/${chunk.file}`, options), chunk.q) as DecodedMesh;
    if (mesh.positions.length !== chunk.v * 3 || mesh.indices.length !== chunk.i) throw new Error(`网格档案计数不匹配: ${chunk.file}`);
    return mesh;
  }
  async loadTile(descriptor: TileDescriptor, options: FetchOptions = {}): Promise<DecodedTile> {
    const meshes: DecodedTile['meshes'] = {};
    await Promise.all(Object.entries(descriptor.meshes).map(async ([layer, chunk]) => { if (chunk) meshes[layer as MeshLayer] = await this.loadMesh(chunk, options); }));
    const [ground, trees] = await Promise.all([
      descriptor.ground?.mesh ? this.loadMesh(descriptor.ground.mesh, options) : undefined,
      descriptor.trees ? fetchAssetBytes(`data/${descriptor.trees.file}`, options).then(buffer => this.decode(buffer, undefined, descriptor.trees!.count) as Promise<Float32Array>) : undefined,
    ]);
    options.signal?.throwIfAborted(); return { descriptor, meshes, ground, trees };
  }
  async loadManifest(): Promise<Manifest> { return validateManifest(await fetchAssetJSON('data/manifest.json', { priority: 100 })); }
  async loadCarPaths(manifest: Manifest): Promise<Float32Array[]> {
    return manifest.cars ? decodeCarPaths(await gunzip(await fetchAssetBytes(`data/${manifest.cars.file}`))) : [];
  }
  dispose() {
    this.disposed = true; this.worker?.terminate(); this.worker = null;
    for (const job of this.pending.values()) job.reject(new Error('加载器已关闭'));
    this.pending.clear();
  }
}
