import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

const RESOLUTION = 512;

const BRUSH_SIZES = [
  { label: 'Thin', value: 8 },
  { label: 'Medium', value: 18 },
  { label: 'Thick', value: 34 },
];

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  size: number;
  points: Point[];
}

export interface DrawingCanvasHandle {
  getCanvas: () => HTMLCanvasElement | null;
  clear: () => void;
}

interface Props {
  disabled?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  accent?: string;
}

export const DrawingCanvas = forwardRef<DrawingCanvasHandle, Props>(function DrawingCanvas(
  { disabled = false, onDirtyChange, accent = 'var(--brand)' },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  /**
   * Exactly one pointer owns the canvas at a time.
   *
   * A phone hands us far more pointers than a mouse ever does: a resting
   * thumb, the side of a palm, a curious second finger. With a single
   * `drawing` boolean any of those would hijack or end the stroke the child
   * is actually drawing, and the canvas would go dead until they lifted off
   * and started again. Tracking the id of the pointer that started the stroke
   * lets every other pointer be ignored outright.
   *
   * Note that WebKit reuses pointer id 0 for touches, so every check here
   * compares against `null` rather than testing for truthiness.
   */
  const activePointerIdRef = useRef<number | null>(null);
  /**
   * The stroke that pointer is drawing, held directly rather than looked up as
   * "the last one": Clear and Undo can empty the array while a finger is still
   * down, and indexing into it would then read `undefined`.
   */
  const activeStrokeRef = useRef<Stroke | null>(null);
  const [brush, setBrush] = useState(BRUSH_SIZES[1].value);
  const [dirty, setDirty] = useState(false);

  const markDirty = useCallback(
    (value: boolean) => {
      setDirty(value);
      onDirtyChange?.(value);
    },
    [onDirtyChange],
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#141414';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokesRef.current) {
      ctx.lineWidth = stroke.size;
      ctx.beginPath();
      if (stroke.points.length === 1) {
        // A single tap should still leave a dot.
        const [p] = stroke.points;
        ctx.arc(p.x, p.y, stroke.size / 2, 0, Math.PI * 2);
        ctx.fillStyle = '#141414';
        ctx.fill();
        continue;
      }
      stroke.points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    redraw();
  }, [redraw]);

  /**
   * Forget the pointer that owns the canvas. Called from every way a stroke
   * can end -- a clean lift, a cancel, a capture the browser took back, an
   * unmount -- because stale pointer state must never be able to block the
   * next stroke.
   */
  const endStroke = useCallback((pointerId: number | null) => {
    activePointerIdRef.current = null;
    activeStrokeRef.current = null;
    if (pointerId === null) return;
    try {
      canvasRef.current?.releasePointerCapture(pointerId);
    } catch {
      // The browser had already released it; nothing left to do.
    }
  }, []);

  const clear = useCallback(() => {
    strokesRef.current = [];
    activeStrokeRef.current = null;
    redraw();
    markDirty(false);
  }, [markDirty, redraw]);

  const undo = useCallback(() => {
    const removed = strokesRef.current[strokesRef.current.length - 1];
    strokesRef.current = strokesRef.current.slice(0, -1);
    if (activeStrokeRef.current === removed) activeStrokeRef.current = null;
    redraw();
    markDirty(strokesRef.current.length > 0);
  }, [markDirty, redraw]);

  useImperativeHandle(ref, () => ({ getCanvas: () => canvasRef.current, clear }), [clear]);

  /**
   * Safety net for the lift we never see on the canvas itself: if capture
   * could not be taken, or the browser handed the gesture to something else,
   * the pointerup lands on another element. Without this the canvas would
   * still believe a finger is down.
   */
  useEffect(() => {
    const finish = (event: PointerEvent) => {
      if (event.pointerId !== activePointerIdRef.current) return;
      endStroke(event.pointerId);
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      endStroke(activePointerIdRef.current);
    };
  }, [endStroke]);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * RESOLUTION,
      y: ((event.clientY - rect.top) / rect.height) * RESOLUTION,
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    // A second contact while a stroke is in progress is a palm or a stray
    // finger, never a new drawing. Leave the active stroke completely alone.
    if (activePointerIdRef.current !== null) return;
    event.preventDefault();
    activePointerIdRef.current = event.pointerId;
    try {
      canvasRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Some input devices do not support capture; the window-level listeners
      // above still end the stroke correctly.
    }
    const stroke: Stroke = { size: brush, points: [pointFromEvent(event)] };
    activeStrokeRef.current = stroke;
    strokesRef.current = [...strokesRef.current, stroke];
    redraw();
    markDirty(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    if (event.pointerId !== activePointerIdRef.current) return;
    const stroke = activeStrokeRef.current;
    // Clear or Undo can remove the stroke out from under a finger that is
    // still down; there is nothing left to extend.
    if (!stroke) return;
    event.preventDefault();
    stroke.points.push(pointFromEvent(event));
    redraw();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerId !== activePointerIdRef.current) return;
    endStroke(event.pointerId);
  };

  const handleLostPointerCapture = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerId !== activePointerIdRef.current) return;
    // Whatever the browser decided to do with this gesture, the stroke is over
    // and the canvas must be ready for the next one.
    endStroke(null);
  };

  return (
    <div className="canvasBlock">
      <div className="canvasFrame" style={{ ['--frame-accent' as string]: accent }}>
        <canvas
          ref={canvasRef}
          width={RESOLUTION}
          height={RESOLUTION}
          className="canvas"
          role="img"
          aria-label={
            dirty ? 'Drawing area, contains your drawing' : 'Drawing area, currently empty'
          }
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={handleLostPointerCapture}
          onContextMenu={(event) => event.preventDefault()}
        />
        {!dirty && (
          <div className="canvasHint" aria-hidden="true">
            <span className="canvasHintEmoji">✏️</span>
            <span>Draw here</span>
          </div>
        )}
      </div>

      <div className="canvasTools">
        <div className="brushPicker" role="group" aria-label="Brush size">
          {BRUSH_SIZES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`brushButton${brush === option.value ? ' isActive' : ''}`}
              onClick={() => setBrush(option.value)}
              aria-pressed={brush === option.value}
              aria-label={`${option.label} brush`}
              title={`${option.label} brush`}
            >
              <span className="brushDot" style={{ width: option.value, height: option.value }} />
            </button>
          ))}
        </div>

        <div className="canvasActions">
          <button type="button" className="btn btnGhost" onClick={undo} disabled={!dirty}>
            ↩︎ Undo
          </button>
          <button type="button" className="btn btnGhost" onClick={clear} disabled={!dirty}>
            Clear
          </button>
        </div>
      </div>
    </div>
  );
});
