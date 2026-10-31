// Placing paragraph and page markers. A marker's meaning is its anchor in the stroke
// sequence; its drawn line should separate the strokes before it from the strokes after it.
// Strokes on the wrong side of the line are "conflicts", shown in amber for the writer to check.

import { bounds, strokeIndex, type Project, type Stroke } from "./project";

/** How far a stroke may cross the line before it counts as a conflict (logical units). */
const TOLERANCE = 1;

const centerY = (s: Stroke) => {
  const [, y0, , y1] = bounds(s);
  return (y0 + y1) / 2;
};

/**
 * The anchor for a line at height `y`: the last stroke of the longest run of strokes, in
 * playback order, whose centers are above the line. null = before the first stroke.
 */
export function anchorFor(strokes: Stroke[], y: number): number | null {
  let k = 0;
  while (k < strokes.length && centerY(strokes[k]) < y) k++;
  return k === 0 ? null : strokes[k - 1].id;
}

/**
 * Strokes on the wrong side of a line at `y` anchored after `after`: earlier strokes that
 * reach below it, or later strokes that reach above it.
 */
export function conflicts(strokes: Stroke[], after: number | null, y: number): number[] {
  const k = after === null ? 0 : strokes.findIndex((s) => s.id === after) + 1;
  const out: number[] = [];
  strokes.forEach((s, i) => {
    const [, y0, , y1] = bounds(s);
    if (i < k ? y1 > y + TOLERANCE : y0 < y - TOLERANCE) out.push(s.id);
  });
  return out;
}

/**
 * Where a marker dropped at `y` lands: the nearest height within one ruled line that has no
 * conflicts (searching outward), anchored to match. If there's none, it stays at `y` and the
 * conflicts are returned for highlighting.
 */
export function place(strokes: Stroke[], y: number, rule: number): { y: number; after: number | null; conflicts: number[] } {
  for (let d = 0; d <= rule; d++) {
    for (const candidate of d === 0 ? [y] : [y - d, y + d]) {
      const after = anchorFor(strokes, candidate);
      if (conflicts(strokes, after, candidate).length === 0) {
        return { y: candidate, after, conflicts: [] };
      }
    }
  }
  const after = anchorFor(strokes, y);
  return { y, after, conflicts: conflicts(strokes, after, y) };
}

/** Every stroke that conflicts with any marker, for highlighting. */
export function allConflicts(p: Project): Set<number> {
  const out = new Set<number>();
  for (const m of p.markers) {
    if (m.after !== null && strokeIndex(p, m.after) < 0) continue;
    conflicts(p.strokes, m.after, m.y).forEach((id) => out.add(id));
  }
  return out;
}

/** The marker whose line is within `radius` of `y`, if any (nearest wins). */
export function markerAt(p: Project, y: number, radius: number): number | null {
  let best: number | null = null;
  let bestD = radius;
  for (const m of p.markers) {
    const d = Math.abs(m.y - y);
    if (d <= bestD) {
      bestD = d;
      best = m.id;
    }
  }
  return best;
}
