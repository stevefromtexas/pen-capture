// Finding strokes under the Pencil: a tap picks the nearest stroke, a drag picks every
// stroke with a point inside the rectangle.

import type { Point, Stroke } from "./project";

/** Id of the stroke nearest to (x, y), if any segment is within `maxDist` logical units. */
export function hitTest(strokes: Stroke[], x: number, y: number, maxDist: number): number | null {
  let best: number | null = null;
  let bestDist = maxDist;
  for (const s of strokes) {
    const d = distanceToStroke(s.points, x, y);
    if (d <= bestDist) {
      bestDist = d;
      best = s.id;
    }
  }
  return best;
}

/** Ids of strokes with at least one point inside the rectangle (corners in any order). */
export function inRect(strokes: Stroke[], ax: number, ay: number, bx: number, by: number): number[] {
  const [x0, x1] = [Math.min(ax, bx), Math.max(ax, bx)];
  const [y0, y1] = [Math.min(ay, by), Math.max(ay, by)];
  return strokes
    .filter((s) => s.points.some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1))
    .map((s) => s.id);
}

function distanceToStroke(points: Point[], x: number, y: number): number {
  if (points.length === 1) return Math.hypot(points[0][0] - x, points[0][1] - y);
  let min = Infinity;
  for (let i = 1; i < points.length; i++) {
    min = Math.min(min, distanceToSegment(points[i - 1], points[i], x, y));
  }
  return min;
}

function distanceToSegment(a: Point, b: Point, x: number, y: number): number {
  const [ax, ay] = a;
  const dx = b[0] - ax;
  const dy = b[1] - ay;
  const len2 = dx * dx + dy * dy;
  // Project (x, y) onto the segment, clamped to its ends.
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
  return Math.hypot(ax + t * dx - x, ay + t * dy - y);
}
