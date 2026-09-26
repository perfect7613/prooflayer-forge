import { vec2, type Vec2, type Mat2d } from 'math';
// One affine transform per figure; caller-owned scratch avoids per-point vector allocation.
// O(n), linear axes; constant domains receive one unit of padding. Invalid data is omitted upstream.
export function chartTransform(xmin: number, xmax: number, ymin: number, ymax: number): Mat2d {
  if (![xmin, xmax, ymin, ymax].every(Number.isFinite)) throw Error('Non-finite chart domain');
  const sx = 580 / (xmax - xmin || 1), sy = -260 / (ymax - ymin || 1);
  return [sx, 0, 0, sy, 70 - xmin * sx, 290 - ymin * sy];
}
export function projectPoint(out: Vec2, x: number, y: number, transform: Mat2d): Vec2 {
  out[0] = x; out[1] = y;
  return vec2.transformMat2d(out, out, transform);
}
