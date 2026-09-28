import { useEffect, useRef } from 'react';
import { revealLines, type SketchLine } from '../generative/strokeUtils';

/** Matches the coordinate space the sketch was fitted into. */
export const SKETCH_CANVAS_SIZE = 512;

const STROKE_WIDTH = 6;

interface Props {
  lines: SketchLine[];
  /** How many points of the sketch are visible; the rest is still to come. */
  revealedPoints: number;
  label?: string;
}

/**
 * Draws a generated sketch up to `revealedPoints`. Same friendly language as
 * DrawingCanvas -- white paper, dark rounded strokes -- so the AI's drawing
 * and the child's look like they came from the same box of pens.
 */
export function AiSketchCanvas({ lines, revealedPoints, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#141414';
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const line of revealLines(lines, revealedPoints)) {
      if (line.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(line[0].x, line[0].y);
      for (let i = 1; i < line.length; i += 1) ctx.lineTo(line[i].x, line[i].y);
      ctx.stroke();
    }
  }, [lines, revealedPoints]);

  return (
    <canvas
      ref={canvasRef}
      width={SKETCH_CANVAS_SIZE}
      height={SKETCH_CANVAS_SIZE}
      className="canvas aiSketchCanvas"
      role="img"
      aria-label={label ?? 'The AI is drawing'}
    />
  );
}
