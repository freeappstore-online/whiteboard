import { Shell } from "./components/Shell";
import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from "react";

const PRESET_COLORS = [
  "#1a1a1a",
  "#dc2626",
  "#ea580c",
  "#eab308",
  "#16a34a",
  "#2563eb",
  "#7c3aed",
  "#ec4899",
];

const MAX_HISTORY = 20;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const [color, setColor] = useState("#1a1a1a");
  const [brushSize, setBrushSize] = useState(4);
  const [eraser, setEraser] = useState(false);
  const [undoStack, setUndoStack] = useState<ImageData[]>([]);
  const [redoStack, setRedoStack] = useState<ImageData[]>([]);

  const getCssVar = useCallback((name: string) => {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
  }, []);

  const fillCanvas = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      ctx.fillStyle = getCssVar("--color-paper");
      ctx.fillRect(0, 0, w, h);
    },
    [getCssVar],
  );

  const saveState = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setUndoStack((prev) => {
      const next = [...prev, data];
      if (next.length > MAX_HISTORY) next.shift();
      return next;
    });
    setRedoStack([]);
  }, []);

  const handleUndo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const last = next.pop()!;
      // Save current state to redo stack
      const current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setRedoStack((r) => {
        const rNext = [...r, current];
        if (rNext.length > MAX_HISTORY) rNext.shift();
        return rNext;
      });
      ctx.putImageData(last, 0, 0);
      return next;
    });
  }, []);

  const handleRedo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const last = next.pop()!;
      // Save current state to undo stack
      const current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setUndoStack((u) => {
        const uNext = [...u, current];
        if (uNext.length > MAX_HISTORY) uNext.shift();
        return uNext;
      });
      ctx.putImageData(last, 0, 0);
      return next;
    });
  }, []);

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    saveState();
    fillCanvas(ctx, canvas.width, canvas.height);
  }, [saveState, fillCanvas]);

  const handleDownload = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = "whiteboard.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, []);

  // Resize canvas to match container
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);

    // Save current drawing
    let imageData: ImageData | null = null;
    if (canvas.width > 0 && canvas.height > 0) {
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    fillCanvas(ctx, w * dpr, h * dpr);

    // Restore previous drawing
    if (imageData) {
      ctx.putImageData(imageData, 0, 0);
    }
  }, [fillCanvas]);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [resizeCanvas]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo, handleRedo]);

  // -- Drawing logic --

  const getPos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const drawLine = (
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => {
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = eraser ? getCssVar("--color-paper") : color;
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    saveState();
    isDrawing.current = true;
    const pos = getPos(e);
    lastPos.current = pos;

    // Draw a dot for single clicks
    const ctx = canvas.getContext("2d");
    if (ctx) {
      drawLine(ctx, pos, pos);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e);
    if (lastPos.current) {
      drawLine(ctx, lastPos.current, pos);
    }
    lastPos.current = pos;
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (canvas) canvas.releasePointerCapture(e.pointerId);
    isDrawing.current = false;
    lastPos.current = null;
  };

  // -- Styles --

  const btnStyle: React.CSSProperties = {
    padding: "0.5rem 0.75rem",
    borderRadius: "var(--radius-btn)",
    border: "1px solid var(--color-line)",
    background: "var(--color-panel)",
    color: "var(--color-ink)",
    cursor: "pointer",
    fontSize: "0.8125rem",
    fontFamily: "inherit",
    lineHeight: 1,
  };

  const activeBtnStyle: React.CSSProperties = {
    ...btnStyle,
    background: "var(--color-accent)",
    color: "#fff",
    borderColor: "var(--color-accent)",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "0.6875rem",
    color: "var(--color-muted)",
    marginBottom: "0.375rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  const toolbar = (
    <>
      {/* Color palette */}
      <div>
        <div style={labelStyle}>Color</div>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                setColor(c);
                setEraser(false);
              }}
              title={c}
              style={{
                width: "1.75rem",
                height: "1.75rem",
                borderRadius: "var(--radius-btn)",
                background: c,
                border:
                  color === c && !eraser
                    ? "2.5px solid var(--color-accent)"
                    : "2px solid var(--color-line)",
                cursor: "pointer",
                padding: 0,
                boxSizing: "border-box",
              }}
            />
          ))}
          <label
            title="Custom color"
            style={{
              width: "1.75rem",
              height: "1.75rem",
              borderRadius: "var(--radius-btn)",
              border: "2px dashed var(--color-line)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.75rem",
              color: "var(--color-muted)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            +
            <input
              type="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                setEraser(false);
              }}
              style={{
                position: "absolute",
                inset: 0,
                opacity: 0,
                cursor: "pointer",
              }}
            />
          </label>
        </div>
      </div>

      {/* Brush size */}
      <div>
        <div style={labelStyle}>Size: {brushSize}px</div>
        <input
          type="range"
          min={1}
          max={20}
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
          style={{ width: "100%", accentColor: "var(--color-accent)" }}
        />
      </div>

      {/* Tools */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setEraser(false)}
          style={!eraser ? activeBtnStyle : btnStyle}
        >
          Pen
        </button>
        <button
          onClick={() => setEraser(true)}
          style={eraser ? activeBtnStyle : btnStyle}
        >
          Eraser
        </button>
      </div>

      {/* Undo / Redo */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleUndo}
          style={btnStyle}
          disabled={undoStack.length === 0}
        >
          Undo
        </button>
        <button
          onClick={handleRedo}
          style={btnStyle}
          disabled={redoStack.length === 0}
        >
          Redo
        </button>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button onClick={handleClear} style={btnStyle}>
          Clear
        </button>
        <button onClick={handleDownload} style={btnStyle}>
          Save PNG
        </button>
      </div>
    </>
  );

  return (
    <Shell>
      <div className="flex flex-col md:flex-row -m-4 md:-m-8 w-[calc(100%+2rem)] h-[calc(100%+2rem)] md:w-[calc(100%+4rem)] md:h-[calc(100%+4rem)]">
        {/* Desktop sidebar toolbar */}
        <div
          className="hidden md:flex flex-col gap-5 shrink-0 p-5 border-r overflow-y-auto"
          style={{
            width: "13rem",
            borderColor: "var(--color-line)",
            background: "var(--color-panel)",
          }}
        >
          {toolbar}
        </div>

        {/* Mobile toolbar above canvas */}
        <div
          className="flex md:hidden items-center gap-3 px-3 py-2 border-b overflow-x-auto shrink-0"
          style={{
            borderColor: "var(--color-line)",
            background: "var(--color-panel)",
          }}
        >
          <div className="flex items-center gap-1.5 shrink-0">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setColor(c);
                  setEraser(false);
                }}
                style={{
                  width: "1.5rem",
                  height: "1.5rem",
                  borderRadius: "0.375rem",
                  background: c,
                  border:
                    color === c && !eraser
                      ? "2.5px solid var(--color-accent)"
                      : "2px solid var(--color-line)",
                  cursor: "pointer",
                  padding: 0,
                  flexShrink: 0,
                }}
              />
            ))}
            <label
              style={{
                width: "1.5rem",
                height: "1.5rem",
                borderRadius: "0.375rem",
                border: "2px dashed var(--color-line)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.625rem",
                color: "var(--color-muted)",
                position: "relative",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              +
              <input
                type="color"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value);
                  setEraser(false);
                }}
                style={{
                  position: "absolute",
                  inset: 0,
                  opacity: 0,
                  cursor: "pointer",
                }}
              />
            </label>
          </div>
          <input
            type="range"
            min={1}
            max={20}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            style={{
              width: "5rem",
              accentColor: "var(--color-accent)",
              flexShrink: 0,
            }}
          />
          <button
            onClick={() => setEraser(false)}
            style={{
              ...(!eraser ? activeBtnStyle : btnStyle),
              padding: "0.375rem 0.5rem",
              fontSize: "0.75rem",
              flexShrink: 0,
            }}
          >
            Pen
          </button>
          <button
            onClick={() => setEraser(true)}
            style={{
              ...(eraser ? activeBtnStyle : btnStyle),
              padding: "0.375rem 0.5rem",
              fontSize: "0.75rem",
              flexShrink: 0,
            }}
          >
            Eraser
          </button>
          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            style={{
              ...btnStyle,
              padding: "0.375rem 0.5rem",
              fontSize: "0.75rem",
              flexShrink: 0,
            }}
          >
            Undo
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            style={{
              ...btnStyle,
              padding: "0.375rem 0.5rem",
              fontSize: "0.75rem",
              flexShrink: 0,
            }}
          >
            Redo
          </button>
          <button
            onClick={handleClear}
            style={{
              ...btnStyle,
              padding: "0.375rem 0.5rem",
              fontSize: "0.75rem",
              flexShrink: 0,
            }}
          >
            Clear
          </button>
          <button
            onClick={handleDownload}
            style={{
              ...btnStyle,
              padding: "0.375rem 0.5rem",
              fontSize: "0.75rem",
              flexShrink: 0,
            }}
          >
            PNG
          </button>
        </div>

        {/* Canvas */}
        <div ref={containerRef} className="flex-1 min-h-0 min-w-0 relative">
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{
              position: "absolute",
              inset: 0,
              touchAction: "none",
              cursor: eraser ? "crosshair" : "default",
            }}
          />
        </div>
      </div>
    </Shell>
  );
}

export default App;
