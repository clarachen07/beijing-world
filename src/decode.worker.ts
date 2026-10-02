import { gunzip, decodeMesh, decodeTrees } from './decode';
import type { MeshChunk } from './data';

self.onmessage = async (event: MessageEvent<{ id: number; buffer: ArrayBuffer; mode?: MeshChunk['q']; trees?: number }>) => {
  const { id, buffer, mode, trees } = event.data;
  try {
    const raw = await gunzip(buffer);
    if (trees !== undefined) {
      const data = decodeTrees(raw, trees);
      self.postMessage({ id, data }, { transfer: [data.buffer] });
    } else {
      const data = decodeMesh(raw, mode);
      self.postMessage({ id, data }, { transfer: [data.positions.buffer, data.colors.buffer, data.indices.buffer] });
    }
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};
