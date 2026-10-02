/** Pure, time-based traffic simulation shared by preview and frame capture. */
export interface TrafficCar { path: number; start: number; speed: number; direction: 1 | -1; lane: number }
export function seededRandom(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export class TrafficSimulation {
  readonly paths: Float32Array[] = []; readonly lengths: number[] = []; readonly cumulative: Float64Array[] = [];
  readonly cars: TrafficCar[] = [];
  constructor(paths: Float32Array[], count: number, seed = 20261002) {
    for (const path of paths) {
      if (path.length < 4 || path.length % 2 || !path.every(Number.isFinite)) continue;
      const cumulative = new Float64Array(path.length / 2); let length = 0;
      for (let i = 1; i < cumulative.length; i++) { length += Math.hypot(path[i * 2] - path[i * 2 - 2], path[i * 2 + 1] - path[i * 2 - 1]); cumulative[i] = length; }
      if (length < 30) continue;
      this.paths.push(path); this.lengths.push(length); this.cumulative.push(cumulative);
    }
    const random = seededRandom(seed);
    if (!this.paths.length) return;
    for (let i = 0; i < count; i++) {
      const path = Math.floor(random() * this.paths.length), direction = random() < 0.5 ? 1 : -1;
      this.cars.push({ path, start: random() * this.lengths[path], speed: 9 + random() * 11, direction, lane: direction * 3.2 });
    }
  }
  evaluate(index: number, seconds: number, out: { x: number; z: number; dx: number; dz: number }) {
    const car = this.cars[index], length = this.lengths[car.path], path = this.paths[car.path], cumulative = this.cumulative[car.path];
    const distance = ((car.start + car.speed * car.direction * seconds) % length + length) % length;
    let lo = 1, hi = cumulative.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid] < distance) lo = mid + 1; else hi = mid; }
    const i = lo, segment = cumulative[i] - cumulative[i - 1] || 1, t = (distance - cumulative[i - 1]) / segment;
    const dx = path[i * 2] - path[i * 2 - 2], dz = path[i * 2 + 1] - path[i * 2 - 1];
    out.dx = dx / segment; out.dz = dz / segment;
    out.x = path[i * 2 - 2] + dx * t - out.dz * car.lane;
    out.z = path[i * 2 - 1] + dz * t + out.dx * car.lane;
  }
}
