// Drawing the paper, the ink, and the editing overlays. Everything is in logical units
// (360 wide); one transform maps that onto the canvas at the iPad's size and pixel density.

import { bounds, SHEET, strokeIndex, type Point, type Project } from "./project";
import type { Cursor } from "./sequence";

const PAPER = "#fffdf6";
const RULE = "#c9d8ec";
const GUTTER = "#f0c4c4";
const INK = "#1d2a5c";
const SELECTED = "#e0247a";
const CONFLICT = "#e8a33d";
const PARAGRAPH = "#2a9d8f";
const PAGE = "#7b5cc4";

/** What's highlighted on top of the ink. */
export interface Overlay {
  selected: Set<number>;
  conflicts: Set<number>;
  cursor: Cursor | null;
  markerSelected: number | null;
  /** A marker being dragged: where its line would go. */
  ghostY: number | null;
  /** A selection rectangle being dragged: x0, y0, x1, y1. */
  rect: [number, number, number, number] | null;
}

export const emptyOverlay = (): Overlay => ({
  selected: new Set(),
  conflicts: new Set(),
  cursor: null,
  markerSelected: null,
  ghostY: null,
  rect: null,
});

/** Line width for a pressure value (the editor's look; the game's look is in the Preview). */
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

  /** Fits the sheet to a CSS width. Call on load, resize, and height changes. */
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

  redraw(p: Project, o: Overlay) {
    this.drawPaper();
    for (const m of p.markers) {
      this.drawMarker(m.y, m.kind, m.id === o.markerSelected);
    }
    for (const s of p.strokes) {
      const color = o.selected.has(s.id) ? SELECTED : o.conflicts.has(s.id) ? CONFLICT : INK;
      this.drawStroke(s.points, color);
    }
    if (o.cursor) this.drawCursor(p, o.cursor);
    if (o.ghostY !== null) this.drawMarker(o.ghostY, "paragraph", true, 0.5);
    if (o.rect) {
      const [x0, y0, x1, y1] = o.rect;
      this.ctx.save();
      this.ctx.setLineDash([4, 3]);
      this.ctx.strokeStyle = SELECTED;
      this.ctx.lineWidth = 0.8;
      this.ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      this.ctx.restore();
    }
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

  /** A paragraph marker is a solid line, a page break dashed; both have a handle in the left gutter. */
  private drawMarker(y: number, kind: "paragraph" | "page", selected: boolean, alpha = 1) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = kind === "page" ? PAGE : PARAGRAPH;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = selected ? 1.6 : 0.9;
    if (kind === "page") ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(SHEET.gutter, y);
    ctx.lineTo(SHEET.width - SHEET.gutter, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(SHEET.gutter / 2, y, selected ? 6 : 4.5, 0, Math.PI * 2);
    ctx.fill();
    if (kind === "page") {
      ctx.font = "6px sans-serif";
      ctx.fillText("PAGE", SHEET.width - SHEET.gutter + 2, y - 2);
    }
    ctx.restore();
  }

  /** The insertion cursor: a pink caret right after the stroke new writing will follow. */
  private drawCursor(p: Project, c: Cursor) {
    let x = SHEET.gutter;
    let y = SHEET.rule * (SHEET.topBlankLines + 1);
    if (c.after !== null) {
      const s = p.strokes[strokeIndex(p, c.after)];
      if (!s) return;
      const [, y0, x1, y1] = bounds(s);
      x = x1 + 2;
      y = y1;
      if (y1 - y0 < 8) y = y0 + 8;
    }
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = SELECTED;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y - 16);
    ctx.lineTo(x, y + 2);
    ctx.moveTo(x - 3, y + 4);
    ctx.lineTo(x, y + 1);
    ctx.lineTo(x + 3, y + 4);
    ctx.stroke();
    ctx.restore();
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
