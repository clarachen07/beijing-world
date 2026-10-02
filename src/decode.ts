import type { DecodedMesh, MeshChunk } from './data';

export async function gunzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return buffer;
  if (typeof DecompressionStream === 'undefined') throw new Error('浏览器版本过旧，请更新浏览器');
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/** Check lengths before allocating. Corrupt or truncated assets never reach WebGL. */
export function decodeMesh(buffer: ArrayBuffer, mode: MeshChunk['q'] = 'f32'): DecodedMesh {
  if (buffer.byteLength < 8) throw new Error('网格文件头不完整');
  const view = new DataView(buffer);
  const vertices = view.getUint32(0, true), indexCount = view.getUint32(4, true);
  if (vertices > 10_000_000 || indexCount > 30_000_000 || indexCount % 3) throw new Error('网格计数无效');
  const positionBytes = vertices * 3 * (mode === 'f32' ? 4 : 2);
  if (8 + positionBytes + vertices * 3 + indexCount * 4 !== buffer.byteLength) throw new Error('网格文件长度不匹配');
  const positions = new Float32Array(vertices * 3);
  const scale = mode === 'i16c' ? 0.2 : 0.5;
  for (let i = 0; i < positions.length; i++) {
    const value = mode === 'f32' ? view.getFloat32(8 + i * 4, true) : view.getInt16(8 + i * 2, true) * scale;
    if (!Number.isFinite(value)) throw new Error('网格坐标无效');
    positions[i] = value;
  }
  const colorOffset = 8 + positionBytes;
  const colors = new Uint8Array(buffer.slice(colorOffset, colorOffset + vertices * 3));
  const indices = new Uint32Array(indexCount), indexOffset = colorOffset + vertices * 3;
  for (let i = 0; i < indexCount; i++) {
    indices[i] = view.getUint32(indexOffset + i * 4, true);
    if (indices[i] >= vertices) throw new Error('网格索引越界');
  }
  return { positions, colors, indices };
}

export function decodeTrees(buffer: ArrayBuffer, expectedCount?: number): Float32Array {
  if (buffer.byteLength < 4) throw new Error('树木文件头不完整');
  const count = new DataView(buffer).getUint32(0, true);
  if (count > 2_000_000 || buffer.byteLength !== 4 + count * 12 || (expectedCount !== undefined && count !== expectedCount)) throw new Error('树木文件计数不匹配');
  const trees = new Float32Array(buffer.slice(4));
  if (!trees.every(Number.isFinite)) throw new Error('树木坐标无效');
  return trees;
}

export function decodeCarPaths(buffer: ArrayBuffer): Float32Array[] {
  if (buffer.byteLength < 4) throw new Error('车流文件头不完整');
  const view = new DataView(buffer), count = view.getUint32(0, true);
  if (count > 100_000) throw new Error('车流路径计数无效');
  const paths: Float32Array[] = []; let offset = 4;
  for (let p = 0; p < count; p++) {
    if (offset + 4 > buffer.byteLength) throw new Error('车流路径不完整');
    const points = view.getUint32(offset, true); offset += 4;
    if (points > 100_000 || offset + points * 8 > buffer.byteLength) throw new Error('车流路径长度无效');
    const path = new Float32Array(buffer.slice(offset, offset + points * 8)); offset += points * 8;
    if (!path.every(Number.isFinite)) throw new Error('车流坐标无效');
    if (points >= 2) paths.push(path);
  }
  if (offset !== buffer.byteLength) throw new Error('车流文件有未知尾部数据');
  return paths;
}
