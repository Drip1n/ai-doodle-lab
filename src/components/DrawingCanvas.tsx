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
  const drawingRef = useRef(false);
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

  const clear = useCallback(() => {
    strokesRef.current = [];
    redraw();
    markDirty(false);
  }, [markDirty, redraw]);

  const undo = useCallback(() => {
    strokesRef.current = strokesRef.current.slice(0, -1);
    redraw();
    markDirty(strokesRef.current.length > 0);
  }, [markDirty, redraw]);

  useImperativeHandle(ref, () => ({ getCanvas: () => canvasRef.current, clear }), [clear]);

  const capturePointer = (pointerId: number) => {
    try {
      canvasRef.current?.setPointerCapture(pointerId);
    } catch {
      // Some input devices do not support capture; drawing still works.
    }
  };

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
    event.preventDefault();
    capturePointer(event.pointerId);
    drawingRef.current = true;
    strokesRef.current = [...strokesRef.current, { size: brush, points: [pointFromEvent(event)] }];
    redraw();
    markDirty(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || disabled) return;
    event.preventDefault();
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    stroke.points.push(pointFromEvent(event));
    redraw();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    try {
      canvasRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer was already released by the browser.
    }
  };

  return (
    <div className="canvasBlock">
      <div className="canvasFrame" style={{ ['--frame-accent' as string]: accent }}>
        <canvas
          ref={canvasRef}
          width={RESOLUTION}
          height={RESOLUTION}
          className="canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
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
