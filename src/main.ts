// Letter capture editor. Write with the Apple Pencil, fix anything before exporting:
// select / delete / replace / insert, paragraph and page markers, unlimited undo, and a
// Preview through the game's own playback. See README.md for the workflow.

import { Pen, type Stats } from "./capture";
import { History, type Command } from "./history";
import { hitTest, inRect } from "./hit";
import { allConflicts, markerAt, place } from "./markers";
import { openPreview, strokeFromPreview } from "./preview";
import { bounds, LINES_PER_SCREEN, newProject, SHEET, strokeIndex, takeId, toJson, type Point, type Project, type Stroke } from "./project";
import { addStroke, deleteStrokes, insertAfter, replace, validCursor } from "./sequence";
import { emptyOverlay, Sheet } from "./sheet";
import * as storage from "./storage";

type Mode = "write" | "select" | "markers";

/** How close (logical units) a tap must be to a stroke or marker to pick it. */
const PICK_RADIUS = 10;
/** A pen movement shorter than this (logical units) is a tap, not a drag. */
const DRAG_THRESHOLD = 5;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

let project: Project = newProject(40 * SHEET.rule, navigator.userAgent, new Date().toISOString());
let history = new History();
let mode: Mode = "write";
const overlay = emptyOverlay();
let saveOk = true;
/** The letter being edited (see storage.ts: several letters live side by side). */
let letterId = "";

const sheet = new Sheet($<HTMLCanvasElement>("#sheet"), project.height);

// --- redraw, save, toolbar -------------------------------------------------------------

function fit() {
  sheet.height = project.height;
  sheet.resize($("#paper").clientWidth - 16); // minus main's horizontal padding
  sheet.redraw(project, overlay);
}

function refresh() {
  overlay.conflicts = allConflicts(project);
  if (sheet.height !== project.height) fit();
  else sheet.redraw(project, overlay);
  updateToolbar();
}

/** After any change to the project: tidy UI state, redraw, autosave. */
function changed() {
  overlay.cursor = validCursor(project, overlay.cursor);
  overlay.selected = new Set([...overlay.selected].filter((id) => strokeIndex(project, id) >= 0));
  if (overlay.markerSelected !== null && !project.markers.some((m) => m.id === overlay.markerSelected)) {
    overlay.markerSelected = null;
  }
  refresh();
  storage.saveSoon(
    letterId,
    () => ({ project, history: { done: history.done, undone: history.undone } }),
    (ok) => {
      saveOk = ok;
      updateToolbar();
    },
  );
}

function run(c: Command) {
  history.run(project, c);
  changed();
}

function setMode(m: Mode) {
  mode = m;
  overlay.rect = null;
  overlay.ghostY = null;
  if (m !== "select") overlay.selected.clear();
  if (m !== "markers") overlay.markerSelected = null;
  refresh();
}

function updateToolbar() {
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  const show = (id: string, on: boolean) => ($(id).hidden = !on);
  const enable = (id: string, on: boolean) => ($<HTMLButtonElement>(id).disabled = !on);
  const sel = overlay.selected.size;
  enable("#undo", history.done.length > 0);
  enable("#redo", history.undone.length > 0);
  show("#delete", (mode === "select" && sel > 0) || (mode === "markers" && overlay.markerSelected !== null));
  show("#replace", mode === "select" && sel > 0);
  show("#insert-after", mode === "select" && sel > 0);
  show("#stop-inserting", overlay.cursor !== null);
  const marker = project.markers.find((m) => m.id === overlay.markerSelected);
  show("#marker-kind", mode === "markers" && marker !== undefined);
  $("#marker-kind").textContent = marker?.kind === "page" ? "Make paragraph" : "Make page break";

  const conflicts = overlay.conflicts.size;
  const hints: Record<Mode, string> = {
    write: "Write with the Pencil. A finger scrolls.",
    select: "Tap strokes to select (tap again to unselect), or drag a box.",
    markers: "Drag from the left margin to add a marker. Tap one to select it, drag it to move it.",
  };
  let status = hints[mode];
  if (overlay.cursor) {
    const after = overlay.cursor.after;
    status = `Inserting ${after === null ? "at the very start" : `after stroke ${after}`}. New strokes go there.`;
  }
  if (conflicts) status += ` ${conflicts} stroke${conflicts > 1 ? "s" : ""} on the wrong side of a marker (amber).`;
  $("#status").textContent = status;
  $("#saved").textContent = saveOk ? "Autosaved" : "NOT SAVED: use Backup";
  $("#saved").classList.toggle("bad", !saveOk);
}

