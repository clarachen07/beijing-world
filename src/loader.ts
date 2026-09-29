/**
 * 运行时数据加载器：manifest.json + gzip 压缩的二进制网格块。
 *
 * 网格块格式（小端）：
 *   u32 vertexCount, u32 indexCount
 *   f32 position × 3v
 *   u8 color × 3v
 *   u32 index × 3t
 *
 * 树木：u32 count, f32 (x,z,scale) × n
 * 车流路径：u32 pathCount, 每 path: u16 ptCount, f32 × 2 × ptCount
 */
import { ORIGIN } from './geo';

export interface MeshChunk {
  file: string;
  v: number;
  i: number;
  ox?: number;
  oz?: number;
}

export interface Manifest {
  version: number;
  buildings: { chunks: MeshChunk[] };
  roads: MeshChunk;
  water: MeshChunk;
  green: MeshChunk;
  streetlights: MeshChunk;
  trees: { file: string; count: number };
  cars: { file: string; count: number };
  stats: Record<string, number>;
}

export interface DecodedMesh {
  positions: Float32Array;
  colors: Float32Array; // 归一化 0-1
  indices: Uint32Array;
}

function isGzip(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 2) return false;
  const u8 = new Uint8Array(buf, 0, 2);
  return u8[0] === 0x1f && u8[1] === 0x8b;
}

/** 若为原始 gzip 字节流则手动解压（服务器透明解码过则直接返回） */
async function maybeGunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  if (!isGzip(buf)) return buf;
  const DS = (globalThis as any).DecompressionStream;
  if (!DS) throw new Error('浏览器不支持 DecompressionStream');
  const stream = new Blob([buf]).stream().pipeThrough(new DS('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array };
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}

function decodeMesh(buffer: ArrayBuffer): DecodedMesh {
  const dv = new DataView(buffer);
  let off = 0;
  const vCount = dv.getUint32(off, true); off += 4;
  const iCount = dv.getUint32(off, true); off += 4;
  // 用 slice 拷贝以保证字节对齐（顶点区 15B/个不对齐）
  const positions = new Float32Array(buffer.slice(off, off + vCount * 12)); off += vCount * 12;
  const colorBytes = new Uint8Array(buffer.slice(off, off + vCount * 3)); off += vCount * 3;
  const indices = new Uint32Array(buffer.slice(off, off + iCount * 4));
  const colors = new Float32Array(vCount * 3);
  for (let i = 0; i < vCount * 3; i++) colors[i] = colorBytes[i] / 255;
  return { positions, colors, indices };
}

export interface LoadedData {
  manifest: Manifest;
  buildings: DecodedMesh[];
  roads: DecodedMesh;
  water: DecodedMesh;
  green: DecodedMesh;
  streetlights: DecodedMesh;
  trees: Float32Array;
  carPaths: Float32Array[];
}

export async function loadCityData(
  onProgress: (frac: number, label: string) => void
): Promise<LoadedData> {
  onProgress(0.02, '读取城市档案…');
  const res = await fetch('./data/manifest.json');
  if (!res.ok) throw new Error(`manifest.json 加载失败 (${res.status})`);
  const manifest: Manifest = await res.json();

  const files: { key: string; chunk: MeshChunk }[] = [];
  manifest.buildings.chunks.forEach((c, i) => files.push({ key: `b${i}`, chunk: c }));
  files.push({ key: 'roads', chunk: manifest.roads });
  files.push({ key: 'water', chunk: manifest.water });
  files.push({ key: 'green', chunk: manifest.green });
  files.push({ key: 'streetlights', chunk: manifest.streetlights });
  files.push({ key: 'trees', chunk: { file: manifest.trees.file, v: manifest.trees.count, i: 0 } });
  files.push({ key: 'cars', chunk: { file: manifest.cars.file, v: manifest.cars.count, i: 0 } });

  const results = new Map<string, ArrayBuffer>();
  let done = 0;
  const base = 0.05, span = 0.85;

  await Promise.all(
    files.map(async ({ key, chunk }) => {
      const r = await fetch(`./data/${chunk.file}`);
      if (!r.ok) throw new Error(`${chunk.file} 加载失败 (${r.status})`);
      const buf = await r.arrayBuffer();
      const raw = await maybeGunzip(buf);
      results.set(key, raw);
      done++;
      const mb = (buf.byteLength / 1048576).toFixed(1);
      onProgress(
        base + span * (done / files.length),
        `加载城市网格 ${done}/${files.length}（${mb} MB）`
      );
    })
  );

  onProgress(0.93, '构建建筑几何…');
  const buildings: DecodedMesh[] = manifest.buildings.chunks.map((_, i) =>
    decodeMesh(results.get(`b${i}`)!)
  );
  const roads = decodeMesh(results.get('roads')!);
  const water = decodeMesh(results.get('water')!);
  const green = decodeMesh(results.get('green')!);
  const streetlights = decodeMesh(results.get('streetlights')!);

  // 树木
  const treeBuf = results.get('trees')!;
  const trees = new Float32Array(treeBuf, 4, manifest.trees.count * 3);

  // 车流路径
  const carBuf = results.get('cars')!;
  const cdv = new DataView(carBuf);
  let off = 0;
  const pathCount = cdv.getUint32(off, true); off += 4;
  const carPaths: Float32Array[] = [];
  for (let p = 0; p < pathCount; p++) {
    const ptCount = cdv.getUint32(off, true); off += 4;
    const pts = new Float32Array(carBuf.slice(off, off + ptCount * 8)); off += ptCount * 8;
    carPaths.push(pts);
  }

  onProgress(0.97, '种植树木与点亮路灯…');
  return { manifest, buildings, roads, water, green, streetlights, trees, carPaths };
}

export { ORIGIN };
