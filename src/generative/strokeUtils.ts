/**
 * Geometry helpers for Sketch-RNN output. Kept free of TensorFlow and of the
 * DOM so the awkward parts -- fitting a sketch into a box, revealing it a
 * point at a time -- can be tested directly.
 */

export interface SketchPoint {
  x: number;
  y: number;
}

/** One pen-down run: a polyline the canvas draws as a single path. */
export type SketchLine = SketchPoint[];

/**
 * Raw Sketch-RNN output: `[dx, dy, penDown, penUp, penEnd]` offsets. This is
 * the model's own format, so we keep it rather than converting too early.
 */
export type RawStroke = [number, number, number, number, number];

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Turns relative pen offsets into absolute polylines. `penDown` on a stroke
 * means "the segment leading to the next point is drawn"; `penUp` lifts the
 * pen, so the next point starts a new line.
 */
export function strokesToLines(strokes: RawStroke[]): SketchLine[] {
  const lines: SketchLine[] = [];
  let current: SketchLine = [];
  let x = 0;
  let y = 0;
  let penIsDown = true;

  for (const [dx, dy, penDown, , penEnd] of strokes) {
    // The end token terminates the sketch; its offset is not a pen movement,
    // and drawing it would tack a stray segment onto the finished picture.
    if (penEnd === 1) break;
    if (penIsDown) {
      if (current.length === 0) current.push({ x, y });
      x += dx;
      y += dy;
      current.push({ x, y });
    } else {
      // Pen was lifted: move without drawing, then start a fresh line here.
      x += dx;
      y += dy;
      if (current.length > 1) lines.push(current);
      current = [{ x, y }];
    }
    penIsDown = penDown === 1;
  }

  if (current.length > 1) lines.push(current);
  return lines;
}

export function boundsOf(lines: SketchLine[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const line of lines) {
    for (const point of line) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
  }
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

export function countPoints(lines: SketchLine[]): number {
  return lines.reduce((total, line) => total + line.length, 0);
}

/**
 * Scales and centres a sketch inside a `size` x `size` box, preserving its
 * aspect ratio. Sketch-RNN emits whatever size it likes, so this is what
 * stops half the drawing falling off the canvas.
 */
export function fitLines(lines: SketchLine[], size: number, padding: number): SketchLine[] {
  const bounds = boundsOf(lines);
  if (!bounds) return [];

  const inner = Math.max(1, size - padding * 2);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const scale = Math.min(inner / Math.max(width, 1e-6), inner / Math.max(height, 1e-6));
  const offsetX = padding + (inner - width * scale) / 2;
  const offsetY = padding + (inner - height * scale) / 2;

  return lines.map((line) =>
    line.map((point) => ({
      x: offsetX + (point.x - bounds.minX) * scale,
      y: offsetY + (point.y - bounds.minY) * scale,
    })),
  );
}

/**
 * The first `count` points of the sketch, in drawing order -- this is what
 * makes the canvas look like the AI is drawing rather than pasting.
 */
export function revealLines(lines: SketchLine[], count: number): SketchLine[] {
  if (count <= 0) return [];
  const result: SketchLine[] = [];
  let remaining = count;
  for (const line of lines) {
    if (remaining <= 0) break;
    if (remaining >= line.length) {
      result.push(line);
      remaining -= line.length;
    } else {
      result.push(line.slice(0, remaining));
      remaining = 0;
    }
  }
  return result;
}

/** How far through the drawing a child guessed, as a whole percent. */
export function revealPercent(shown: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(1, Math.min(100, Math.round((shown / total) * 100)));
}