// --- the pen -------------------------------------------------------------------------

let current: Stroke | null = null;
type Gesture =
  | { kind: "select"; start: Point; moved: boolean }
  | { kind: "new-marker" }
  | { kind: "move-marker"; id: number; startY: number; moved: boolean }
  | { kind: "none" };
let gesture: Gesture = { kind: "none" };

function penDown(p: Point) {
  const [x, y] = p;
  if (mode === "write") {
    current = { id: takeId(project), points: [p] };
    sheet.drawTail(current.points, 0);
  } else if (mode === "select") {
    gesture = { kind: "select", start: p, moved: false };
  } else if (x < SHEET.gutter) {
    gesture = { kind: "new-marker" };
    overlay.ghostY = y;
    refresh();
  } else {
    const id = markerAt(project, y, PICK_RADIUS);
    gesture = id === null ? { kind: "none" } : { kind: "move-marker", id, startY: y, moved: false };
  }
}

function penMove(samples: Point[]) {
  const [x, y] = samples[samples.length - 1];
  if (mode === "write" && current) {
    const from = current.points.length;
    current.points.push(...samples);
    sheet.drawTail(current.points, from);
  } else if (gesture.kind === "select") {
    const [sx, sy] = gesture.start;
    if (Math.hypot(x - sx, y - sy) > DRAG_THRESHOLD) gesture.moved = true;
    if (gesture.moved) {
      overlay.rect = [sx, sy, x, y];
      refresh();
    }
  } else if (gesture.kind === "new-marker" || gesture.kind === "move-marker") {
    if (gesture.kind === "move-marker" && Math.abs(y - gesture.startY) > DRAG_THRESHOLD) gesture.moved = true;
    overlay.ghostY = y;
    refresh();
  }
}

function penUp() {
  if (mode === "write" && current) {
    const stroke = current;
    current = null;
    const added = addStroke(project, stroke, overlay.cursor);
    overlay.cursor = added.cursor;
    run(added.command);
    // Keep a couple of screens of empty paper below the writing.
    const [, , , y1] = bounds(stroke);
    if (y1 > project.height - 4 * SHEET.rule) {
      run({ type: "setHeight", before: project.height, after: project.height + LINES_PER_SCREEN * SHEET.rule });
    }
    return;
  }
  const g = gesture;
  gesture = { kind: "none" };
  if (g.kind === "select") {
    if (g.moved && overlay.rect) {
      const [x0, y0, x1, y1] = overlay.rect;
      overlay.selected = new Set(inRect(project.strokes, x0, y0, x1, y1));
    } else {
      const [x, y] = g.start;
      const id = hitTest(project.strokes, x, y, PICK_RADIUS);
      if (id === null) overlay.selected.clear();
      else if (overlay.selected.has(id)) overlay.selected.delete(id);
      else overlay.selected.add(id);
    }
    overlay.rect = null;
    refresh();
  } else if (g.kind === "new-marker" && overlay.ghostY !== null) {
    const placed = place(project.strokes, overlay.ghostY, SHEET.rule);
    const marker = { id: takeId(project), kind: "paragraph" as const, after: placed.after, y: placed.y };
    overlay.ghostY = null;
    overlay.markerSelected = marker.id;
    run({ type: "addMarker", marker });
  } else if (g.kind === "move-marker") {
    const before = project.markers.find((m) => m.id === g.id);
    if (before && g.moved && overlay.ghostY !== null) {
      const placed = place(project.strokes, overlay.ghostY, SHEET.rule);
      overlay.ghostY = null;
      run({ type: "changeMarker", before: { ...before }, after: { ...before, after: placed.after, y: placed.y } });
    } else {
      overlay.ghostY = null;
      overlay.markerSelected = overlay.markerSelected === g.id ? null : g.id;
      refresh();
    }
  } else {
    overlay.markerSelected = null;
    refresh();
  }
}

