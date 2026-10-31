// Pen input. Only the Apple Pencil draws (pointerType "pen"); a finger scrolls the page,
// which the canvas allows with `touch-action: pan-y` in the CSS.

import type { Point, Stroke } from "./project";

/** What the readout panel shows. These numbers are the whole point of the spike. */
export interface Stats {
  lastPointerType: string;
  pressure: number;
  strokeMin: number;
  strokeMax: number;
  /** Samples per pointermove event in the current/last stroke (more than 1 means coalescing works). */
  coalescedPerEvent: number;
  /** Samples per second over the current/last stroke. */
  sampleRate: number;
  strokes: number;
  points: number;
}

export interface CaptureHandlers {
  /** Pen went down in Select mode: the caller hit-tests instead of drawing. */
  onSelectTap(x: number, y: number): void;
  /** A new sample was added to the stroke in progress. */
  onSample(stroke: Stroke, newFrom: number): void;
  /** The stroke ended and was added to the list. */
  onStrokeEnd(): void;
  onStats(stats: Stats): void;
}

// Safari exposes Touch.touchType ("stylus" or "direct"); it isn't in TypeScript's DOM types.
type SafariTouch = Touch & { touchType?: "stylus" | "direct" };

export class Capture {
  mode: "write" | "select" = "write";
  private current: Stroke | null = null;
  private events = 0;
  private stats: Stats = {
    lastPointerType: "(none yet)",
    pressure: 0,
    strokeMin: 0,
    strokeMax: 0,
    coalescedPerEvent: 0,
    sampleRate: 0,
    strokes: 0,
    points: 0,
  };

  constructor(
    private canvas: HTMLCanvasElement,
    private strokes: Stroke[],
    /** Event time origin, so t in the saved file starts near 0. */
    private t0: number,
    private toLogical: (clientX: number, clientY: number) => [number, number],
    private on: CaptureHandlers,
  ) {
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", (e) => this.up(e));
    canvas.addEventListener("pointercancel", (e) => this.up(e));
    // With pan-y, iOS would also scroll when the Pencil moves. Cancelling the touch only for
    // stylus touches keeps finger scrolling while the Pencil writes in place.
    const stopStylus = (e: TouchEvent) => {
      if (Array.from(e.touches).some((t) => (t as SafariTouch).touchType === "stylus")) {
        e.preventDefault();
      }
    };
    canvas.addEventListener("touchstart", stopStylus, { passive: false });
    canvas.addEventListener("touchmove", stopStylus, { passive: false });
  }

  /** Recounts strokes and points; call after the caller edits the stroke list (undo, clear). */
  refreshCounts() {
    this.stats.strokes = this.strokes.length;
    this.stats.points = this.strokes.reduce((n, s) => n + s.points.length, 0);
    this.on.onStats({ ...this.stats });
  }

  private down(e: PointerEvent) {
    this.stats.lastPointerType = e.pointerType;
    if (e.pointerType !== "pen") {
      this.on.onStats({ ...this.stats });
      return; // fingers and mice never draw
    }
    e.preventDefault();
    const [x, y] = this.toLogical(e.clientX, e.clientY);
    if (this.mode === "select") {
      this.on.onSelectTap(x, y);
      return;
    }
    // Keeps the stroke going if the pen slides off the canvas. It throws if the browser no
    // longer considers the pointer active; drawing works without it, so ignore that.
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not fatal */
    }
    this.current = { points: [this.sample(e)] };
    this.events = 0;
    this.stats.strokeMin = this.stats.strokeMax = e.pressure;
    this.on.onSample(this.current, 0);
    this.updateStats(e.pressure);
  }

  private move(e: PointerEvent) {
    if (!this.current || e.pointerType !== "pen") return;
    // Safari batches pen samples between frames; getCoalescedEvents returns all of them,
    // which is where the extra smoothness (and the high sample rate) comes from.
    const batch = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const samples = batch.length > 0 ? batch : [e];
    const from = this.current.points.length;
    for (const s of samples) {
      this.current.points.push(this.sample(s));
      this.stats.strokeMin = Math.min(this.stats.strokeMin, s.pressure);
      this.stats.strokeMax = Math.max(this.stats.strokeMax, s.pressure);
    }
    this.events++;
    this.on.onSample(this.current, from);
    this.updateStats(samples[samples.length - 1].pressure);
  }

  private up(e: PointerEvent) {
    if (!this.current || e.pointerType !== "pen") return;
    this.strokes.push(this.current);
    this.current = null;
    this.on.onStrokeEnd();
    this.refreshCounts();
  }

  private sample(e: PointerEvent): Point {
    const [x, y] = this.toLogical(e.clientX, e.clientY);
    return [x, y, e.pressure, e.timeStamp - this.t0];
  }

  private updateStats(pressure: number) {
    const pts = this.current?.points ?? [];
    this.stats.pressure = pressure;
    this.stats.coalescedPerEvent = this.events > 0 ? (pts.length - 1) / this.events : 0;
    const span = pts.length > 1 ? pts[pts.length - 1][3] - pts[0][3] : 0;
    this.stats.sampleRate = span > 0 ? ((pts.length - 1) * 1000) / span : 0;
    this.on.onStats({ ...this.stats });
  }
}
