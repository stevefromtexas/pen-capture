// Pen input. Only the Apple Pencil acts on the sheet (pointerType "pen"); a finger scrolls
// the page, which the canvas allows with `touch-action: pan-y` in the CSS. What the pen
// *does* depends on the mode; this file only turns pointer events into clean samples.

import type { Point } from "./project";

/** What the stats panel shows (the spike's checks, kept for troubleshooting). */
export interface Stats {
  lastPointerType: string;
  pressure: number;
  strokeMin: number;
  strokeMax: number;
  /** Samples per pointermove event in the current/last stroke (more than 1 means coalescing works). */
  coalescedPerEvent: number;
  /** Samples per second over the current/last stroke. */
  sampleRate: number;
}

export interface PenHandlers {
  down(p: Point): void;
  /** New samples since the last call, oldest first. */
  move(samples: Point[]): void;
  up(): void;
  stats(s: Stats): void;
}

// Safari exposes Touch.touchType ("stylus" or "direct"); it isn't in TypeScript's DOM types.
type SafariTouch = Touch & { touchType?: "stylus" | "direct" };

export class Pen {
  private active = false;
  private lastT = -Infinity;
  private first: Point | null = null;
  private count = 0;
  private events = 0;
  private stats: Stats = {
    lastPointerType: "(none yet)",
    pressure: 0,
    strokeMin: 0,
    strokeMax: 0,
    coalescedPerEvent: 0,
    sampleRate: 0,
  };

  constructor(
    private canvas: HTMLCanvasElement,
    /** Event time origin, so t in the saved file starts near 0. */
    private t0: number,
    private toLogical: (clientX: number, clientY: number) => [number, number],
    private on: PenHandlers,
  ) {
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", (e) => this.up(e));
    canvas.addEventListener("pointercancel", (e) => this.up(e));
    // With pan-y, iOS would also scroll when the Pencil moves. Cancelling the touch only for
    // stylus touches keeps finger scrolling while the Pencil works in place.
    const stopStylus = (e: TouchEvent) => {
      if (Array.from(e.touches).some((t) => (t as SafariTouch).touchType === "stylus")) {
        e.preventDefault();
      }
    };
    canvas.addEventListener("touchstart", stopStylus, { passive: false });
    canvas.addEventListener("touchmove", stopStylus, { passive: false });
  }

  private down(e: PointerEvent) {
    this.stats.lastPointerType = e.pointerType;
    if (e.pointerType !== "pen") {
      this.on.stats({ ...this.stats });
      return; // fingers and mice never act on the sheet
    }
    e.preventDefault();
    // Keeps the gesture going if the pen slides off the canvas. It throws if the browser no
    // longer considers the pointer active; everything works without it, so ignore that.
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not fatal */
    }
    this.active = true;
    const p = this.sample(e);
    this.lastT = p[3];
    this.first = p;
    this.count = 1;
    this.events = 0;
    this.stats.strokeMin = this.stats.strokeMax = e.pressure;
    this.on.down(p);
    this.updateStats(e.pressure);
  }

  private move(e: PointerEvent) {
    if (!this.active || e.pointerType !== "pen") return;
    // Safari batches pen samples between frames; getCoalescedEvents returns all of them.
    const batch = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const events = batch.length > 0 ? batch : [e];
    // iPad Safari repeats part of the previous batch in each coalesced list (time running
    // backwards), so keep only samples newer than the last one.
    const fresh: Point[] = [];
    for (const ev of events) {
      const p = this.sample(ev);
      if (p[3] <= this.lastT) continue;
      this.lastT = p[3];
      fresh.push(p);
      this.stats.strokeMin = Math.min(this.stats.strokeMin, ev.pressure);
      this.stats.strokeMax = Math.max(this.stats.strokeMax, ev.pressure);
    }
    this.events++;
    this.count += fresh.length;
    if (fresh.length) this.on.move(fresh);
    this.updateStats(events[events.length - 1].pressure);
  }

  private up(e: PointerEvent) {
    if (!this.active || e.pointerType !== "pen") return;
    this.active = false;
    this.on.up();
  }

  private sample(e: PointerEvent): Point {
    const [x, y] = this.toLogical(e.clientX, e.clientY);
    return [x, y, e.pressure, e.timeStamp - this.t0];
  }

  private updateStats(pressure: number) {
    this.stats.pressure = pressure;
    this.stats.coalescedPerEvent = this.events > 0 ? (this.count - 1) / this.events : 0;
    const span = this.first ? this.lastT - this.first[3] : 0;
    this.stats.sampleRate = span > 0 ? ((this.count - 1) * 1000) / span : 0;
    this.on.stats({ ...this.stats });
  }
}
