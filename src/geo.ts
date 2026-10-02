/**
 * 地理坐标 → 场景坐标（米）。
 * 约定：x 向东，z 向南（北为 -z），y 向上。origin 与烘焙脚本保持一致。
 */
import worldConfigData from '../config/world.json';
const worldConfig = worldConfigData;
export const ORIGIN = worldConfig.origin;

const M_PER_DEG_LAT = worldConfig.projection.metresPerDegreeLat;
const M_PER_DEG_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180); // ≈ 85.3 km/°

/** 经纬度 → 本地米坐标 */
export function latLonToLocal(lat: number, lon: number): [number, number] {
  return [(lon - ORIGIN.lon) * M_PER_DEG_LON, (ORIGIN.lat - lat) * M_PER_DEG_LAT];
}

/** 米坐标 → 经纬度（逆变换，调试用） */
export function localToLatLon(x: number, z: number): [number, number] {
  return [ORIGIN.lat - z / M_PER_DEG_LAT, ORIGIN.lon + x / M_PER_DEG_LON];
}

/** 场景总范围（米） */
const [west, south, east, north] = worldConfig.fetchBounds;
function checkedBounds(values: number[]): [number, number, number, number] {
  if (values.length !== 4 || !values.every(Number.isFinite)) throw new Error('Invalid world bounds');
  return [values[0], values[1], values[2], values[3]];
}
export const WORLD_BOUNDS = checkedBounds(worldConfig.worldBounds ?? [
  (west - ORIGIN.lon) * M_PER_DEG_LON, (ORIGIN.lat - north) * M_PER_DEG_LAT,
  (east - ORIGIN.lon) * M_PER_DEG_LON, (ORIGIN.lat - south) * M_PER_DEG_LAT,
]);
export const WORLD = {
  w: WORLD_BOUNDS[2] - WORLD_BOUNDS[0],
  h: WORLD_BOUNDS[3] - WORLD_BOUNDS[1],
  bounds: WORLD_BOUNDS,
};

/** 简易 hash 随机（确定性） */
export function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
