import { Shell } from "./components/Shell";
import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
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
const STORAGE_KEY = "whiteboard_drawings";

type Tool = "pen" | "eraser" | "line" | "rect" | "ellipse";

interface Drawing {
  id: string;
  name: string;
  dataUrl: string;
  updatedAt: number;
}

function loadDrawings(): Drawing[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveDrawings(drawings: Drawing[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drawings));
}

function initDrawings(): { drawings: Drawing[]; activeId: string } {
  const existing = loadDrawings();
  if (existing.length > 0 && existing[0]) {
    return { drawings: existing, activeId: existing[0].id };
  }
  const id = crypto.randomUUID();
  const fresh: Drawing = { id, name: "Drawing 1", dataUrl: "", updatedAt: Date.now() };
  saveDrawings([fresh]);
  return { drawings: [fresh], activeId: id };
}

function buildCursor(size: number, erasing: boolean): string {
  const r = Math.max(size / 2, 1.5);
  const svgSize = Math.ceil(r * 2 + 4);
  const center = svgSize / 2;
  const stroke = erasing ? "%23999" : "%23333";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${svgSize}' height='${svgSize}'><circle cx='${center}' cy='${center}' r='${r}' fill='none' stroke='${stroke}' stroke-width='1.5'/>${erasing ? "" : `<circle cx='${center}' cy='${center}' r='1' fill='${stroke}'/>`}</svg>`;
  return `url("data:image/svg+xml,${svg}") ${center} ${center}, crosshair`;
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const shapeStart = useRef<{ x: number; y: number } | null>(null);
  const preDrawState = useRef<ImageData | null>(null);

  const [color, setColor] = useState("#1a1a1a");
  const [brushSize, setBrushSize] = useState(4);
  const [tool, setTool] = useState<Tool>("pen");
  const [undoStack, setUndoStack] = useState<ImageData[]>([]);
  const [redoStack, setRedoStack] = useState<ImageData[]>([]);

  const [initState] = useState(initDrawings);
  const [drawings, setDrawings] = useState<Drawing[]>(initState.drawings);
  const [activeId, setActiveId] = useState<string>(initState.activeId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showDrawings, setShowDrawings] = useState(false);

  const cursor = useMemo(() => buildCursor(brushSize, tool === "eraser"), [brushSize, tool]);
  const isShapeTool = tool === "line" || tool === "rect" || tool === "ellipse";

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

  const persistCurrentDrawing = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeId) return;
    const dataUrl = canvas.toDataURL("image/png");
    setDrawings((prev) => {
      const next = prev.map((d) =>
        d.id === activeId ? { ...d, dataUrl, updatedAt: Date.now() } : d,
      );
      saveDrawings(next);
      return next;
    });
  }, [activeId]);

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
    const drawing = drawings.find((d) => d.id === activeId);
    const link = document.createElement("a");
    link.download = (drawing?.name || "whiteboard") + ".png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [activeId, drawings]);

  const loadDrawingToCanvas = useCallback(
    (dataUrl: string) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const img = new Image();
      img.onload = () => {
        fillCanvas(ctx, canvas.width, canvas.height);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(img, 0, 0, Math.min(img.width, canvas.width), Math.min(img.height, canvas.height));
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.restore();
      };
      img.src = dataUrl;
    },
    [fillCanvas],
  );

  const handleNewDrawing = useCallback(() => {
    persistCurrentDrawing();
    const id = crypto.randomUUID();
    const drawing: Drawing = {
      id,
      name: `Drawing ${drawings.length + 1}`,
      dataUrl: "",
      updatedAt: Date.now(),
    };
    const next = [drawing, ...drawings];
    setDrawings(next);
    saveDrawings(next);
    setActiveId(id);
    setUndoStack([]);
    setRedoStack([]);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) fillCanvas(ctx, canvas.width, canvas.height);
    }
  }, [persistCurrentDrawing, drawings, fillCanvas]);

  const handleSwitchDrawing = useCallback(
    (id: string) => {
      if (id === activeId) return;
      persistCurrentDrawing();
      setActiveId(id);
      setUndoStack([]);
      setRedoStack([]);
      const drawing = drawings.find((d) => d.id === id);
      if (drawing?.dataUrl) {
        loadDrawingToCanvas(drawing.dataUrl);
      } else {
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d");
          if (ctx) fillCanvas(ctx, canvas.width, canvas.height);
        }
      }
    },
    [activeId, persistCurrentDrawing, drawings, loadDrawingToCanvas, fillCanvas],
  );

  const handleDeleteDrawing = useCallback(
    (id: string) => {
      const next = drawings.filter((d) => d.id !== id);
      if (next.length === 0) return;
      setDrawings(next);
      saveDrawings(next);
      if (activeId === id && next[0]) {
        handleSwitchDrawing(next[0].id);
      }
    },
    [activeId, drawings, handleSwitchDrawing],
  );

  const handleRenameDrawing = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim() || "Untitled";
      const next = drawings.map((d) => (d.id === id ? { ...d, name: trimmed } : d));
      setDrawings(next);
      saveDrawings(next);
      setEditingId(null);
    },
    [drawings],
  );

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

    if (imageData) {
      ctx.putImageData(imageData, 0, 0);
    }
  }, [fillCanvas]);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [resizeCanvas]);

  // Load active drawing after first mount
  useEffect(() => {
    const drawing = initState.drawings.find((d) => d.id === initState.activeId);
    if (drawing?.dataUrl) {
      setTimeout(() => loadDrawingToCanvas(drawing.dataUrl), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  useEffect(() => {
    if (!activeId) return;
    const interval = setInterval(persistCurrentDrawing, 3000);
    return () => clearInterval(interval);
  }, [activeId, persistCurrentDrawing]);

  const getPos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const strokeOnCanvas = (
    ctx: CanvasRenderingContext2D,
    fn: (ctx: CanvasRenderingContext2D) => void,
  ) => {
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = tool === "eraser" ? getCssVar("--color-paper") : color;
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    fn(ctx);
    ctx.restore();
  };

  const drawLine = (
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => {
    strokeOnCanvas(ctx, (c) => {
      c.beginPath();
      c.moveTo(from.x, from.y);
      c.lineTo(to.x, to.y);
      c.stroke();
    });
  };

  const drawShape = (
    ctx: CanvasRenderingContext2D,
    start: { x: number; y: number },
    end: { x: number; y: number },
    shape: Tool,
  ) => {
    strokeOnCanvas(ctx, (c) => {
      c.beginPath();
      if (shape === "line") {
        c.moveTo(start.x, start.y);
        c.lineTo(end.x, end.y);
      } else if (shape === "rect") {
        c.rect(start.x, start.y, end.x - start.x, end.y - start.y);
      } else if (shape === "ellipse") {
        const cx = (start.x + end.x) / 2;
        const cy = (start.y + end.y) / 2;
        const rx = Math.abs(end.x - start.x) / 2;
        const ry = Math.abs(end.y - start.y) / 2;
        c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      }
      c.stroke();
    });
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

    if (isShapeTool) {
      shapeStart.current = pos;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        preDrawState.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
    } else {
      const ctx = canvas.getContext("2d");
      if (ctx) drawLine(ctx, pos, pos);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e);

    if (isShapeTool && shapeStart.current && preDrawState.current) {
      ctx.putImageData(preDrawState.current, 0, 0);
      drawShape(ctx, shapeStart.current, pos, tool);
    } else {
      if (lastPos.current) drawLine(ctx, lastPos.current, pos);
      lastPos.current = pos;
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (canvas) canvas.releasePointerCapture(e.pointerId);

    if (isShapeTool && shapeStart.current && preDrawState.current && canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.putImageData(preDrawState.current, 0, 0);
        drawShape(ctx, shapeStart.current, getPos(e), tool);
      }
    }

    isDrawing.current = false;
    lastPos.current = null;
    shapeStart.current = null;
    preDrawState.current = null;
    persistCurrentDrawing();
  };

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

  const toolBtn = (t: Tool, label: string) => (
    <button
      key={t}
      onClick={() => setTool(t)}
      style={tool === t ? activeBtnStyle : btnStyle}
    >
      {label}
    </button>
  );

  const drawingItem = (d: Drawing, compact?: boolean) => (
    <div
      key={d.id}
      className="flex items-center gap-1.5"
      style={{
        padding: compact ? "0.375rem 0.5rem" : "0.375rem 0.5rem",
        borderRadius: "var(--radius-btn)",
        background: d.id === activeId ? "var(--color-accent)" : "transparent",
        color: d.id === activeId ? "#fff" : "var(--color-ink)",
        cursor: "pointer",
        fontSize: "0.8125rem",
      }}
    >
      {d.dataUrl && (
        <img
          src={d.dataUrl}
          alt=""
          style={{
            width: "2rem",
            height: "1.5rem",
            objectFit: "cover",
            borderRadius: "0.25rem",
            border: "1px solid",
            borderColor: d.id === activeId ? "rgba(255,255,255,0.3)" : "var(--color-line)",
            flexShrink: 0,
          }}
        />
      )}
      {editingId === d.id ? (
        <input
          autoFocus
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={() => handleRenameDrawing(d.id, editName)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRenameDrawing(d.id, editName);
            if (e.key === "Escape") setEditingId(null);
          }}
          onClick={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            background: "transparent",
            border: "1px solid",
            borderColor: d.id === activeId ? "rgba(255,255,255,0.5)" : "var(--color-line)",
            borderRadius: "0.25rem",
            padding: "0.125rem 0.25rem",
            color: "inherit",
            fontSize: "inherit",
            fontFamily: "inherit",
            outline: "none",
            minWidth: 0,
          }}
        />
      ) : (
        <span
          className="flex-1 truncate"
          onClick={() => handleSwitchDrawing(d.id)}
          onDoubleClick={() => {
            setEditingId(d.id);
            setEditName(d.name);
          }}
          style={{ minWidth: 0 }}
        >
          {d.name}
        </span>
      )}
      {drawings.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDeleteDrawing(d.id);
          }}
          title="Delete"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "inherit",
            opacity: 0.6,
            fontSize: "0.75rem",
            padding: "0 0.25rem",
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  );

  const toolbar = (
    <>
      <div>
        <div style={labelStyle}>Drawings</div>
        <button
          onClick={handleNewDrawing}
          style={{ ...btnStyle, width: "100%", marginBottom: "0.5rem" }}
        >
          + New Drawing
        </button>
        <div className="flex flex-col gap-0.5" style={{ maxHeight: "12rem", overflowY: "auto" }}>
          {drawings.map((d) => drawingItem(d))}
        </div>
      </div>

      <div>
        <div style={labelStyle}>Color</div>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                setColor(c);
                if (tool === "eraser") setTool("pen");
              }}
              title={c}
              style={{
                width: "1.75rem",
                height: "1.75rem",
                borderRadius: "var(--radius-btn)",
                background: c,
                border:
                  color === c && tool !== "eraser"
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
                if (tool === "eraser") setTool("pen");
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

      <div>
        <div style={labelStyle}>Tool</div>
        <div className="flex flex-wrap gap-1.5">
          {toolBtn("pen", "Pen")}
          {toolBtn("eraser", "Eraser")}
          {toolBtn("line", "Line")}
          {toolBtn("rect", "Rect")}
          {toolBtn("ellipse", "Ellipse")}
        </div>
      </div>

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

  const mobileToolBtn = (t: Tool, label: string) => (
    <button
      key={t}
      onClick={() => setTool(t)}
      style={{
        ...(tool === t ? activeBtnStyle : btnStyle),
        padding: "0.375rem 0.5rem",
        fontSize: "0.75rem",
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );

  return (
    <Shell>
      <div className="flex flex-col md:flex-row w-full h-full">
        <div
          className="hidden md:flex flex-col gap-5 shrink-0 p-5 border-r overflow-y-auto"
          style={{
            width: "14rem",
            borderColor: "var(--color-line)",
            background: "var(--color-panel)",
          }}
        >
          {toolbar}
        </div>

        <div
          className="flex md:hidden items-center gap-3 px-3 py-2 border-b overflow-x-auto shrink-0"
          style={{
            borderColor: "var(--color-line)",
            background: "var(--color-panel)",
          }}
        >
          <button
            onClick={() => setShowDrawings(!showDrawings)}
            style={{
              ...btnStyle,
              padding: "0.375rem 0.5rem",
              fontSize: "0.75rem",
              flexShrink: 0,
            }}
          >
            {showDrawings ? "Canvas" : `Drawings (${drawings.length})`}
          </button>
          {!showDrawings && (
            <>
              <div className="flex items-center gap-1.5 shrink-0">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setColor(c);
                      if (tool === "eraser") setTool("pen");
                    }}
                    style={{
                      width: "1.5rem",
                      height: "1.5rem",
                      borderRadius: "0.375rem",
                      background: c,
                      border:
                        color === c && tool !== "eraser"
                          ? "2.5px solid var(--color-accent)"
                          : "2px solid var(--color-line)",
                      cursor: "pointer",
                      padding: 0,
                      flexShrink: 0,
                    }}
                  />
                ))}
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
              {mobileToolBtn("pen", "Pen")}
              {mobileToolBtn("eraser", "Eraser")}
              {mobileToolBtn("line", "Line")}
              {mobileToolBtn("rect", "Rect")}
              {mobileToolBtn("ellipse", "Ellipse")}
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
            </>
          )}
        </div>

        {showDrawings && (
          <div
            className="flex flex-col gap-3 p-4 md:hidden overflow-y-auto"
            style={{ background: "var(--color-panel)" }}
          >
            <button
              onClick={() => {
                handleNewDrawing();
                setShowDrawings(false);
              }}
              style={{ ...btnStyle, width: "100%" }}
            >
              + New Drawing
            </button>
            {drawings.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-2"
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "var(--radius-btn)",
                  background: d.id === activeId ? "var(--color-accent)" : "var(--color-paper)",
                  color: d.id === activeId ? "#fff" : "var(--color-ink)",
                  cursor: "pointer",
                  border: "1px solid var(--color-line)",
                }}
                onClick={() => {
                  handleSwitchDrawing(d.id);
                  setShowDrawings(false);
                }}
              >
                {d.dataUrl && (
                  <img
                    src={d.dataUrl}
                    alt=""
                    style={{
                      width: "2.5rem",
                      height: "1.75rem",
                      objectFit: "cover",
                      borderRadius: "0.25rem",
                      border: "1px solid",
                      borderColor: d.id === activeId ? "rgba(255,255,255,0.3)" : "var(--color-line)",
                      flexShrink: 0,
                    }}
                  />
                )}
                <span className="flex-1 truncate" style={{ fontSize: "0.875rem" }}>{d.name}</span>
                {drawings.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteDrawing(d.id);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "inherit",
                      opacity: 0.6,
                      fontSize: "1rem",
                      padding: "0 0.25rem",
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div
          ref={containerRef}
          className="flex-1 min-h-0 min-w-0 relative"
          style={{ display: showDrawings ? "none" : undefined }}
        >
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
              cursor,
            }}
          />
        </div>
      </div>
    </Shell>
  );
}

export default App;
