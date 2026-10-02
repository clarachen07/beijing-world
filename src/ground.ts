export interface GroundGrid { width: number; height: number; origin: [number, number]; step: number; heights: number[] }
export function groundSampler(grid: GroundGrid): (x: number, z: number) => number {
  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 2 || grid.height < 2 ||
      !(grid.step > 0) || grid.heights.length !== grid.width * grid.height || !grid.heights.every(Number.isFinite)) throw new Error('Invalid ground grid');
  return (x, z) => {
    const gx = Math.max(0, Math.min(grid.width - 1.00001, (x - grid.origin[0]) / grid.step));
    const gz = Math.max(0, Math.min(grid.height - 1.00001, (z - grid.origin[1]) / grid.step));
    const ix = Math.floor(gx), iz = Math.floor(gz), u = gx - ix, v = gz - iz, i = iz * grid.width + ix;
    return (grid.heights[i] * (1-u) + grid.heights[i+1] * u) * (1-v) +
      (grid.heights[i+grid.width] * (1-u) + grid.heights[i+grid.width+1] * u) * v;
  };
}