new Pen(sheet.canvas, performance.now(), (cx, cy) => sheet.toLogical(cx, cy), {
  down: penDown,
  move: penMove,
  up: penUp,
  stats: showStats,
});

// --- toolbar -------------------------------------------------------------------------

const on = (sel: string, fn: () => void) => $(sel).addEventListener("click", fn);

document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode as Mode)));

on("#undo", () => {
  history.undo(project);
  changed();
});
on("#redo", () => {
  history.redo(project);
  changed();
});
on("#delete", () => {
  if (mode === "markers" && overlay.markerSelected !== null) {
    const index = project.markers.findIndex((m) => m.id === overlay.markerSelected);
    if (index >= 0) run({ type: "deleteMarker", marker: { ...project.markers[index] }, index });
  } else if (overlay.selected.size) {
    run(deleteStrokes(project, new Set(overlay.selected)).command);
  }
});
on("#replace", () => {
  const r = replace(project, new Set(overlay.selected));
  overlay.selected.clear();
  mode = "write";
  overlay.cursor = r.cursor;
  run(r.command);
});
on("#insert-after", () => {
  // After the last selected stroke in playback order.
  const last = project.strokes.filter((s) => overlay.selected.has(s.id)).pop();
  if (!last) return;
  overlay.cursor = insertAfter(project, last.id);
  setMode("write");
});
on("#stop-inserting", () => {
  overlay.cursor = null;
  refresh();
});
on("#marker-kind", () => {
  const m = project.markers.find((x) => x.id === overlay.markerSelected);
  if (m) run({ type: "changeMarker", before: { ...m }, after: { ...m, kind: m.kind === "page" ? "paragraph" : "page" } });
});
on("#add-lines", () => run({ type: "setHeight", before: project.height, after: project.height + LINES_PER_SCREEN * SHEET.rule }));
on("#preview", () => openPreview(letterId, state()));
on("#backup", async () => {
  const ok = await storage.saveFile(storage.backupName(letterName()), storage.stateJson(state()));
  if (!ok) alert("Backup failed. Try again, or use Export.");
});
on("#export", async () => {
  const ok = await storage.saveFile(storage.exportName(letterName()), toJson(project));
  if (!ok) alert("Export failed.");
});
on("#import", async () => {
  const text = await storage.pickFile();
  if (text === null) return;
  try {
    const saved = storage.parseState(text);
    if (project.strokes.length && !confirm(`Replace everything in "${letterName()}" with this file? (Make a New letter first to keep both.)`)) return;
    show(saved);
    changed();
  } catch (err) {
    alert(`Couldn't import: ${(err as Error).message}`);
  }
});

// --- letters ---------------------------------------------------------------------------

const state = (): storage.Saved => ({ project, history: { done: history.done, undone: history.undone } });
const letterName = () => storage.listLetters().find((l) => l.id === letterId)?.name ?? "letter";
const blank = () => newProject(40 * SHEET.rule, navigator.userAgent, new Date().toISOString());

/** Puts a saved letter (or a blank sheet) on screen, with fresh UI state. */
function show(saved: storage.Saved | null) {
  project = saved?.project ?? blank();
  history = History.from(saved?.history);
  overlay.cursor = null;
  overlay.selected.clear();
  overlay.markerSelected = null;
  current = null;
  mode = "write"; // a different letter: ready to write
  fit();
  refresh();
  window.scrollTo({ top: 0 });
}

function updateLetters() {
  const select = $<HTMLSelectElement>("#letter");
  select.replaceChildren(
    ...storage.listLetters().map((l) => new Option(l.name, l.id, false, l.id === letterId)),
  );
}

/** Saves the current letter now, then switches to another (or a new one). */
async function switchLetter(to: () => Promise<{ id: string; saved: storage.Saved | null }>) {
  storage.cancelPending();
  try {
    await storage.saveNow(letterId, state());
  } catch {
    if (!confirm("Couldn't save this letter. Switch anyway and lose recent changes?")) return;
  }
  const next = await to();
  letterId = next.id;
  await storage.setActive(letterId);
  show(next.saved);
  updateLetters();
}

