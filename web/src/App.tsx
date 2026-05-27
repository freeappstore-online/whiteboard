import { Shell } from "./components/Shell";
import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { SceneElement, Camera, Drawing, Tool, Point, Rect } from "./types";
import { renderScene, hitTest, getElementBounds, floodFill, boxSelect, exportFullBoard, exportSvg } from "./render";
import { screenToWorld, clampZoom } from "./lib/camera";

const PRESET_COLORS = [
  "#1a1a1a", // black
  "#ffffff", // white
  "#dc2626", // red
  "#2563eb", // blue
  "#16a34a", // green
  "#ea580c", // orange
  "#7c3aed", // purple
  "#eab308", // yellow
];

const STICKY_COLORS = [
  "#fef3c7", // yellow
  "#fce7f3", // pink
  "#dbeafe", // blue
  "#dcfce7", // green
];

const BRUSH_WIDTHS = [
  { label: "Thin", value: 2 },
  { label: "Medium", value: 5 },
  { label: "Thick", value: 10 },
];

const MAX_HISTORY = 50;
const STORAGE_KEY = "whiteboard_drawings_v2";
const SHAPE_TOOLS: Tool[] = ["line", "arrow", "rect", "ellipse"];
function loadDrawings(): Drawing[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    const old = localStorage.getItem("whiteboard_drawings");
    if (old) {
      const oldDrawings = JSON.parse(old) as Array<{ id: string; name: string; dataUrl: string; updatedAt: number }>;
      const migrated: Drawing[] = oldDrawings.map((d) => ({
        id: d.id,
        name: d.name,
        elements: d.dataUrl
          ? [{ id: crypto.randomUUID(), type: "image" as const, pos: { x: 0, y: 0 }, width: 800, height: 600, dataUrl: d.dataUrl }]
          : [],
        camera: { x: -100, y: -100, zoom: 1 },
        thumbnail: d.dataUrl || "",
        updatedAt: d.updatedAt,
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    return [];
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
  const fresh: Drawing = { id, name: "Drawing 1", elements: [], camera: { x: -100, y: -100, zoom: 1 }, thumbnail: "", updatedAt: Date.now() };
  saveDrawings([fresh]);
  return { drawings: [fresh], activeId: id };
}

function getCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function snapPoint(p: Point, gridSize = 20): Point {
  return { x: Math.round(p.x / gridSize) * gridSize, y: Math.round(p.y / gridSize) * gridSize };
}

function constrainAngle(start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return { x: start.x + dist * Math.cos(snapped), y: start.y + dist * Math.sin(snapped) };
}

function normalizeRect(p1: Point, p2: Point): Rect {
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  return { x, y, width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y) };
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const stickyInputRef = useRef<HTMLTextAreaElement>(null);

  // Scene state
  const [elements, setElements] = useState<SceneElement[]>([]);
  const [camera, setCamera] = useState<Camera>({ x: -100, y: -100, zoom: 1 });
  const [undoStack, setUndoStack] = useState<SceneElement[][]>([]);
  const [redoStack, setRedoStack] = useState<SceneElement[][]>([]);

  // Tool state
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#1a1a1a");
  const [brushSize, setBrushSize] = useState(5);
  const [opacity, setOpacity] = useState(1);
  const [fontSize, setFontSize] = useState(20);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [filled, setFilled] = useState(false);
  const [stickyColor, setStickyColor] = useState(STICKY_COLORS[0]!);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Text/sticky editing
  const [textEditing, setTextEditing] = useState<Point | null>(null);
  const [textValue, setTextValue] = useState("");
  const [stickyEditing, setStickyEditing] = useState<{ id: string; pos: Point; width: number; height: number } | null>(null);
  const [stickyText, setStickyText] = useState("");

  // Drawing management
  const [initState] = useState(initDrawings);
  const [drawings, setDrawings] = useState<Drawing[]>(initState.drawings);
  const [activeId, setActiveId] = useState<string>(initState.activeId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showDrawings, setShowDrawings] = useState(false);

  // UI
  const [showGrid, setShowGrid] = useState(true);
  const [darkMode, setDarkMode] = useState<"auto" | "light" | "dark">("auto");

  // Selection box state
  const [selectionBox, setSelectionBox] = useState<Rect | null>(null);

  const [snapToGrid, setSnapToGrid] = useState(false);
  const clipboardRef = useRef<SceneElement[]>([]);

  // Refs for rendering and interaction
  const inProgressRef = useRef<SceneElement | null>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const spaceHeldRef = useRef(false);
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef<Point>({ x: 0, y: 0 });
  const isDrawingRef = useRef(false);
  const shapeStartRef = useRef<Point | null>(null);
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>());
  const activePtrsRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<{ dist: number; midX: number; midY: number; cam: Camera } | null>(null);
  const selBoxStartRef = useRef<Point | null>(null);
  const isResizingRef = useRef(false);
  const resizeCornerRef = useRef<string | null>(null);
  const resizeOrigBoundsRef = useRef<Rect | null>(null);
  const resizeOrigElementRef = useRef<SceneElement | null>(null);

  // Keep refs in sync for render function
  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const showGridRef = useRef(showGrid);
  showGridRef.current = showGrid;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;
  const brushSizeRef = useRef(brushSize);
  brushSizeRef.current = brushSize;
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;
  const selectionBoxRef = useRef(selectionBox);
  selectionBoxRef.current = selectionBox;

  // -- Dark mode --
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    if (darkMode !== "auto") root.classList.add(darkMode);
  }, [darkMode]);

  // -- Image preloading --
  const preloadImages = useCallback((els: SceneElement[]) => {
    const cache = imageCacheRef.current;
    for (const el of els) {
      if (el.type === "image" && !cache.has(el.dataUrl)) {
        const img = new Image();
        img.onload = () => renderToCanvas();
        img.src = el.dataUrl;
        cache.set(el.dataUrl, img);
      }
    }
  }, []);

  // -- Render --
  const renderToCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const paperColor = getCssVar("--color-paper");
    const accentColor = getCssVar("--color-accent");
    const dpr = window.devicePixelRatio || 1;
    renderScene(
      ctx, canvas.width, canvas.height,
      elementsRef.current, cameraRef.current,
      paperColor, showGridRef.current, dpr,
      imageCacheRef.current,
      inProgressRef.current,
      selectedIdsRef.current.size > 0 ? selectedIdsRef.current : null,
      accentColor,
      selectionBoxRef.current,
    );
  }, []);

  // Re-render when state changes
  useEffect(() => {
    renderToCanvas();
  }, [elements, camera, showGrid, selectedIds, darkMode, selectionBox, renderToCanvas]);

  // -- Canvas resize --
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    renderToCanvas();
  }, [renderToCanvas]);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [resizeCanvas]);

  // -- Load active drawing on mount --
  useEffect(() => {
    const drawing = initState.drawings.find((d) => d.id === initState.activeId);
    if (drawing) {
      setElements(drawing.elements);
      setCamera(drawing.camera);
      preloadImages(drawing.elements);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // -- Persistence --
  const persistCurrentDrawing = useCallback(() => {
    const canvas = canvasRef.current;
    const thumbnail = canvas ? canvas.toDataURL("image/png", 0.3) : "";
    setDrawings((prev) => {
      const next = prev.map((d) =>
        d.id === activeId
          ? { ...d, elements: elementsRef.current, camera: cameraRef.current, thumbnail, updatedAt: Date.now() }
          : d,
      );
      saveDrawings(next);
      return next;
    });
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    const interval = setInterval(persistCurrentDrawing, 3000);
    return () => clearInterval(interval);
  }, [activeId, persistCurrentDrawing]);

  // -- Undo / Redo --
  const pushUndo = useCallback(() => {
    setUndoStack((prev) => {
      const next = [...prev, [...elementsRef.current]];
      if (next.length > MAX_HISTORY) next.shift();
      return next;
    });
    setRedoStack([]);
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const snapshot = next.pop()!;
      setRedoStack((r) => [...r, [...elementsRef.current]]);
      setElements(snapshot);
      setTimeout(persistCurrentDrawing, 0);
      return next;
    });
  }, [persistCurrentDrawing]);

  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const snapshot = next.pop()!;
      setUndoStack((u) => [...u, [...elementsRef.current]]);
      setElements(snapshot);
      setTimeout(persistCurrentDrawing, 0);
      return next;
    });
  }, [persistCurrentDrawing]);

  // -- Drawing management --
  const handleNewDrawing = useCallback(() => {
    persistCurrentDrawing();
    const id = crypto.randomUUID();
    const drawing: Drawing = {
      id, name: `Drawing ${drawings.length + 1}`,
      elements: [], camera: { x: -100, y: -100, zoom: 1 },
      thumbnail: "", updatedAt: Date.now(),
    };
    const next = [drawing, ...drawings];
    setDrawings(next);
    saveDrawings(next);
    setActiveId(id);
    setElements([]);
    setCamera({ x: -100, y: -100, zoom: 1 });
    setUndoStack([]);
    setRedoStack([]);
    setSelectedIds(new Set());
  }, [persistCurrentDrawing, drawings]);

  const handleSwitchDrawing = useCallback((id: string) => {
    if (id === activeId) return;
    persistCurrentDrawing();
    setActiveId(id);
    setUndoStack([]);
    setRedoStack([]);
    setSelectedIds(new Set());
    const drawing = drawings.find((d) => d.id === id);
    if (drawing) {
      setElements(drawing.elements);
      setCamera(drawing.camera);
      preloadImages(drawing.elements);
    }
  }, [activeId, persistCurrentDrawing, drawings, preloadImages]);

  const handleDeleteDrawing = useCallback((id: string) => {
    const next = drawings.filter((d) => d.id !== id);
    if (next.length === 0) return;
    setDrawings(next);
    saveDrawings(next);
    if (activeId === id && next[0]) handleSwitchDrawing(next[0].id);
  }, [activeId, drawings, handleSwitchDrawing]);

  const handleRenameDrawing = useCallback((id: string, name: string) => {
    const trimmed = name.trim() || "Untitled";
    const next = drawings.map((d) => (d.id === id ? { ...d, name: trimmed } : d));
    setDrawings(next);
    saveDrawings(next);
    setEditingId(null);
  }, [drawings]);

  const handleClear = useCallback(() => {
    pushUndo();
    setElements([]);
    setSelectedIds(new Set());
    setTimeout(persistCurrentDrawing, 0);
  }, [pushUndo, persistCurrentDrawing]);

  const zoomToFit = useCallback(() => {
    const els = elementsRef.current;
    if (els.length === 0) {
      setCamera({ x: -100, y: -100, zoom: 1 });
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of els) {
      const b = getElementBounds(el);
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.width > maxX) maxX = b.x + b.width;
      if (b.y + b.height > maxY) maxY = b.y + b.height;
    }
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const viewW = (canvas?.width ?? 800) / dpr;
    const viewH = (canvas?.height ?? 600) / dpr;
    const padding = 40;
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    if (contentW <= 0 || contentH <= 0) return;
    const zoom = clampZoom(Math.min((viewW - padding * 2) / contentW, (viewH - padding * 2) / contentH));
    const cx = minX - (viewW / zoom - contentW) / 2;
    const cy = minY - (viewH / zoom - contentH) / 2;
    setCamera({ x: cx, y: cy, zoom });
  }, []);

  const deleteSelected = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.size === 0) return;
    pushUndo();
    setElements((prev) => prev.filter((el) => !ids.has(el.id)));
    setSelectedIds(new Set());
  }, [pushUndo]);

  const duplicateSelected = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.size === 0) return;
    pushUndo();
    const offset = 20;
    const newIds = new Set<string>();
    setElements((prev) => {
      const clones: SceneElement[] = [];
      for (const el of prev) {
        if (!ids.has(el.id)) continue;
        const newId = crypto.randomUUID();
        newIds.add(newId);
        if (el.type === "sticky" || el.type === "image" || el.type === "text") {
          clones.push({ ...el, id: newId, pos: { x: el.pos.x + offset, y: el.pos.y + offset } });
        } else if (el.type === "path") {
          clones.push({ ...el, id: newId, points: el.points.map((p) => ({ x: p.x + offset, y: p.y + offset })) });
        } else {
          clones.push({ ...el, id: newId, start: { x: el.start.x + offset, y: el.start.y + offset }, end: { x: el.end.x + offset, y: el.end.y + offset } });
        }
      }
      return [...prev, ...clones];
    });
    setSelectedIds(newIds);
  }, [pushUndo]);

  const bringForward = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.size === 0) return;
    pushUndo();
    setElements((prev) => {
      const next = [...prev];
      for (let i = next.length - 2; i >= 0; i--) {
        const el = next[i];
        if (el && ids.has(el.id) && i < next.length - 1) {
          [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
        }
      }
      return next;
    });
  }, [pushUndo]);

  const sendBackward = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.size === 0) return;
    pushUndo();
    setElements((prev) => {
      const next = [...prev];
      for (let i = 1; i < next.length; i++) {
        const el = next[i];
        if (el && ids.has(el.id)) {
          [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
        }
      }
      return next;
    });
  }, [pushUndo]);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(elementsRef.current.map((el) => el.id)));
    setTool("select");
  }, []);

  const copySelected = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.size === 0) return;
    clipboardRef.current = elementsRef.current.filter((el) => ids.has(el.id));
  }, []);

  const pasteClipboard = useCallback(() => {
    const items = clipboardRef.current;
    if (items.length === 0) return;
    pushUndo();
    const offset = 20;
    const newIds = new Set<string>();
    const clones: SceneElement[] = items.map((el) => {
      const newId = crypto.randomUUID();
      newIds.add(newId);
      if (el.type === "sticky" || el.type === "image" || el.type === "text") {
        return { ...el, id: newId, pos: { x: el.pos.x + offset, y: el.pos.y + offset } };
      }
      if (el.type === "path") {
        return { ...el, id: newId, points: el.points.map((p) => ({ x: p.x + offset, y: p.y + offset })) };
      }
      return { ...el, id: newId, start: { x: el.start.x + offset, y: el.start.y + offset }, end: { x: el.end.x + offset, y: el.end.y + offset } };
    });
    setElements((prev) => [...prev, ...clones]);
    setSelectedIds(newIds);
  }, [pushUndo]);

  const handleDownloadVisible = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const drawing = drawings.find((d) => d.id === activeId);
    const link = document.createElement("a");
    link.download = (drawing?.name || "whiteboard") + "-visible.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [activeId, drawings]);

  const handleDownloadFull = useCallback(() => {
    const paperColor = getCssVar("--color-paper");
    const dataUrl = exportFullBoard(elementsRef.current, paperColor, imageCacheRef.current);
    if (!dataUrl) return;
    const drawing = drawings.find((d) => d.id === activeId);
    const link = document.createElement("a");
    link.download = (drawing?.name || "whiteboard") + "-full.png";
    link.href = dataUrl;
    link.click();
  }, [activeId, drawings]);

  const handleDownloadSvg = useCallback(() => {
    const paperColor = getCssVar("--color-paper");
    const svg = exportSvg(elementsRef.current, paperColor);
    if (!svg) return;
    const drawing = drawings.find((d) => d.id === activeId);
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const link = document.createElement("a");
    link.download = (drawing?.name || "whiteboard") + ".svg";
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  }, [activeId, drawings]);

  // -- Text commit --
  const commitText = useCallback(() => {
    if (!textEditing || !textValue.trim()) {
      setTextEditing(null);
      setTextValue("");
      return;
    }
    pushUndo();
    const el: SceneElement = {
      id: crypto.randomUUID(), type: "text",
      pos: textEditing, text: textValue.trim(),
      color: colorRef.current, fontSize,
      bold, italic,
    };
    setElements((prev) => [...prev, el]);
    setTextEditing(null);
    setTextValue("");
  }, [textEditing, textValue, fontSize, bold, italic, pushUndo]);

  // -- Sticky commit --
  const commitSticky = useCallback(() => {
    if (!stickyEditing) return;
    const updated = elementsRef.current.map((el) =>
      el.id === stickyEditing.id && el.type === "sticky"
        ? { ...el, text: stickyText }
        : el,
    );
    setElements(updated);
    setStickyEditing(null);
    setStickyText("");
  }, [stickyEditing, stickyText]);

  // -- Pointer helpers --
  const getCanvasPos = useCallback((e: React.PointerEvent | React.MouseEvent | PointerEvent | MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const cancelDrawing = useCallback(() => {
    if (isDrawingRef.current && inProgressRef.current) {
      setUndoStack((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
      inProgressRef.current = null;
      isDrawingRef.current = false;
      shapeStartRef.current = null;
      renderToCanvas();
    }
  }, [renderToCanvas]);

  // -- Resize handle hit test --
  const hitResizeHandle = useCallback((screenX: number, screenY: number): { elementId: string; corner: string } | null => {
    const cam = cameraRef.current;
    const ids = selectedIdsRef.current;
    if (ids.size !== 1) return null;
    const id = [...ids][0]!;
    const el = elementsRef.current.find((e) => e.id === id);
    if (!el) return null;
    const b = getElementBounds(el);
    const pad = 4 / cam.zoom;
    const handleSize = 8 / cam.zoom;
    const corners = [
      { name: "nw", x: b.x - pad, y: b.y - pad },
      { name: "ne", x: b.x + b.width + pad, y: b.y - pad },
      { name: "sw", x: b.x - pad, y: b.y + b.height + pad },
      { name: "se", x: b.x + b.width + pad, y: b.y + b.height + pad },
    ];
    const worldPos = screenToWorld(screenX, screenY, cam);
    for (const c of corners) {
      if (Math.abs(worldPos.x - c.x) <= handleSize && Math.abs(worldPos.y - c.y) <= handleSize) {
        return { elementId: id, corner: c.name };
      }
    }
    return null;
  }, []);

  // -- Pointer handlers --
  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const screenPos = getCanvasPos(e);

    // Track active pointers for multi-touch
    activePtrsRef.current.set(e.pointerId, screenPos);

    // Two-finger pinch/pan
    if (activePtrsRef.current.size >= 2) {
      cancelDrawing();
      isDraggingRef.current = false;
      isPanningRef.current = false;
      const pts = [...activePtrsRef.current.values()];
      const [a, b] = [pts[0]!, pts[1]!];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      pinchRef.current = {
        dist,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        cam: { ...cameraRef.current },
      };
      return;
    }

    const cam = cameraRef.current;
    const worldPos = screenToWorld(screenPos.x, screenPos.y, cam);

    // Pan: middle button or space held
    if (e.button === 1 || spaceHeldRef.current) {
      isPanningRef.current = true;
      panStartRef.current = { sx: screenPos.x, sy: screenPos.y, cx: cam.x, cy: cam.y };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
      return;
    }

    const currentTool = toolRef.current;

    // Select tool
    if (currentTool === "select") {
      // Check resize handle first
      const resizeHit = hitResizeHandle(screenPos.x, screenPos.y);
      if (resizeHit) {
        isResizingRef.current = true;
        resizeCornerRef.current = resizeHit.corner;
        const el = elementsRef.current.find((e2) => e2.id === resizeHit.elementId);
        if (el) {
          resizeOrigBoundsRef.current = getElementBounds(el);
          resizeOrigElementRef.current = el;
        }
        pushUndo();
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      const hit = hitTest(elementsRef.current, worldPos.x, worldPos.y);
      if (hit) {
        const currentIds = selectedIdsRef.current;
        if (e.shiftKey && currentIds.size > 0) {
          // Shift-click: toggle in multi-selection
          const next = new Set(currentIds);
          if (next.has(hit.id)) next.delete(hit.id);
          else next.add(hit.id);
          setSelectedIds(next);
        } else if (!currentIds.has(hit.id)) {
          setSelectedIds(new Set([hit.id]));
        }
        isDraggingRef.current = true;
        const b2 = getElementBounds(hit);
        dragOffsetRef.current = { x: worldPos.x - b2.x, y: worldPos.y - b2.y };
        pushUndo();
        canvas.setPointerCapture(e.pointerId);
      } else {
        // Start selection box
        setSelectedIds(new Set());
        selBoxStartRef.current = worldPos;
        canvas.setPointerCapture(e.pointerId);
      }
      return;
    }

    // Text tool
    if (currentTool === "text") {
      if (textEditing) commitText();
      setTextEditing(worldPos);
      setTextValue("");
      return;
    }

    // Fill tool
    if (currentTool === "fill") {
      const displayCanvas = canvasRef.current;
      if (!displayCanvas) return;
      const dpr = window.devicePixelRatio || 1;
      const cw = displayCanvas.width;
      const ch = displayCanvas.height;
      const offscreen = document.createElement("canvas");
      offscreen.width = cw;
      offscreen.height = ch;
      const octx = offscreen.getContext("2d")!;
      const paperColor = getCssVar("--color-paper");
      renderScene(octx, cw, ch, elementsRef.current, cam, paperColor, false, dpr, imageCacheRef.current);
      floodFill(octx, Math.round(screenPos.x * dpr), Math.round(screenPos.y * dpr), colorRef.current, cw, ch);
      const dataUrl = offscreen.toDataURL("image/png", 0.9);
      const viewW = cw / dpr;
      const viewH = ch / dpr;
      const worldX = cam.x;
      const worldY = cam.y;
      const worldW = viewW / cam.zoom;
      const worldH = viewH / cam.zoom;
      pushUndo();
      const imageEl: SceneElement = {
        id: crypto.randomUUID(), type: "image",
        pos: { x: worldX, y: worldY }, width: worldW, height: worldH,
        dataUrl,
      };
      imageCacheRef.current.set(dataUrl, (() => { const img = new Image(); img.src = dataUrl; return img; })());
      setElements([imageEl]);
      persistCurrentDrawing();
      return;
    }

    // Sticky tool
    if (currentTool === "sticky") {
      pushUndo();
      const id = crypto.randomUUID();
      const sticky: SceneElement = {
        id, type: "sticky",
        pos: worldPos, width: 180, height: 140,
        text: "", color: stickyColor,
      };
      setElements((prev) => [...prev, sticky]);
      setStickyEditing({ id, pos: worldPos, width: 180, height: 140 });
      setStickyText("");
      return;
    }

    // Eraser tool - delete objects on click
    if (currentTool === "eraser") {
      const hit = hitTest(elementsRef.current, worldPos.x, worldPos.y);
      if (hit) {
        pushUndo();
        setElements((prev) => prev.filter((el) => el.id !== hit.id));
      }
      canvas.setPointerCapture(e.pointerId);
      isDrawingRef.current = true;
      inProgressRef.current = null;
      return;
    }

    // Drawing tools
    canvas.setPointerCapture(e.pointerId);
    pushUndo();
    isDrawingRef.current = true;

    if (SHAPE_TOOLS.includes(currentTool)) {
      shapeStartRef.current = worldPos;
      const shapeEl: SceneElement = (() => {
        const base = { id: crypto.randomUUID(), start: worldPos, end: worldPos, color: colorRef.current, strokeWidth: brushSizeRef.current, opacity: opacityRef.current };
        switch (currentTool) {
          case "line": return { ...base, type: "line" as const };
          case "arrow": return { ...base, type: "arrow" as const };
          case "rect": return { ...base, type: "rect" as const, filled };
          case "ellipse": return { ...base, type: "ellipse" as const, filled };
          default: return { ...base, type: "line" as const };
        }
      })();
      inProgressRef.current = shapeEl;
    } else {
      // Pen
      const pressure = e.pressure > 0 ? e.pressure : 0.5;
      const pathEl: SceneElement = {
        id: crypto.randomUUID(), type: "path",
        points: [worldPos], pressures: [pressure],
        color: colorRef.current,
        strokeWidth: brushSizeRef.current,
        opacity: opacityRef.current,
        eraser: false,
      };
      inProgressRef.current = pathEl;
    }
    renderToCanvas();
  }, [getCanvasPos, pushUndo, commitText, textEditing, stickyColor, renderToCanvas, cancelDrawing, hitResizeHandle, filled, persistCurrentDrawing]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const screenPos = getCanvasPos(e);

    // Update tracked pointer position
    if (activePtrsRef.current.has(e.pointerId)) {
      activePtrsRef.current.set(e.pointerId, screenPos);
    }

    // Multi-touch pinch/pan
    if (pinchRef.current && activePtrsRef.current.size >= 2) {
      const pts = [...activePtrsRef.current.values()];
      const [a, b] = [pts[0]!, pts[1]!];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const ps = pinchRef.current;
      const zoomRatio = dist / Math.max(ps.dist, 1);
      const newZoom = clampZoom(ps.cam.zoom * zoomRatio);
      const worldMid = screenToWorld(ps.midX, ps.midY, ps.cam);
      const newCamX = worldMid.x - midX / newZoom;
      const newCamY = worldMid.y - midY / newZoom;
      setCamera({ x: newCamX, y: newCamY, zoom: newZoom });
      return;
    }

    const cam = cameraRef.current;

    if (isPanningRef.current && panStartRef.current) {
      const dx = (screenPos.x - panStartRef.current.sx) / cam.zoom;
      const dy = (screenPos.y - panStartRef.current.sy) / cam.zoom;
      setCamera({ ...cam, x: panStartRef.current.cx - dx, y: panStartRef.current.cy - dy });
      return;
    }

    // Resize handle drag
    if (isResizingRef.current && resizeOrigBoundsRef.current && resizeOrigElementRef.current && resizeCornerRef.current) {
      const worldPos = screenToWorld(screenPos.x, screenPos.y, cam);
      const origB = resizeOrigBoundsRef.current;
      const el = resizeOrigElementRef.current;
      const corner = resizeCornerRef.current;

      let newX = origB.x;
      let newY = origB.y;
      let newW = origB.width;
      let newH = origB.height;

      if (corner === "se") {
        newW = Math.max(10, worldPos.x - origB.x);
        newH = Math.max(10, worldPos.y - origB.y);
      } else if (corner === "sw") {
        newX = Math.min(worldPos.x, origB.x + origB.width - 10);
        newW = origB.x + origB.width - newX;
        newH = Math.max(10, worldPos.y - origB.y);
      } else if (corner === "ne") {
        newW = Math.max(10, worldPos.x - origB.x);
        newY = Math.min(worldPos.y, origB.y + origB.height - 10);
        newH = origB.y + origB.height - newY;
      } else if (corner === "nw") {
        newX = Math.min(worldPos.x, origB.x + origB.width - 10);
        newY = Math.min(worldPos.y, origB.y + origB.height - 10);
        newW = origB.x + origB.width - newX;
        newH = origB.y + origB.height - newY;
      }

      setElements((prev) =>
        prev.map((prevEl) => {
          if (prevEl.id !== el.id) return prevEl;
          if (prevEl.type === "sticky" || prevEl.type === "image") {
            return { ...prevEl, pos: { x: newX, y: newY }, width: newW, height: newH };
          }
          if (prevEl.type === "rect" || prevEl.type === "ellipse") {
            return { ...prevEl, start: { x: newX, y: newY }, end: { x: newX + newW, y: newY + newH } };
          }
          return prevEl;
        }),
      );
      return;
    }

    // Selection box
    if (selBoxStartRef.current && toolRef.current === "select") {
      const worldPos = screenToWorld(screenPos.x, screenPos.y, cam);
      const box = normalizeRect(selBoxStartRef.current, worldPos);
      setSelectionBox(box);
      return;
    }

    if (isDraggingRef.current && selectedIdsRef.current.size > 0) {
      let worldPos = screenToWorld(screenPos.x, screenPos.y, cam);
      const firstId = [...selectedIdsRef.current][0]!;
      const firstEl = elementsRef.current.find((el2) => el2.id === firstId);
      if (!firstEl) return;
      const firstB = getElementBounds(firstEl);
      let targetX = worldPos.x - dragOffsetRef.current.x;
      let targetY = worldPos.y - dragOffsetRef.current.y;
      if (e.shiftKey || snapToGrid) {
        const snapped = snapPoint({ x: targetX, y: targetY });
        targetX = snapped.x;
        targetY = snapped.y;
      }
      const dx = targetX - firstB.x;
      const dy = targetY - firstB.y;
      if (dx === 0 && dy === 0) return;

      setElements((prev) =>
        prev.map((el) => {
          if (!selectedIdsRef.current.has(el.id)) return el;
          if (el.type === "sticky" || el.type === "image" || el.type === "text") {
            return { ...el, pos: { x: el.pos.x + dx, y: el.pos.y + dy } };
          }
          if (el.type === "path") {
            return { ...el, points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
          }
          if ("start" in el) {
            return { ...el, start: { x: el.start.x + dx, y: el.start.y + dy }, end: { x: el.end.x + dx, y: el.end.y + dy } };
          }
          return el;
        }),
      );
      return;
    }

    // Eraser tool: delete objects while dragging
    if (isDrawingRef.current && toolRef.current === "eraser") {
      const worldPos = screenToWorld(screenPos.x, screenPos.y, cam);
      const hit = hitTest(elementsRef.current, worldPos.x, worldPos.y);
      if (hit) {
        setElements((prev) => prev.filter((el) => el.id !== hit.id));
      }
      return;
    }

    if (!isDrawingRef.current || !inProgressRef.current) return;
    let worldPos = screenToWorld(screenPos.x, screenPos.y, cam);
    if (e.shiftKey || snapToGrid) worldPos = snapPoint(worldPos);
    const ip = inProgressRef.current;

    if (ip.type === "path") {
      ip.points.push(worldPos);
      if (ip.pressures) ip.pressures.push(e.pressure > 0 ? e.pressure : 0.5);
    } else if ("start" in ip) {
      (ip as { end: Point }).end = worldPos;
    }
    renderToCanvas();
  }, [getCanvasPos, renderToCanvas, snapToGrid]);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas) canvas.releasePointerCapture(e.pointerId);

    // Remove from tracked pointers
    activePtrsRef.current.delete(e.pointerId);
    if (activePtrsRef.current.size < 2) {
      pinchRef.current = null;
    }
    if (activePtrsRef.current.size > 0 && !isDrawingRef.current && !isDraggingRef.current && !isPanningRef.current) {
      return;
    }

    if (isPanningRef.current) {
      isPanningRef.current = false;
      panStartRef.current = null;
      if (canvas) canvas.style.cursor = "";
      return;
    }

    // Resize end
    if (isResizingRef.current) {
      isResizingRef.current = false;
      resizeCornerRef.current = null;
      resizeOrigBoundsRef.current = null;
      resizeOrigElementRef.current = null;
      persistCurrentDrawing();
      return;
    }

    // Selection box end
    if (selBoxStartRef.current) {
      const worldPos = screenToWorld(getCanvasPos(e).x, getCanvasPos(e).y, cameraRef.current);
      const box = normalizeRect(selBoxStartRef.current, worldPos);
      if (box.width > 2 || box.height > 2) {
        const ids = boxSelect(elementsRef.current, box);
        setSelectedIds(new Set(ids));
      }
      selBoxStartRef.current = null;
      setSelectionBox(null);
      return;
    }

    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      persistCurrentDrawing();
      return;
    }

    // Eraser tool
    if (isDrawingRef.current && toolRef.current === "eraser") {
      isDrawingRef.current = false;
      persistCurrentDrawing();
      return;
    }

    if (!isDrawingRef.current || !inProgressRef.current) return;

    const ip = inProgressRef.current;

    // Finalize shape endpoint
    if ("start" in ip) {
      const screenPos = getCanvasPos(e);
      const worldPos = screenToWorld(screenPos.x, screenPos.y, cameraRef.current);
      (ip as { end: Point }).end = worldPos;
    }

    // Discard zero-size shapes
    const discard =
      ("start" in ip && ip.start.x === (ip as { end: Point }).end.x && ip.start.y === (ip as { end: Point }).end.y) ||
      (ip.type === "path" && ip.points.length <= 1);

    if (discard) {
      setUndoStack((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
      inProgressRef.current = null;
      isDrawingRef.current = false;
      shapeStartRef.current = null;
      renderToCanvas();
      return;
    }

    setElements((prev) => [...prev, ip]);
    inProgressRef.current = null;
    isDrawingRef.current = false;
    shapeStartRef.current = null;
    renderToCanvas();
    persistCurrentDrawing();
  }, [getCanvasPos, renderToCanvas, persistCurrentDrawing]);

  // -- Wheel: zoom (ctrl/pinch) or pan (scroll) --
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const cam = cameraRef.current;

      if (e.ctrlKey || e.metaKey) {
        const delta = -e.deltaY * 0.01;
        const newZoom = clampZoom(cam.zoom * (1 + delta));
        const worldBefore = screenToWorld(sx, sy, cam);
        const newCam = { ...cam, zoom: newZoom };
        newCam.x = worldBefore.x - sx / newZoom;
        newCam.y = worldBefore.y - sy / newZoom;
        setCamera(newCam);
      } else {
        setCamera({
          ...cam,
          x: cam.x + e.deltaX / cam.zoom,
          y: cam.y + e.deltaY / cam.zoom,
        });
      }
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, []);

  // -- Keyboard shortcuts --
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (textEditing || stickyEditing || editingId) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.key === " ") { e.preventDefault(); spaceHeldRef.current = true; return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo(); else handleUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        persistCurrentDrawing();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        e.preventDefault();
        copySelected();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "v" && clipboardRef.current.length > 0) {
        e.preventDefault();
        pasteClipboard();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "d") {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "0") {
        e.preventDefault();
        setCamera({ x: -100, y: -100, zoom: 1 });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "1") {
        e.preventDefault();
        zoomToFit();
        return;
      }
      if (e.key === "Escape") {
        setSelectedIds(new Set());
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelected();
        return;
      }

      if (e.key === "]") { bringForward(); return; }
      if (e.key === "[") { sendBackward(); return; }

      // Zoom +/-
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        setCamera((cam) => {
          const newZoom = clampZoom(cam.zoom * 1.2);
          return { ...cam, zoom: newZoom };
        });
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setCamera((cam) => {
          const newZoom = clampZoom(cam.zoom / 1.2);
          return { ...cam, zoom: newZoom };
        });
        return;
      }

      const shortcuts: Record<string, Tool> = {
        v: "select", p: "pen", e: "eraser", l: "line", a: "arrow",
        r: "rect", o: "ellipse", t: "text", f: "fill", s: "sticky",
      };
      if (!e.metaKey && !e.ctrlKey && shortcuts[e.key]) {
        setTool(shortcuts[e.key]!);
        setSelectedIds(new Set());
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") spaceHeldRef.current = false;
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", handler); window.removeEventListener("keyup", up); };
  }, [handleUndo, handleRedo, pushUndo, duplicateSelected, zoomToFit, bringForward, sendBackward, deleteSelected, persistCurrentDrawing, copySelected, pasteClipboard, textEditing, stickyEditing, editingId]);

  // -- Image paste --
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (!item.type.startsWith("image/")) continue;
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const img = new Image();
          img.onload = () => {
            let w = img.naturalWidth;
            let h = img.naturalHeight;
            const maxDim = 800;
            if (w > maxDim || h > maxDim) {
              const sc = maxDim / Math.max(w, h);
              w = Math.round(w * sc);
              h = Math.round(h * sc);
            }
            const resizeCanvasEl = document.createElement("canvas");
            resizeCanvasEl.width = w;
            resizeCanvasEl.height = h;
            const rCtx = resizeCanvasEl.getContext("2d")!;
            rCtx.drawImage(img, 0, 0, w, h);
            const resizedUrl = resizeCanvasEl.toDataURL("image/png", 0.85);

            const cam = cameraRef.current;
            const canvasEl = canvasRef.current;
            const viewW = (canvasEl?.width ?? 800) / (window.devicePixelRatio || 1);
            const viewH = (canvasEl?.height ?? 600) / (window.devicePixelRatio || 1);
            const cx = cam.x + viewW / cam.zoom / 2 - w / 2;
            const cy = cam.y + viewH / cam.zoom / 2 - h / 2;

            pushUndo();
            const imageEl: SceneElement = {
              id: crypto.randomUUID(), type: "image",
              pos: { x: cx, y: cy }, width: w, height: h, dataUrl: resizedUrl,
            };
            imageCacheRef.current.set(resizedUrl, img);
            setElements((prev) => [...prev, imageEl]);
          };
          img.src = dataUrl;
        };
        reader.readAsDataURL(blob);
        break;
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [pushUndo]);

  // -- Double-click to edit sticky --
  const onDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (toolRef.current !== "select") return;
    const screenPos = getCanvasPos(e);
    const worldPos = screenToWorld(screenPos.x, screenPos.y, cameraRef.current);
    const hit = hitTest(elementsRef.current, worldPos.x, worldPos.y);
    if (hit?.type === "sticky") {
      setStickyEditing({ id: hit.id, pos: hit.pos, width: hit.width, height: hit.height });
      setStickyText(hit.text);
    }
  }, [getCanvasPos]);

  // Focus inputs when editing
  useEffect(() => { if (textEditing && textInputRef.current) textInputRef.current.focus(); }, [textEditing]);
  useEffect(() => { if (stickyEditing && stickyInputRef.current) stickyInputRef.current.focus(); }, [stickyEditing]);

  // -- Cursor --
  const getCursor = (): string => {
    if (spaceHeldRef.current || isPanningRef.current) return "grab";
    if (tool === "select") return selectedIds.size > 0 ? "move" : "default";
    if (tool === "text") return "text";
    if (tool === "fill") return "crosshair";
    if (tool === "sticky") return "crosshair";
    if (tool === "eraser") return "crosshair";
    if (SHAPE_TOOLS.includes(tool)) return "crosshair";
    if (tool === "pen") {
      const r = Math.max(brushSize / 2, 1.5);
      const svgSize = Math.ceil(r * 2 + 4);
      const center = svgSize / 2;
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${svgSize}' height='${svgSize}'><circle cx='${center}' cy='${center}' r='${r}' fill='none' stroke='%23333' stroke-width='1.5'/></svg>`;
      return `url("data:image/svg+xml,${svg}") ${center} ${center}, crosshair`;
    }
    return "default";
  };

  // -- Styles --
  const btnStyle: React.CSSProperties = {
    padding: "0.5rem 0.75rem", borderRadius: "var(--radius-btn)",
    border: "1px solid var(--color-line)", background: "var(--color-panel)",
    color: "var(--color-ink)", cursor: "pointer", fontSize: "0.8125rem",
    fontFamily: "inherit", lineHeight: 1,
  };
  const activeBtnStyle: React.CSSProperties = {
    ...btnStyle, background: "var(--color-accent)", color: "#fff", borderColor: "var(--color-accent)",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: "0.6875rem", color: "var(--color-muted)", marginBottom: "0.375rem",
    fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em",
  };

  const toolBtn = (t: Tool, label: string, shortcut: string) => (
    <button key={t} onClick={() => { setTool(t); setSelectedIds(new Set()); }}
      style={tool === t ? activeBtnStyle : btnStyle} title={`${label} (${shortcut.toUpperCase()})`}>
      {label}
    </button>
  );

  const zoomPercent = Math.round(camera.zoom * 100);

  const toolbar = (
    <>
      {/* Drawings */}
      <div>
        <div style={labelStyle}>Boards</div>
        <button onClick={handleNewDrawing} style={{ ...btnStyle, width: "100%", marginBottom: "0.5rem" }}>
          + New
        </button>
        <div className="flex flex-col gap-0.5" style={{ maxHeight: "10rem", overflowY: "auto" }}>
          {drawings.map((d) => (
            <div key={d.id} className="flex items-center gap-1.5"
              style={{
                padding: "0.375rem 0.5rem", borderRadius: "var(--radius-btn)", cursor: "pointer", fontSize: "0.8125rem",
                background: d.id === activeId ? "var(--color-accent)" : "transparent",
                color: d.id === activeId ? "#fff" : "var(--color-ink)",
              }}>
              {d.thumbnail && (
                <img src={d.thumbnail} alt="" style={{
                  width: "2rem", height: "1.5rem", objectFit: "cover", borderRadius: "0.25rem", flexShrink: 0,
                  border: "1px solid", borderColor: d.id === activeId ? "rgba(255,255,255,0.3)" : "var(--color-line)",
                }} />
              )}
              {editingId === d.id ? (
                <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => handleRenameDrawing(d.id, editName)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleRenameDrawing(d.id, editName); if (e.key === "Escape") setEditingId(null); }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ flex: 1, background: "transparent", border: "1px solid", borderColor: d.id === activeId ? "rgba(255,255,255,0.5)" : "var(--color-line)", borderRadius: "0.25rem", padding: "0.125rem 0.25rem", color: "inherit", fontSize: "inherit", fontFamily: "inherit", outline: "none", minWidth: 0 }} />
              ) : (
                <span className="flex-1 truncate" onClick={() => handleSwitchDrawing(d.id)}
                  onDoubleClick={() => { setEditingId(d.id); setEditName(d.name); }} style={{ minWidth: 0 }}>
                  {d.name}
                </span>
              )}
              {drawings.length > 1 && (
                <button onClick={(ev) => { ev.stopPropagation(); handleDeleteDrawing(d.id); }} title="Delete"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.6, fontSize: "0.75rem", padding: "0 0.25rem", lineHeight: 1, flexShrink: 0 }}>
                  x
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Tools */}
      <div>
        <div style={labelStyle}>Tool</div>
        <div className="flex flex-wrap gap-1.5">
          {toolBtn("select", "Select", "v")}
          {toolBtn("pen", "Pen", "p")}
          {toolBtn("eraser", "Eraser", "e")}
          {toolBtn("line", "Line", "l")}
          {toolBtn("arrow", "Arrow", "a")}
          {toolBtn("rect", "Rect", "r")}
          {toolBtn("ellipse", "Ellipse", "o")}
          {toolBtn("text", "Text", "t")}
          {toolBtn("fill", "Fill", "f")}
          {toolBtn("sticky", "Sticky", "s")}
        </div>
      </div>

      {/* Color */}
      <div>
        <div style={labelStyle}>Color</div>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button key={c} onClick={() => { setColor(c); }} title={c}
              style={{ width: "1.75rem", height: "1.75rem", borderRadius: "var(--radius-btn)", background: c, cursor: "pointer", padding: 0, boxSizing: "border-box", border: color === c ? "2.5px solid var(--color-accent)" : c === "#ffffff" ? "2px solid var(--color-line)" : "2px solid var(--color-line)" }} />
          ))}
          <label title="Custom color" style={{ width: "1.75rem", height: "1.75rem", borderRadius: "var(--radius-btn)", border: "2px dashed var(--color-line)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", color: "var(--color-muted)", position: "relative", overflow: "hidden" }}>
            +
            <input type="color" value={color} onChange={(e) => { setColor(e.target.value); }}
              style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
          </label>
        </div>
      </div>

      {/* Pen settings */}
      {(tool === "pen" || SHAPE_TOOLS.includes(tool)) && (
        <div>
          <div style={labelStyle}>Width</div>
          <div className="flex gap-1.5">
            {BRUSH_WIDTHS.map((bw) => (
              <button key={bw.value} onClick={() => setBrushSize(bw.value)}
                style={brushSize === bw.value ? activeBtnStyle : btnStyle}>
                {bw.label}
              </button>
            ))}
          </div>
          <div style={{ ...labelStyle, marginTop: "0.5rem" }}>Opacity: {Math.round(opacity * 100)}%</div>
          <input type="range" min={10} max={100} value={Math.round(opacity * 100)}
            onChange={(e) => setOpacity(Number(e.target.value) / 100)}
            style={{ width: "100%", accentColor: "var(--color-accent)" }} />
        </div>
      )}

      {/* Shape fill toggle */}
      {(tool === "rect" || tool === "ellipse") && (
        <div className="flex gap-1.5">
          <button onClick={() => setFilled(false)} style={!filled ? activeBtnStyle : btnStyle}>Outline</button>
          <button onClick={() => setFilled(true)} style={filled ? activeBtnStyle : btnStyle}>Filled</button>
        </div>
      )}

      {/* Text settings */}
      {tool === "text" && (
        <div>
          <div style={labelStyle}>Font: {fontSize}px</div>
          <input type="range" min={10} max={72} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--color-accent)" }} />
          <div className="flex gap-1.5 mt-2">
            <button onClick={() => setBold(!bold)} style={bold ? activeBtnStyle : btnStyle}>Bold</button>
            <button onClick={() => setItalic(!italic)} style={italic ? activeBtnStyle : btnStyle}>Italic</button>
          </div>
        </div>
      )}

      {/* Sticky colors */}
      {tool === "sticky" && (
        <div>
          <div style={labelStyle}>Sticky Color</div>
          <div className="flex flex-wrap gap-1.5">
            {STICKY_COLORS.map((c) => (
              <button key={c} onClick={() => setStickyColor(c)}
                style={{ width: "1.75rem", height: "1.75rem", borderRadius: "var(--radius-btn)", background: c, cursor: "pointer", padding: 0, border: stickyColor === c ? "2.5px solid var(--color-accent)" : "2px solid var(--color-line)" }} />
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5">
        <button onClick={handleUndo} style={btnStyle} disabled={undoStack.length === 0} title="Undo (Ctrl+Z)">Undo</button>
        <button onClick={handleRedo} style={btnStyle} disabled={redoStack.length === 0} title="Redo (Ctrl+Shift+Z)">Redo</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button onClick={handleClear} style={btnStyle}>Clear</button>
        <button onClick={handleDownloadVisible} style={btnStyle} title="Export visible area as PNG">PNG</button>
        <button onClick={handleDownloadFull} style={btnStyle} title="Export full board as PNG">Full</button>
        <button onClick={handleDownloadSvg} style={btnStyle} title="Export as SVG (vector)">SVG</button>
      </div>

      {/* Selection actions */}
      {selectedIds.size > 0 && (
        <div>
          <div style={labelStyle}>Selected ({selectedIds.size})</div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={duplicateSelected} style={btnStyle} title="Duplicate (Ctrl+D)">Dup</button>
            <button onClick={bringForward} style={btnStyle} title="Bring Forward (])">Fwd</button>
            <button onClick={sendBackward} style={btnStyle} title="Send Backward ([)">Back</button>
            <button onClick={deleteSelected} style={btnStyle} title="Delete (Backspace)">Del</button>
          </div>
        </div>
      )}

      {/* View */}
      <div>
        <div style={labelStyle}>View</div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setShowGrid(!showGrid)} style={showGrid ? activeBtnStyle : btnStyle}>Grid</button>
          <button onClick={() => setSnapToGrid(!snapToGrid)} style={snapToGrid ? activeBtnStyle : btnStyle} title="Snap to grid (or hold Shift)">Snap</button>
          <button onClick={() => setDarkMode(darkMode === "dark" ? "light" : darkMode === "light" ? "auto" : "dark")}
            style={btnStyle}>
            {darkMode === "dark" ? "Dark" : darkMode === "light" ? "Light" : "Auto"}
          </button>
          <button onClick={zoomToFit} style={btnStyle} title="Zoom to Fit (Ctrl+1)">Fit</button>
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginTop: "0.5rem" }}>
          Zoom: {zoomPercent}%
          {camera.zoom !== 1 && (
            <button onClick={() => setCamera((c) => ({ ...c, zoom: 1, x: -100, y: -100 }))}
              style={{ marginLeft: "0.5rem", background: "none", border: "none", color: "var(--color-accent)", cursor: "pointer", fontSize: "inherit", fontFamily: "inherit", textDecoration: "underline" }}>
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Shortcuts help */}
      <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)", lineHeight: 1.6 }}>
        <div style={{ ...labelStyle, marginBottom: "0.25rem" }}>Shortcuts</div>
        V Select, P Pen, E Eraser<br />
        L Line, R Rect, O Ellipse<br />
        A Arrow, T Text, S Sticky<br />
        Space+drag Pan, +/- Zoom<br />
        Ctrl+Z Undo, Ctrl+Shift+Z Redo<br />
        Ctrl+S Save, Del Delete
      </div>
    </>
  );

  // -- Mobile toolbar (compact) --
  const mobileToolBtn = (t: Tool, label: string) => (
    <button key={t} onClick={() => { setTool(t); setSelectedIds(new Set()); }}
      style={{ ...(tool === t ? activeBtnStyle : btnStyle), padding: "0.375rem 0.5rem", fontSize: "0.75rem", flexShrink: 0 }}>
      {label}
    </button>
  );

  const mobileBtnStyle = { ...btnStyle, padding: "0.375rem 0.5rem", fontSize: "0.75rem", flexShrink: 0 as const };

  // -- Sticky overlay position --
  const stickyScreenPos = stickyEditing ? (() => {
    const cam = cameraRef.current;
    return {
      left: (stickyEditing.pos.x - cam.x) * cam.zoom,
      top: (stickyEditing.pos.y - cam.y) * cam.zoom,
      width: stickyEditing.width * cam.zoom,
      height: stickyEditing.height * cam.zoom,
    };
  })() : null;

  // -- Text overlay position --
  const textScreenPos = textEditing ? (() => {
    const cam = cameraRef.current;
    return {
      left: (textEditing.x - cam.x) * cam.zoom,
      top: (textEditing.y - cam.y) * cam.zoom,
    };
  })() : null;

  return (
    <Shell>
      <div className="flex flex-col md:flex-row w-full h-full">
        {/* Desktop sidebar */}
        <div className="hidden md:flex flex-col gap-4 shrink-0 p-4 border-r overflow-y-auto"
          style={{ width: "14rem", borderColor: "var(--color-line)", background: "var(--color-panel)" }}>
          {toolbar}
        </div>

        {/* Mobile toolbar */}
        <div className="flex md:hidden items-center gap-2 px-3 py-2 border-b overflow-x-auto shrink-0"
          style={{ borderColor: "var(--color-line)", background: "var(--color-panel)" }}>
          <button onClick={() => setShowDrawings(!showDrawings)} style={mobileBtnStyle}>
            {showDrawings ? "Canvas" : `Boards (${drawings.length})`}
          </button>
          {!showDrawings && (
            <>
              {mobileToolBtn("select", "Sel")}
              {mobileToolBtn("pen", "Pen")}
              {mobileToolBtn("eraser", "Erase")}
              {mobileToolBtn("line", "Line")}
              {mobileToolBtn("arrow", "Arrow")}
              {mobileToolBtn("rect", "Rect")}
              {mobileToolBtn("ellipse", "Oval")}
              {mobileToolBtn("text", "Text")}
              {mobileToolBtn("fill", "Fill")}
              {mobileToolBtn("sticky", "Note")}
              <button onClick={handleUndo} disabled={undoStack.length === 0} style={mobileBtnStyle}>Undo</button>
              <button onClick={handleRedo} disabled={redoStack.length === 0} style={mobileBtnStyle}>Redo</button>
              <button onClick={() => setShowGrid(!showGrid)} style={{ ...mobileBtnStyle, ...(showGrid ? { background: "var(--color-accent)", color: "#fff", borderColor: "var(--color-accent)" } : {}) }}>Grid</button>
            </>
          )}
        </div>

        {/* Mobile drawings panel */}
        {showDrawings && (
          <div className="flex flex-col gap-3 p-4 md:hidden overflow-y-auto" style={{ background: "var(--color-panel)" }}>
            <button onClick={() => { handleNewDrawing(); setShowDrawings(false); }} style={{ ...btnStyle, width: "100%" }}>
              + New Board
            </button>
            {drawings.map((d) => (
              <div key={d.id} className="flex items-center gap-2"
                style={{
                  padding: "0.5rem 0.75rem", borderRadius: "var(--radius-btn)", cursor: "pointer",
                  background: d.id === activeId ? "var(--color-accent)" : "var(--color-paper)",
                  color: d.id === activeId ? "#fff" : "var(--color-ink)", border: "1px solid var(--color-line)",
                }}
                onClick={() => { handleSwitchDrawing(d.id); setShowDrawings(false); }}>
                {d.thumbnail && (
                  <img src={d.thumbnail} alt="" style={{
                    width: "2.5rem", height: "1.75rem", objectFit: "cover", borderRadius: "0.25rem", flexShrink: 0,
                    border: "1px solid", borderColor: d.id === activeId ? "rgba(255,255,255,0.3)" : "var(--color-line)",
                  }} />
                )}
                <span className="flex-1 truncate" style={{ fontSize: "0.875rem" }}>{d.name}</span>
                {drawings.length > 1 && (
                  <button onClick={(ev) => { ev.stopPropagation(); handleDeleteDrawing(d.id); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.6, fontSize: "1rem", padding: "0 0.25rem" }}>x</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Canvas */}
        <div ref={containerRef} className="flex-1 min-h-0 min-w-0 relative"
          style={{ display: showDrawings ? "none" : undefined }}>
          <canvas ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick}
            style={{ position: "absolute", inset: 0, touchAction: "none", cursor: getCursor() }}
          />
          {/* Text input overlay */}
          {textEditing && textScreenPos && (
            <textarea ref={textInputRef} value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitText(); }
                if (e.key === "Escape") { setTextEditing(null); setTextValue(""); }
              }}
              onBlur={commitText}
              placeholder="Type here..."
              style={{
                position: "absolute", left: textScreenPos.left, top: textScreenPos.top,
                fontSize: `${fontSize * camera.zoom}px`, fontFamily: "Manrope, system-ui, sans-serif",
                fontWeight: bold ? "bold" : "normal", fontStyle: italic ? "italic" : "normal",
                color, background: "transparent", border: "1.5px dashed var(--color-accent)",
                borderRadius: "0.25rem", padding: "0.125rem 0.25rem", outline: "none",
                resize: "both", minWidth: "6rem", minHeight: `${fontSize * 1.5}px`, lineHeight: 1.3, zIndex: 10,
              }}
            />
          )}
          {/* Sticky edit overlay */}
          {stickyEditing && stickyScreenPos && (
            <textarea ref={stickyInputRef} value={stickyText}
              onChange={(e) => setStickyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") commitSticky();
              }}
              onBlur={commitSticky}
              placeholder="Note..."
              style={{
                position: "absolute", left: stickyScreenPos.left, top: stickyScreenPos.top,
                width: stickyScreenPos.width, height: stickyScreenPos.height,
                fontSize: `${14 * camera.zoom}px`, fontFamily: "Manrope, system-ui, sans-serif",
                color: "#1a1a1a", background: (() => {
                  const el = elementsRef.current.find(e2 => e2.id === stickyEditing.id);
                  return (el?.type === "sticky" ? el.color : null) || stickyColor;
                })(),
                border: "2px solid var(--color-accent)", borderRadius: `${6 * camera.zoom}px`,
                padding: `${12 * camera.zoom}px`, outline: "none", resize: "none",
                lineHeight: 1.3, zIndex: 10,
              }}
            />
          )}
        </div>
      </div>
    </Shell>
  );
}

export default App;
