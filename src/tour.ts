/**
 * 电影漫游：沿中轴线的确定性相机路径（同名关键帧供页面循环与视频渲染共用）。
 * pos/look/night 三条曲线，t ∈ [0,1] 均匀映射到总时长。
 */
import * as THREE from 'three';
import { latLonToLocal } from './geo';

interface Key {
  lat: number; lon: number; alt: number;
  lookLat: number; lookLon: number; lookAlt: number;
  night: number; // 该关键帧处的昼夜状态
}

// 北京中轴线巡礼 → 奥园 → CBD 夜景 → 全城收尾
const KEYS: Key[] = [
  // 1. 南城上空，望向中轴线南端
  { lat: 39.8450, lon: 116.3980, alt: 2100, lookLat: 39.8730, lookLon: 116.3980, lookAlt: 60, night: 0 },
  // 2. 永定门低空掠过
  { lat: 39.8800, lon: 116.3980, alt: 260, lookLat: 39.8990, lookLon: 116.3983, lookAlt: 50, night: 0 },
  // 3. 前门大街
  { lat: 39.8965, lon: 116.3975, alt: 130, lookLat: 39.9087, lookLon: 116.3976, lookAlt: 40, night: 0 },
  // 4. 天安门与广场
  { lat: 39.9050, lon: 116.3962, alt: 105, lookLat: 39.9163, lookLon: 116.3972, lookAlt: 40, night: 0 },
  // 5. 故宫上空斜掠（看金顶群）
  { lat: 39.9180, lon: 116.3930, alt: 185, lookLat: 39.9252, lookLon: 116.3965, lookAlt: 50, night: 0 },
  // 6. 景山万春亭
  { lat: 39.9290, lon: 116.3962, alt: 205, lookLat: 39.9403, lookLon: 116.3902, lookAlt: 45, night: 0 },
  // 7. 什刹海与钟鼓楼
  { lat: 39.9420, lon: 116.3860, alt: 230, lookLat: 39.9660, lookLon: 116.3900, lookAlt: 40, night: 0.1 },
  // 8. 北转场：升空飞向奥园
  { lat: 39.9680, lon: 116.3860, alt: 700, lookLat: 39.9929, lookLon: 116.3960, lookAlt: 60, night: 0.35 },
  // 9. 鸟巢上空
  { lat: 39.9955, lon: 116.3966, alt: 260, lookLat: 39.9934, lookLon: 116.3903, lookAlt: 40, night: 0.75 },
  // 10. 水立方 → 玲珑塔
  { lat: 39.9940, lon: 116.3860, alt: 170, lookLat: 39.9918, lookLon: 116.3866, lookAlt: 160, night: 0.95 },
  // 11. 升空南望奥园全景
  { lat: 39.9970, lon: 116.3820, alt: 620, lookLat: 39.9929, lookLon: 116.3940, lookAlt: 60, night: 1 },
  // 12. 高空向 CBD 转场
  { lat: 39.9680, lon: 116.4120, alt: 1500, lookLat: 39.9130, lookLon: 116.4450, lookAlt: 200, night: 1 },
  // 13. 中国尊近景
  { lat: 39.9065, lon: 116.4030, alt: 420, lookLat: 39.9133, lookLon: 116.4114, lookAlt: 300, night: 1 },
  // 14. CBD 天际线全景（央视入画）
  { lat: 39.9200, lon: 116.4320, alt: 520, lookLat: 39.9135, lookLon: 116.4550, lookAlt: 160, night: 1 },
  // 15. 拉高回望中轴线夜景收尾
  { lat: 39.9450, lon: 116.4180, alt: 1750, lookLat: 39.9080, lookLon: 116.3970, lookAlt: 80, night: 1 },
];

export const TOUR_DURATION = 105; // 秒

// 缓存曲线
let _posCurve: THREE.CatmullRomCurve3 | null = null;
let _lookCurve: THREE.CatmullRomCurve3 | null = null;
function curves(): { posCurve: THREE.CatmullRomCurve3; lookCurve: THREE.CatmullRomCurve3 } {
  if (!_posCurve || !_lookCurve) {
    const posPts = KEYS.map((k) => {
      const [x, z] = latLonToLocal(k.lat, k.lon);
      return new THREE.Vector3(x, k.alt, z);
    });
    const lookPts = KEYS.map((k) => {
      const [x, z] = latLonToLocal(k.lookLat, k.lookLon);
      return new THREE.Vector3(x, k.lookAlt, z);
    });
    _posCurve = new THREE.CatmullRomCurve3(posPts, false, 'centripetal');
    _lookCurve = new THREE.CatmullRomCurve3(lookPts, false, 'centripetal');
  }
  return { posCurve: _posCurve, lookCurve: _lookCurve };
}

export function tourPose(t: number, outPos: THREE.Vector3, outLook: THREE.Vector3): number {
  const { posCurve, lookCurve } = curves();
  const tc = Math.min(0.9999, Math.max(0, t));
  posCurve.getPoint(tc, outPos);
  lookCurve.getPoint(tc, outLook);
  // 夜晚状态插值（关键帧线性）
  const seg = tc * (KEYS.length - 1);
  const i = Math.min(KEYS.length - 2, Math.floor(seg));
  const f = seg - i;
  return KEYS[i].night + (KEYS[i + 1].night - KEYS[i].night) * f;
}
