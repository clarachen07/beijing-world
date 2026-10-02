/** Versioned static assets. Coordinates use metres, +X east and +Z south. */
export type Bounds = [number, number, number, number];
export interface AssetRef { file: string; hash?: string; bytes?: number }
export interface MeshChunk extends AssetRef {
  v: number; i: number; ox?: number; oz?: number; q?: 'f32' | 'i16c' | 'i16w';
}
export type MeshLayer = 'buildings' | 'roofs' | 'roads' | 'water' | 'green' | 'streetlights';
export interface TileDescriptor {
  id: string; lod: 0 | 1 | 2; size: number; bounds: Bounds; ox: number; oz: number;
  meshes: Partial<Record<MeshLayer, MeshChunk>>;
  trees?: AssetRef & { count: number };
  ground?: { mesh?: MeshChunk; texture?: AssetRef & { bounds: Bounds; mime?: string } };
  collision?: AssetRef; sourceIndex?: AssetRef; children?: string[];
  geometricError?: number; complete?: boolean;
}
export interface Manifest {
  version: 2; revision: string; origin: { lat: number; lon: number }; bounds: Bounds;
  tiles: TileDescriptor[]; cars?: AssetRef & { count: number }; trafficGround?: AssetRef;
  coverage: { boundaryFile: string; verified: boolean; scope: string; date: string; [key: string]: unknown };
  sources: unknown[]; stats: Record<string, number>; assets?: AssetRef[];
}
export interface DecodedMesh { positions: Float32Array; colors: Uint8Array; indices: Uint32Array }
export interface DecodedTile {
  descriptor: TileDescriptor; meshes: Partial<Record<MeshLayer, DecodedMesh>>;
  ground?: DecodedMesh; trees?: Float32Array;
}
