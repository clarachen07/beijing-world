/**
 * 地理坐标 → 场景坐标（米）。
 * 约定：x 向东，z 向南（北为 -z），y 向上。origin 与烘焙脚本保持一致。
 */
export const ORIGIN = { lat: 39.9475, lon: 116.41 };

const M_PER_DEG_LAT = 111132;
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
export const WORLD = {
  w: (116.48 - 116.34) * M_PER_DEG_LON, // ≈ 12.8 km
  h: (40.03 - 39.865) * M_PER_DEG_LAT, // ≈ 18.3 km
};

/** 简易 hash 随机（确定性） */
export function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
