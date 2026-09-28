import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  countPoints,
  fitLines,
  revealLines,
  revealPercent,
  strokesToLines,
  type RawStroke,
  type SketchLine,
} from './strokeUtils';

const down = (dx: number, dy: number): RawStroke => [dx, dy, 1, 0, 0];
const up = (dx: number, dy: number): RawStroke => [dx, dy, 0, 1, 0];
const end = (): RawStroke => [0, 0, 0, 0, 1];

describe('strokesToLines', () => {
  it('accumulates offsets into one absolute polyline', () => {
    const lines = strokesToLines([down(10, 0), down(0, 10), end()]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it('starts a new line after the pen lifts', () => {
    // A stroke's pen state describes the segment that *follows* it, so the
    // lift at (30,0) is what turns the next 50px move into a jump.
    const lines = strokesToLines([down(10, 0), up(20, 0), down(50, 0), down(10, 0), end()]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 30, y: 0 },
    ]);
    expect(lines[1]).toEqual([
      { x: 80, y: 0 },
      { x: 90, y: 0 },
    ]);
  });

  it('stops at the end-of-sketch token', () => {
    const lines = strokesToLines([down(10, 0), end(), down(999, 999)]);
    expect(countPoints(lines)).toBe(2);
  });

  it('drops a trailing line that never got a second point', () => {
    // Second lift jumps to (15,15) and the sketch ends there, so that lone
    // point is not a drawable line.
    const lines = strokesToLines([up(5, 5), up(10, 10), end()]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ]);
  });

  it('ignores the end token’s own offset', () => {
    const lines = strokesToLines([down(10, 0), down(10, 0), [999, 999, 0, 0, 1]]);
    expect(lines[0]).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
  });
});

describe('fitLines', () => {
  const lines: SketchLine[] = [
    [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 200 },
    ],
  ];

  it('scales and centres inside the box, keeping the aspect ratio', () => {
    const fitted = fitLines(lines, 100, 10);
    const bounds = boundsOf(fitted)!;
    expect(bounds.minX).toBeCloseTo(10);
    expect(bounds.maxX).toBeCloseTo(90);
    // Half as tall as it is wide, so it is centred vertically.
    expect(bounds.maxY - bounds.minY).toBeCloseTo(40);
    expect(bounds.minY).toBeCloseTo(30);
  });

  it('never leaves the box', () => {
    for (const line of fitLines(lines, 512, 40)) {
      for (const point of line) {
        expect(point.x).toBeGreaterThanOrEqual(40);
        expect(point.x).toBeLessThanOrEqual(472);
      }
    }
  });

  it('survives a sketch that never moved', () => {
    const fitted = fitLines([[{ x: 5, y: 5 }, { x: 5, y: 5 }]], 100, 10);
    expect(boundsOf(fitted)).not.toBeNull();
  });

  it('returns nothing for an empty sketch', () => {
    expect(fitLines([], 100, 10)).toEqual([]);
  });
});

describe('revealLines', () => {
  const lines: SketchLine[] = [
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ],
    [
      { x: 9, y: 9 },
      { x: 8, y: 8 },
    ],
  ];

  it('shows nothing at zero', () => {
    expect(revealLines(lines, 0)).toEqual([]);
  });

  it('truncates part-way through a line', () => {
    expect(revealLines(lines, 2)).toEqual([[{ x: 0, y: 0 }, { x: 1, y: 1 }]]);
  });

  it('carries on into the next line', () => {
    const shown = revealLines(lines, 4);
    expect(shown).toHaveLength(2);
    expect(countPoints(shown)).toBe(4);
  });

  it('never exceeds the whole sketch', () => {
    expect(countPoints(revealLines(lines, 999))).toBe(5);
  });
});

describe('revealPercent', () => {
  it('reports progress through the drawing', () => {
    expect(revealPercent(37, 100)).toBe(37);
    expect(revealPercent(100, 100)).toBe(100);
  });

  it('never claims 0% for a guess that was made', () => {
    expect(revealPercent(1, 500)).toBe(1);
  });

  it('is safe on an empty sketch', () => {
    expect(revealPercent(0, 0)).toBe(0);
  });
});

describe('boundsOf', () => {
  it('rejects a sketch containing non-finite coordinates', () => {
    expect(boundsOf([[{ x: 0, y: 0 }, { x: NaN, y: 1 }]])).toBeNull();
  });
});
