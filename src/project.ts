// The capture project: what gets saved and later fed to the converter in the game repo.
// Keep this shape stable; the full editor adds markers and edit history on top of it.

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

/** One sample: x, y in logical units, pressure 0..1, t in ms since the project started. */
export type Point = [x: number, y: number, pressure: number, t: number];

export interface Stroke {
  points: Point[];
}

export interface Project {
  format: "letter-capture";
  version: 1;
  sheet: typeof SHEET;
  /** Logical height of the sheet (grows with "Add lines"). */
  height: number;
  /** Browser user agent, so we know which device produced the samples. */
  device: string;
  created: string;
  strokes: Stroke[];
}

export function newProject(height: number): Project {
  return {
    format: "letter-capture",
    version: 1,
    sheet: SHEET,
    height,
    device: navigator.userAgent,
    created: new Date().toISOString(),
    strokes: [],
  };
}

/** Rounds coordinates to 0.01 and times to 0.1 ms, which keeps the file small without losing detail. */
export function toJson(project: Project): string {
  const r = (v: number, places: number) => Math.round(v * places) / places;
  const strokes = project.strokes.map((s) => ({
    points: s.points.map(([x, y, p, t]) => [r(x, 100), r(y, 100), r(p, 1000), r(t, 10)]),
  }));
  return JSON.stringify({ ...project, strokes });
}
