// Drawing the paper and the ink. Everything is in logical units (360 wide); one transform
// maps that onto the canvas at whatever size and pixel density the iPad gives us.

import { SHEET, type Point, type Stroke } from "./project";

const PAPER = "#fffdf6";
const RULE = "#c9d8ec";
const GUTTER = "#f0c4c4";
const INK = "#1d2a5c";
const SELECTED = "#e0247a";

/** Line width for a pressure value. Pressure 0 (some browsers report it for hover) still draws a hairline. */
export function widthFor(pressure: number): number {
  return 0.8 + pressure * 3.2;
}

export class Sheet {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** CSS pixels per logical unit. */
  scale = 1;
  height: number;

  constructor(canvas: HTMLCanvasElement, height: number) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas");
    this.ctx = ctx;
    this.height = height;
  }

  /** Fits the sheet to its container's width. Call on load, resize, and height changes. */
  resize(cssWidth: number) {
    const dpr = window.devicePixelRatio || 1;
    this.scale = cssWidth / SHEET.width;
    const cssHeight = this.height * this.scale;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, 0, 0);
  }

  /** Client (CSS) coordinates of a pointer event to logical sheet coordinates. */
  toLogical(clientX: number, clientY: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [(clientX - rect.left) / this.scale, (clientY - rect.top) / this.scale];
  }

  redraw(strokes: Stroke[], selected: number | null) {
    this.drawPaper();
    strokes.forEach((s, i) => this.drawStroke(s.points, i === selected ? SELECTED : INK));
  }

  /** Draws only the newest segments of the stroke in progress (cheap, no full redraw per event). */
  drawTail(points: Point[], from: number) {
    this.drawSegments(points, Math.max(1, from), INK);
  }

  private drawPaper() {
    const { ctx } = this;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, SHEET.width, this.height);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = RULE;
    ctx.beginPath();
    for (let y = SHEET.rule * (SHEET.topBlankLines + 1); y < this.height; y += SHEET.rule) {
      ctx.moveTo(0, y);
      ctx.lineTo(SHEET.width, y);
    }
    ctx.stroke();
    ctx.strokeStyle = GUTTER;
    ctx.beginPath();
    for (const x of [SHEET.gutter, SHEET.width - SHEET.gutter]) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
    }
    ctx.stroke();
  }

  private drawStroke(points: Point[], color: string) {
    if (points.length === 1) {
      // A dot (an i or a period): a filled circle the size of the pen.
      const [x, y, p] = points[0];
      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.arc(x, y, widthFor(p) / 2, 0, Math.PI * 2);
      this.ctx.fill();
      return;
    }
    this.drawSegments(points, 1, color);
  }

  // Each segment is its own path so its width can follow pressure. Round caps hide the joins.
  // (Playback in the game smooths with Catmull-Rom; the spike only needs to show raw samples.)
  private drawSegments(points: Point[], from: number, color: string) {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    for (let i = from; i < points.length; i++) {
      const [x0, y0] = points[i - 1];
      const [x1, y1, p] = points[i];
      ctx.lineWidth = widthFor(p);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }
}

/** Index of the stroke nearest to (x, y), if any segment is within `maxDist` logical units. */
export function hitTest(strokes: Stroke[], x: number, y: number, maxDist: number): number | null {
  let best: number | null = null;
  let bestDist = maxDist;
  strokes.forEach((s, i) => {
    const d = distanceToStroke(s.points, x, y);
    if (d <= bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

function distanceToStroke(points: Point[], x: number, y: number): number {
  if (points.length === 1) return Math.hypot(points[0][0] - x, points[0][1] - y);
  let min = Infinity;
  for (let i = 1; i < points.length; i++) {
    min = Math.min(min, distanceToSegment(points[i - 1], points[i], x, y));
  }
  return min;
}

function distanceToSegment(a: Point, b: Point, x: number, y: number): number {
  const [ax, ay] = a;
  const dx = b[0] - ax;
  const dy = b[1] - ay;
  const len2 = dx * dx + dy * dy;
  // Project (x, y) onto the segment, clamped to its ends.
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
  return Math.hypot(ax + t * dx - x, ay + t * dy - y);
}
