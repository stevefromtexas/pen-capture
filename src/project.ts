// The capture project: what gets saved, and what the converter and the Rust preview read.
// Version 2 adds stable stroke ids and markers. Version 1 files are migrated on load.

/** Paper layout, in logical units (the game's layout is 360 wide). Playback draws the same rules. */
export const SHEET = {
  width: 360,
  /** Distance between ruled lines. 20 lines per 640-tall phone screen. */
  rule: 32,
  /** Left and right margins; write between them so nothing clips on a phone. */
  gutter: 24,
  /** Blank ruled lines at the top before the first writing line. */
  topBlankLines: 1,
} as const;

export const LINES_PER_SCREEN = 20;

/** One sample: x, y in logical units, pressure 0..1, t in ms since the page loaded. */
export type Point = [x: number, y: number, pressure: number, t: number];

export interface Stroke {
  /** Stable id: markers and the preview refer to strokes by id, never by position. */
  id: number;
  points: Point[];
}

export type MarkerKind = "paragraph" | "page";

/**
 * A line between paragraphs or pages. Its meaning comes from `after` (its place in the
 * stroke sequence), so a descender crossing the drawn line can't put a stroke on the wrong
 * side of it. `y` is only where the line is drawn.
 */
export interface Marker {
  id: number;
  kind: MarkerKind;
  /** The stroke this marker comes after; null = before the first stroke. */
  after: number | null;
  y: number;
}

export interface Project {
  format: "letter-capture";
  version: 2;
  sheet: typeof SHEET;
  /** Logical height of the sheet (grows with "Add lines"). */
  height: number;
  /** Browser user agent, so we know which device produced the samples. */
  device: string;
  created: string;
  /** Next free id for strokes and markers (they share one counter). */
  nextId: number;
  strokes: Stroke[];
  markers: Marker[];
}

export function newProject(height = 40 * SHEET.rule, device = "", created = ""): Project {
  return {
    format: "letter-capture",
    version: 2,
    sheet: SHEET,
    height,
    device,
    created,
    nextId: 1,
    strokes: [],
    markers: [],
  };
}

export function takeId(p: Project): number {
  return p.nextId++;
}

/**
 * Reads a saved project (v1 or v2). Throws an Error with a readable message if the file
 * isn't a capture project.
 */
export function migrate(raw: unknown): Project {
  const o = raw as Omit<Partial<Project>, "version"> & { version?: unknown; strokes?: unknown };
  if (!o || typeof o !== "object" || o.format !== "letter-capture" || !Array.isArray(o.strokes)) {
    throw new Error("Not a letter-capture file.");
  }
  if (o.version !== 1 && o.version !== 2) {
    throw new Error(`Unknown letter-capture version ${String(o.version)}.`);
  }
  const p = newProject(Number(o.height) || 40 * SHEET.rule, String(o.device ?? ""), String(o.created ?? ""));
  if (o.version === 1) {
    for (const s of o.strokes as { points: Point[] }[]) {
      p.strokes.push({ id: takeId(p), points: s.points });
    }
    return p;
  }
  p.strokes = (o.strokes as Stroke[]).map((s) => ({ id: s.id, points: s.points }));
  p.markers = (o.markers ?? []).map((m) => ({ ...m }));
  const maxId = Math.max(0, ...p.strokes.map((s) => s.id), ...p.markers.map((m) => m.id));
  p.nextId = Math.max(Number(o.nextId) || 0, maxId + 1);
  return p;
}

/** Rounds coordinates to 0.01 and times to 0.1 ms, which keeps the file small without losing detail. */
export function toJson(project: Project): string {
  const r = (v: number, places: number) => Math.round(v * places) / places;
  const strokes = project.strokes.map((s) => ({
    id: s.id,
    points: s.points.map(([x, y, p, t]) => [r(x, 100), r(y, 100), r(p, 1000), r(t, 10)]),
  }));
  const markers = project.markers.map((m) => ({ ...m, y: r(m.y, 100) }));
  return JSON.stringify({ ...project, strokes, markers });
}

/** Bounding box of a stroke: [minX, minY, maxX, maxY]. */
export function bounds(s: Stroke): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of s.points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

export function strokeIndex(p: Project, id: number): number {
  return p.strokes.findIndex((s) => s.id === id);
}
