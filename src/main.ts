// Letter capture, spike version. Answers three questions on the iPad before the real
// letter is written (see README): is the Pencil reported as "pen", does pressure vary, and
// is the sample rate high enough. It also checks finger scrolling and stroke selection.

import { Capture, type Stats } from "./capture";
import { newProject, SHEET, toJson } from "./project";
import { hitTest, Sheet } from "./sheet";

const LINES_PER_SCREEN = 20;
const START_LINES = 40;
/** How close (logical units) a Select tap must be to a stroke to pick it. */
const SELECT_RADIUS = 12;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const project = newProject(START_LINES * SHEET.rule);
const sheet = new Sheet($<HTMLCanvasElement>("#sheet"), project.height);
let selected: number | null = null;

const fit = () => {
  sheet.resize($("#paper").clientWidth - 16); // minus main's horizontal padding
  sheet.redraw(project.strokes, selected);
};

const capture = new Capture(
  sheet.canvas,
  project.strokes,
  performance.now(),
  (cx, cy) => sheet.toLogical(cx, cy),
  {
    onSelectTap(x, y) {
      selected = hitTest(project.strokes, x, y, SELECT_RADIUS);
      sheet.redraw(project.strokes, selected);
      capture.refreshCounts(); // refreshes the readout's "selected" row
    },
    onSample(stroke, from) {
      sheet.drawTail(stroke.points, from);
    },
    onStrokeEnd() {
      // A full redraw also paints single-point strokes (dots) as circles.
      sheet.redraw(project.strokes, selected);
    },
    onStats: showStats,
  },
);

// --- readout --------------------------------------------------------------

function showStats(s: Stats) {
  const row = (label: string, value: string, ok?: boolean) =>
    `<div><dt>${label}</dt><dd class="${ok === undefined ? "" : ok ? "pass" : "fail"}">${value}</dd></div>`;
  const hasStroke = s.strokes > 0 || s.sampleRate > 0;
  $("#readout").innerHTML = [
    row("pointerType", s.lastPointerType, s.lastPointerType === "(none yet)" ? undefined : s.lastPointerType === "pen"),
    row("pressure", s.pressure.toFixed(3)),
    row("stroke min–max", `${s.strokeMin.toFixed(2)}–${s.strokeMax.toFixed(2)}`, hasStroke ? s.strokeMax - s.strokeMin > 0.2 : undefined),
    row("samples / event", s.coalescedPerEvent.toFixed(1), hasStroke ? s.coalescedPerEvent > 1 : undefined),
    row("samples / s", s.sampleRate.toFixed(0), hasStroke ? s.sampleRate >= 120 : undefined),
    row("strokes / points", `${s.strokes} / ${s.points}`),
    row("selected", selected === null ? "none" : `#${selected + 1}`),
  ].join("");
}

// --- toolbar --------------------------------------------------------------

document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    capture.mode = btn.dataset.mode as "write" | "select";
    document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("active", b === btn));
    if (capture.mode === "write") selected = null;
    sheet.redraw(project.strokes, selected);
    capture.refreshCounts();
  });
});

$("#undo").addEventListener("click", () => {
  project.strokes.pop();
  selected = null;
  sheet.redraw(project.strokes, selected);
  capture.refreshCounts();
});

$("#clear").addEventListener("click", () => {
  if (project.strokes.length > 0 && !confirm("Clear every stroke?")) return;
  project.strokes.length = 0; // same array the Capture holds
  selected = null;
  sheet.redraw(project.strokes, selected);
  capture.refreshCounts();
});

$("#add-lines").addEventListener("click", () => {
  project.height += LINES_PER_SCREEN * SHEET.rule;
  sheet.height = project.height;
  fit();
});

// --- export ---------------------------------------------------------------
// Three ways out, because iPad Safari is picky: the share sheet (AirDrop / Files) needs
// HTTPS and a user tap; the download link is the fallback; Copy JSON is the last resort.

const fileName = () => `letter-capture-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;

$("#share").addEventListener("click", async () => {
  const file = new File([toJson(project)], fileName(), { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch (err) {
      if ((err as DOMException).name !== "AbortError") alert(`Share failed: ${err}`);
    }
  } else {
    alert("This browser can't share files. Use Download or Copy JSON.");
  }
});

// The link's href is refreshed just before the tap follows it.
const download = $<HTMLAnchorElement>("#download");
download.addEventListener("click", () => {
  if (download.href) URL.revokeObjectURL(download.href);
  download.href = URL.createObjectURL(new Blob([toJson(project)], { type: "application/json" }));
  download.download = fileName();
});

$("#copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(toJson(project));
    alert("Copied.");
  } catch (err) {
    alert(`Copy failed: ${err}`);
  }
});

// --- start ----------------------------------------------------------------

window.addEventListener("resize", fit);
fit();
capture.refreshCounts();
