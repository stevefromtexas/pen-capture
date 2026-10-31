// Undo and redo. Every change to the project is a Command: plain data (so the history can
// be saved and survive a reload) that knows how to apply and revert itself.

import type { Marker, Project, Stroke } from "./project";

export type Command =
  /** Put `stroke` at position `index` in the stroke sequence. */
  | { type: "insertStroke"; stroke: Stroke; index: number }
  /** Remove the stroke at `index` (kept here so undo can put it back). */
  | { type: "deleteStroke"; stroke: Stroke; index: number }
  | { type: "addMarker"; marker: Marker }
  | { type: "deleteMarker"; marker: Marker; index: number }
  /** Any marker change: move, re-anchor, or kind toggle. */
  | { type: "changeMarker"; before: Marker; after: Marker }
  /** Several commands that undo together, in order. */
  | { type: "batch"; commands: Command[] }
  | { type: "setHeight"; before: number; after: number };

export function apply(p: Project, c: Command): void {
  switch (c.type) {
    case "insertStroke":
      p.strokes.splice(c.index, 0, c.stroke);
      break;
    case "deleteStroke":
      p.strokes.splice(c.index, 1);
      break;
    case "addMarker":
      p.markers.push({ ...c.marker });
      break;
    case "deleteMarker":
      p.markers.splice(c.index, 1);
      break;
    case "changeMarker": {
      const i = p.markers.findIndex((m) => m.id === c.after.id);
      if (i >= 0) p.markers[i] = { ...c.after };
      break;
    }
    case "batch":
      c.commands.forEach((sub) => apply(p, sub));
      break;
    case "setHeight":
      p.height = c.after;
      break;
  }
}

export function revert(p: Project, c: Command): void {
  switch (c.type) {
    case "insertStroke":
      p.strokes.splice(c.index, 1);
      break;
    case "deleteStroke":
      p.strokes.splice(c.index, 0, c.stroke);
      break;
    case "addMarker":
      p.markers = p.markers.filter((m) => m.id !== c.marker.id);
      break;
    case "deleteMarker":
      p.markers.splice(c.index, 0, { ...c.marker });
      break;
    case "changeMarker": {
      const i = p.markers.findIndex((m) => m.id === c.before.id);
      if (i >= 0) p.markers[i] = { ...c.before };
      break;
    }
    case "batch":
      [...c.commands].reverse().forEach((sub) => revert(p, sub));
      break;
    case "setHeight":
      p.height = c.before;
      break;
  }
}

/** Unlimited undo and redo. Doing something new clears the redo list. */
export class History {
  done: Command[] = [];
  undone: Command[] = [];

  run(p: Project, c: Command): void {
    apply(p, c);
    this.done.push(c);
    this.undone = [];
  }

  undo(p: Project): Command | undefined {
    const c = this.done.pop();
    if (c) {
      revert(p, c);
      this.undone.push(c);
    }
    return c;
  }

  redo(p: Project): Command | undefined {
    const c = this.undone.pop();
    if (c) {
      apply(p, c);
      this.done.push(c);
    }
    return c;
  }

  clear(): void {
    this.done = [];
    this.undone = [];
  }

  static from(saved: { done?: Command[]; undone?: Command[] } | undefined): History {
    const h = new History();
    h.done = saved?.done ?? [];
    h.undone = saved?.undone ?? [];
    return h;
  }
}