$<HTMLSelectElement>("#letter").addEventListener("change", (e) => {
  const id = (e.target as HTMLSelectElement).value;
  switchLetter(async () => ({ id, saved: await storage.loadLetter(id) }));
});
on("#new-letter", () => {
  const name = prompt("Name for the new letter:", `Letter ${storage.listLetters().length + 1}`);
  if (!name) return;
  switchLetter(async () => ({ id: (await storage.createLetter(name.trim() || "Letter")).id, saved: null }));
});
on("#rename-letter", async () => {
  const name = prompt("Rename this letter:", letterName());
  if (!name?.trim()) return;
  await storage.renameLetter(letterId, name.trim());
  updateLetters();
});
on("#delete-letter", async () => {
  if (!confirm(`Delete "${letterName()}" for good? This can't be undone. (Backup first to keep a copy.)`)) return;
  storage.cancelPending();
  const doomed = letterId;
  await storage.deleteLetter(doomed);
  const rest = storage.listLetters();
  const next = rest.length ? rest[0] : await storage.createLetter("Letter 1");
  letterId = next.id;
  await storage.setActive(letterId);
  show(await storage.loadLetter(letterId));
  updateLetters();
});
on("#clear-sheet", () => {
  if (!project.strokes.length && !project.markers.length) return;
  if (!confirm(`Clear everything in "${letterName()}"? (Undo brings it back.)`)) return;
  const commands: Command[] = [];
  project.markers.forEach((marker) => commands.push({ type: "deleteMarker", marker: { ...marker }, index: 0 }));
  commands.push(deleteStrokes(project, new Set(project.strokes.map((s) => s.id))).command);
  overlay.cursor = null;
  run({ type: "batch", commands });
});

function scrollToStroke(id: number) {
  const s = project.strokes[strokeIndex(project, id)];
  if (!s) return;
  const [, y0] = bounds(s);
  const top = sheet.canvas.getBoundingClientRect().top + window.scrollY + y0 * sheet.scale;
  window.scrollTo({ top: top - window.innerHeight / 3, behavior: "smooth" });
}

// --- pen stats (the spike's checks, for troubleshooting) -------------------------------

function showStats(s: Stats) {
  const row = (label: string, value: string, ok?: boolean) =>
    `<div><dt>${label}</dt><dd class="${ok === undefined ? "" : ok ? "pass" : "fail"}">${value}</dd></div>`;
  const has = s.sampleRate > 0;
  $("#readout").innerHTML = [
    row("pointerType", s.lastPointerType, s.lastPointerType === "(none yet)" ? undefined : s.lastPointerType === "pen"),
    row("pressure", s.pressure.toFixed(3)),
    row("stroke min–max", `${s.strokeMin.toFixed(2)}–${s.strokeMax.toFixed(2)}`),
    row("samples / event", s.coalescedPerEvent.toFixed(1), has ? s.coalescedPerEvent > 1 : undefined),
    row("samples / s", s.sampleRate.toFixed(0), has ? s.sampleRate >= 120 : undefined),
    row("strokes / markers", `${project.strokes.length} / ${project.markers.length}`),
  ].join("");
}

// --- start ---------------------------------------------------------------------------

window.addEventListener("resize", fit);
storage.openLetters().then(({ active, saved }) => {
  letterId = active;
  show(saved);
  updateLetters();
  // Back from the Preview: select the stroke it was drawing, so it's easy to fix.
  const fromPreview = strokeFromPreview();
  if (fromPreview !== null && strokeIndex(project, fromPreview) >= 0) {
    setMode("select");
    overlay.selected = new Set([fromPreview]);
    refresh();
    scrollToStroke(fromPreview);
  }
});

// Read-only hook for automated browser checks (and poking around in Safari's inspector).
(window as unknown as { letterCapture: object }).letterCapture = {
  project: () => project,
  history: () => history,
  mode: () => mode,
  overlay: () => overlay,
};
