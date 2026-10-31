// Edits to the stroke *sequence* (playback order): adding strokes at an insertion cursor,
// deleting strokes, and keeping markers on the correct side of everything.

import type { Command } from "./history";
import { strokeIndex, type Project, type Stroke } from "./project";

/**
 * Where new strokes go. `null` means "append at the end" (normal writing).
 * Otherwise new strokes go right after stroke `after` (null = before the first stroke), and
 * the markers listed in `carry` move along so they stay *after* the new strokes.
 */
export interface Cursor {
  after: number | null;
  /** Markers that must stay after the inserted strokes. */
  carry: number[];
}

/** Command that adds `stroke` at the cursor (or at the end), and where the cursor moves to. */
export function addStroke(p: Project, stroke: Stroke, cursor: Cursor | null): { command: Command; cursor: Cursor | null } {
  if (!cursor) {
    return { command: { type: "insertStroke", stroke, index: p.strokes.length }, cursor: null };
  }
  const index = cursor.after === null ? 0 : strokeIndex(p, cursor.after) + 1;
  const commands: Command[] = [{ type: "insertStroke", stroke, index }];
  for (const id of cursor.carry) {
    const m = p.markers.find((x) => x.id === id);
    if (m) commands.push({ type: "changeMarker", before: { ...m }, after: { ...m, after: stroke.id } });
  }
  return {
    command: { type: "batch", commands },
    cursor: { after: stroke.id, carry: cursor.carry },
  };
}

/**
 * Command that deletes the strokes in `ids`. Markers anchored to a deleted stroke are
 * re-anchored to the nearest surviving stroke before it, so they keep their place.
 * Also returns what was re-anchored, for Replace.
 */
export function deleteStrokes(p: Project, ids: Set<number>): { command: Command; reanchored: number[]; before: number | null } {
  const commands: Command[] = [];
  const reanchored: number[] = [];
  // Nearest surviving stroke before each position.
  const survivorBefore = (index: number): number | null => {
    for (let i = index - 1; i >= 0; i--) if (!ids.has(p.strokes[i].id)) return p.strokes[i].id;
    return null;
  };
  for (const m of p.markers) {
    if (m.after !== null && ids.has(m.after)) {
      const to = survivorBefore(strokeIndex(p, m.after));
      commands.push({ type: "changeMarker", before: { ...m }, after: { ...m, after: to } });
      reanchored.push(m.id);
    }
  }
  // Delete from the end so earlier indices stay valid while applying in order.
  const doomed = p.strokes.map((s, i) => [s, i] as const).filter(([s]) => ids.has(s.id));
  for (const [stroke, index] of [...doomed].reverse()) {
    commands.push({ type: "deleteStroke", stroke, index });
  }
  const first = doomed.length ? doomed[0][1] : p.strokes.length;
  return { command: { type: "batch", commands }, reanchored, before: survivorBefore(first) };
}

/**
 * Replace: delete the selection and put the cursor where it was. Strokes written next take
 * exactly its place in the playback order, and markers that came after the selection stay
 * after the new strokes.
 */
export function replace(p: Project, ids: Set<number>): { command: Command; cursor: Cursor } {
  const { command, reanchored, before } = deleteStrokes(p, ids);
  return { command, cursor: { after: before, carry: reanchored } };
}

/** Insert after: the cursor goes right after `id`; markers after it stay after the new strokes. */
export function insertAfter(p: Project, id: number): Cursor {
  return { after: id, carry: p.markers.filter((m) => m.after === id).map((m) => m.id) };
}

/** Drops a cursor that no longer points at a real stroke (after an undo, say). */
export function validCursor(p: Project, c: Cursor | null): Cursor | null {
  if (!c) return null;
  if (c.after !== null && strokeIndex(p, c.after) < 0) return null;
  return { after: c.after, carry: c.carry.filter((id) => p.markers.some((m) => m.id === id)) };
}

/**
 * The playback order with markers placed in it: each marker comes right after its anchor
 * stroke (or first, for null). Used to check sides and to draw.
 */
export function interleave(p: Project): ({ stroke: Stroke } | { marker: number })[] {
  const out: ({ stroke: Stroke } | { marker: number })[] = [];
  const byAnchor = (a: number | null) => p.markers.filter((m) => m.after === a).map((m) => ({ marker: m.id }));
  out.push(...byAnchor(null));
  for (const s of p.strokes) {
    out.push({ stroke: s }, ...byAnchor(s.id));
  }
  return out;
}
