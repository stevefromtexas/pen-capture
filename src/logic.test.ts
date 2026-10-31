import { describe, expect, it } from "vitest";
import { History } from "./history";
import { hitTest, inRect } from "./hit";
import { allConflicts, anchorFor, conflicts, markerAt, place } from "./markers";
import { migrate, newProject, takeId, toJson, type Marker, type Project, type Stroke } from "./project";
import { addStroke, deleteStrokes, insertAfter, interleave, replace, validCursor } from "./sequence";

/** A small handwritten-ish stroke sitting on writing line y: 8 units tall, 20 wide. */
function stroke(p: Project, x: number, y: number): Stroke {
  return { id: takeId(p), points: [[x, y - 6, 0.3, 0], [x + 10, y + 2, 0.3, 5], [x + 20, y - 6, 0.3, 10]] };
}

function write(p: Project, h: History, ...strokes: Stroke[]) {
  for (const s of strokes) h.run(p, addStroke(p, s, null).command);
}

const ids = (p: Project) => p.strokes.map((s) => s.id);

describe("project format", () => {
  it("migrates v1 files: ids in order, no markers", () => {
    const p = migrate({ format: "letter-capture", version: 1, height: 640, strokes: [{ points: [[1, 2, 0.5, 3]] }, { points: [] }] });
    expect(ids(p)).toEqual([1, 2]);
    expect(p.markers).toEqual([]);
    expect(p.nextId).toBe(3);
  });

  it("round-trips v2 through JSON and keeps nextId ahead of every id", () => {
    const p = newProject();
    const s = stroke(p, 30, 70);
    p.strokes.push(s);
    p.markers.push({ id: takeId(p), kind: "page", after: s.id, y: 90 });
    const back = migrate(JSON.parse(toJson(p)));
    expect(back.strokes).toEqual(p.strokes);
    expect(back.markers).toEqual(p.markers);
    expect(back.nextId).toBe(p.nextId);
    expect(migrate({ ...JSON.parse(toJson(p)), nextId: 1 }).nextId).toBe(3);
  });

  it("rejects files that aren't captures", () => {
    expect(() => migrate({ hello: 1 })).toThrow(/Not a letter-capture/);
    expect(() => migrate({ format: "letter-capture", version: 9, strokes: [] })).toThrow(/version 9/);
  });
});

describe("history", () => {
  it("undoes and redoes any number of steps, and new work clears redo", () => {
    const p = newProject();
    const h = new History();
    write(p, h, stroke(p, 30, 70), stroke(p, 60, 70), stroke(p, 90, 70));
    h.undo(p);
    h.undo(p);
    expect(ids(p)).toEqual([1]);
    h.redo(p);
    expect(ids(p)).toEqual([1, 2]);
    write(p, h, stroke(p, 120, 70));
    expect(h.undone).toEqual([]);
    expect(h.redo(p)).toBeUndefined();
  });

  it("survives a save and reload", () => {
    const p = newProject();
    const h = new History();
    write(p, h, stroke(p, 30, 70), stroke(p, 60, 70));
    const saved = JSON.parse(JSON.stringify({ project: p, history: h }));
    const p2 = migrate(saved.project);
    const h2 = History.from(saved.history);
    h2.undo(p2);
    expect(ids(p2)).toEqual([1]);
  });
});

describe("sequence edits", () => {
  function letter() {
    // Two paragraphs: strokes 1, 2 | paragraph marker | strokes 4, 5.
    const p = newProject();
    const h = new History();
    write(p, h, stroke(p, 30, 70), stroke(p, 60, 70));
    const m: Marker = { id: takeId(p), kind: "paragraph", after: 2, y: 85 };
    h.run(p, { type: "addMarker", marker: m });
    write(p, h, stroke(p, 30, 102), stroke(p, 60, 102));
    return { p, h };
  }

  it("delete re-anchors markers to the nearest surviving stroke before, and undo restores", () => {
    const { p, h } = letter();
    h.run(p, deleteStrokes(p, new Set([2])).command);
    expect(ids(p)).toEqual([1, 4, 5]);
    expect(p.markers[0].after).toBe(1);
    h.undo(p);
    expect(ids(p)).toEqual([1, 2, 4, 5]);
    expect(p.markers[0].after).toBe(2);
  });

  it("replace puts new strokes exactly where the old ones were, before the marker", () => {
    const { p, h } = letter();
    const r = replace(p, new Set([2]));
    h.run(p, r.command);
    let cursor = r.cursor;
    for (const x of [60, 80]) {
      const add = addStroke(p, stroke(p, x, 70), cursor);
      h.run(p, add.command);
      cursor = add.cursor!;
    }
    expect(ids(p)).toEqual([1, 6, 7, 4, 5]);
    // The paragraph marker still separates the first paragraph from the second.
    expect(interleave(p).map((e) => ("stroke" in e ? e.stroke.id : `m${e.marker}`))).toEqual([1, 6, 7, "m3", 4, 5]);
  });

  it("replacing the first stroke of a paragraph keeps it after the marker", () => {
    const { p, h } = letter();
    const r = replace(p, new Set([4]));
    h.run(p, r.command);
    const add = addStroke(p, stroke(p, 30, 102), r.cursor);
    h.run(p, add.command);
    expect(interleave(p).map((e) => ("stroke" in e ? e.stroke.id : `m${e.marker}`))).toEqual([1, 2, "m3", 6, 5]);
  });

  it("insert after back-fills into the same paragraph (an i-dot), before its marker", () => {
    const { p, h } = letter();
    const add = addStroke(p, stroke(p, 65, 60), insertAfter(p, 2));
    h.run(p, add.command);
    expect(interleave(p).map((e) => ("stroke" in e ? e.stroke.id : `m${e.marker}`))).toEqual([1, 2, 6, "m3", 4, 5]);
    h.undo(p);
    expect(p.markers[0].after).toBe(2);
  });

  it("drops a cursor whose stroke disappeared", () => {
    const { p } = letter();
    expect(validCursor(p, { after: 99, carry: [] })).toBeNull();
    expect(validCursor(p, { after: 1, carry: [3, 42] })).toEqual({ after: 1, carry: [3] });
  });
});

describe("markers", () => {
  function twoLines() {
    const p = newProject();
    p.strokes.push(stroke(p, 30, 70), stroke(p, 60, 70), stroke(p, 30, 102));
    return p;
  }

  it("anchors after the last stroke above the line", () => {
    const p = twoLines();
    expect(anchorFor(p.strokes, 85)).toBe(2);
    expect(anchorFor(p.strokes, 40)).toBeNull();
  });

  it("snaps a line dropped through ink to the nearest clean gap", () => {
    const p = twoLines();
    const placed = place(p.strokes, 70, 32);
    expect(placed.conflicts).toEqual([]);
    expect(placed.y).toBe(71); // just below the ink (which may touch the line by 1 unit)
    expect(placed.after).toBe(2);
    expect(conflicts(p.strokes, placed.after, placed.y)).toEqual([]);
  });

  it("flags strokes on the wrong side (a late i-dot above the line)", () => {
    const p = twoLines();
    p.strokes.push({ id: takeId(p), points: [[40, 60, 0.3, 0]] }); // dot written last, up on line 1
    expect(conflicts(p.strokes, 2, 85)).toEqual([4]);
    p.markers.push({ id: takeId(p), kind: "paragraph", after: 2, y: 85 });
    expect([...allConflicts(p)]).toEqual([4]);
  });

  it("finds a marker near a tap", () => {
    const p = twoLines();
    p.markers.push({ id: 9, kind: "page", after: 2, y: 85 });
    expect(markerAt(p, 88, 8)).toBe(9);
    expect(markerAt(p, 120, 8)).toBeNull();
  });
});

describe("hit testing", () => {
  it("taps the nearest stroke and boxes several", () => {
    const p = newProject();
    p.strokes.push(stroke(p, 30, 70), stroke(p, 30, 102));
    expect(hitTest(p.strokes, 40, 72, 12)).toBe(1);
    expect(hitTest(p.strokes, 200, 300, 12)).toBeNull();
    expect(inRect(p.strokes, 0, 60, 100, 110)).toEqual([1, 2]);
    expect(inRect(p.strokes, 100, 110, 0, 90)).toEqual([2]);
  });
});
