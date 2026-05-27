import { Shell } from "./components/Shell";
import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { SceneElement, Camera, Drawing, Tool, Point } from "./types";
import { renderScene, hitTest, getElementBounds, floodFill } from "./render";

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

const STICKY_COLORS = [
  "#fef3c7",
  "#fce7f3",
  "#dbeafe",
  "#dcfce7",
  "#f3e8ff",
  "#ffedd5",
];

const MAX_HISTORY = 30;
const STORAGE_KEY = "whiteboard_drawings_v2";
const SHAPE_TOOLS: Tool[] = ["line", "arrow", "rect", "ellipse"];
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

function loadDrawings(): Drawing[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    // Migrate from old format
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

export function screenToWorld(sx: number, sy: number, camera: Camera): Point {
  return { x: sx / camera.zoom + camera.x, y: sy / camera.zoom + camera.y };
}

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
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
  const [brushSize, setBrushSize] = useState(4);
  const [fontSize, setFontSize] = useState(20);
  const [stickyColor, setStickyColor] = useState(STICKY_COLORS[0]!);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  // Keep refs in sync for render function
  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const showGridRef = useRef(showGrid);
  showGridRef.current = showGrid;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;
  const brushSizeRef = useRef(brushSize);
  brushSizeRef.current = brushSize;

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
      selectedIdRef.current,
      accentColor,
    );
  }, []);

  // Re-render when state changes
  useEffect(() => {
    renderToCanvas();
  }, [elements, camera, showGrid, selectedId, darkMode, renderToCanvas]);

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
    setSelectedId(null);
  }, [persistCurrentDrawing, drawings]);

  const handleSwitchDrawing = useCallback((id: string) => {
    if (id === activeId) return;
    persistCurrentDrawing();
    setActiveId(id);
    setUndoStack([]);
    setRedoStack([]);
    setSelectedId(null);
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
    setSelectedId(null);
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

  const duplicateSelected = useCallback(() => {
    const sid = selectedIdRef.current;
    if (!sid) return;
    const el = elementsRef.current.find((e) => e.id === sid);
    if (!el) return;
    pushUndo();
    const offset = 20;
    const newId = crypto.randomUUID();
    let clone: SceneElement;
    if (el.type === "sticky" || el.type === "image" || el.type === "text") {
      clone = { ...el, id: newId, pos: { x: el.pos.x + offset, y: el.pos.y + offset } };
    } else if (el.type === "path") {
      clone = { ...el, id: newId, points: el.points.map((p) => ({ x: p.x + offset, y: p.y + offset })) };
    } else {
      clone = { ...el, id: newId, start: { x: el.start.x + offset, y: el.start.y + offset }, end: { x: el.end.x + offset, y: el.end.y + offset } };
    }
    setElements((prev) => [...prev, clone]);
    setSelectedId(newId);
  }, [pushUndo]);

  const bringForward = useCallback(() => {
    const sid = selectedIdRef.current;
    if (!sid) return;
    pushUndo();
    setElements((prev) => {
      const idx = prev.findIndex((e) => e.id === sid);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1]!, next[idx]!];
      return next;
    });
  }, [pushUndo]);

  const sendBackward = useCallback(() => {
    const sid = selectedIdRef.current;
    if (!sid) return;
    pushUndo();
    setElements((prev) => {
      const idx = prev.findIndex((e) => e.id === sid);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
      return next;
    });
  }, [pushUndo]);

  const handleDownload = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const drawing = drawings.find((d) => d.id === activeId);
    const link = document.createElement("a");
    link.download = (drawing?.name || "whiteboard") + ".png";
    link.href = canvas.toDataURL("image/png");
    link.click();
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
    };
    setElements((prev) => [...prev, el]);
    setTextEditing(null);
    setTextValue("");
  }, [textEditing, textValue, fontSize, pushUndo]);

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

  // -- Pointer handlers --
  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const screenPos = getCanvasPos(e);

    // Track active pointers for multi-touch
    activePtrsRef.current.set(e.pointerId, screenPos);

    // Two-finger pinch/pan — cancel any drawing, enter pinch mode
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
      const hit = hitTest(elementsRef.current, worldPos.x, worldPos.y);
      if (hit) {
        setSelectedId(hit.id);
        isDraggingRef.current = true;
        const b = getElementBounds(hit);
        dragOffsetRef.current = { x: worldPos.x - b.x, y: worldPos.y - b.y };
        pushUndo();
        canvas.setPointerCapture(e.pointerId);
      } else {
        setSelectedId(null);
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

    // Fill tool — renders scene to offscreen canvas, flood fills, flattens to image
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

    // Drawing tools
    canvas.setPointerCapture(e.pointerId);
    pushUndo();
    isDrawingRef.current = true;

    if (SHAPE_TOOLS.includes(currentTool)) {
      shapeStartRef.current = worldPos;
      const shapeEl: SceneElement = (() => {
        const base = { id: crypto.randomUUID(), start: worldPos, end: worldPos, color: colorRef.current, strokeWidth: brushSizeRef.current };
        switch (currentTool) {
          case "line": return { ...base, type: "line" as const };
          case "arrow": return { ...base, type: "arrow" as const };
          case "rect": return { ...base, type: "rect" as const };
          case "ellipse": return { ...base, type: "ellipse" as const };
          default: return { ...base, type: "line" as const };
        }
      })();
      inProgressRef.current = shapeEl;
    } else {
      // Pen or eraser
      const pathEl: SceneElement = {
        id: crypto.randomUUID(), type: "path",
        points: [worldPos], color: colorRef.current,
        strokeWidth: brushSizeRef.current,
        eraser: currentTool === "eraser",
      };
      inProgressRef.current = pathEl;
    }
    renderToCanvas();
  }, [getCanvasPos, pushUndo, commitText, textEditing, stickyColor, renderToCanvas]);

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

    if (isDraggingRef.current && selectedIdRef.current) {
      const worldPos = screenToWorld(screenPos.x, screenPos.y, cam);
      const targetX = worldPos.x - dragOffsetRef.current.x;
      const targetY = worldPos.y - dragOffsetRef.current.y;
      setElements((prev) =>
        prev.map((el) => {
          if (el.id !== selectedIdRef.current) return el;
          const b = getElementBounds(el);
          const dx = targetX - b.x;
          const dy = targetY - b.y;
          if (dx === 0 && dy === 0) return el;
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

    if (!isDrawingRef.current || !inProgressRef.current) return;
    const worldPos = screenToWorld(screenPos.x, screenPos.y, cam);
    const ip = inProgressRef.current;

    if (ip.type === "path") {
      ip.points.push(worldPos);
    } else if ("start" in ip) {
      (ip as { end: Point }).end = worldPos;
    }
    renderToCanvas();
  }, [getCanvasPos, renderToCanvas]);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas) canvas.releasePointerCapture(e.pointerId);

    // Remove from tracked pointers
    activePtrsRef.current.delete(e.pointerId);
    if (activePtrsRef.current.size < 2) {
      pinchRef.current = null;
    }
    // If there are still pointers active from a pinch, don't process as single-pointer up
    if (activePtrsRef.current.size > 0 && !isDrawingRef.current && !isDraggingRef.current && !isPanningRef.current) {
      return;
    }

    if (isPanningRef.current) {
      isPanningRef.current = false;
      panStartRef.current = null;
      if (canvas) canvas.style.cursor = "";
      return;
    }

    if (isDraggingRef.current) {
      isDraggingRef.current = false;
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

    // Discard zero-size shapes (click without drag)
    const discard =
      ("start" in ip && ip.start.x === (ip as { end: Point }).end.x && ip.start.y === (ip as { end: Point }).end.y) ||
      (ip.type === "path" && ip.points.length <= 1);

    if (discard) {
      // Pop the undo entry we pushed on pointer down
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
        // Zoom
        const delta = -e.deltaY * 0.01;
        const newZoom = clampZoom(cam.zoom * (1 + delta));
        const worldBefore = screenToWorld(sx, sy, cam);
        const newCam = { ...cam, zoom: newZoom };
        newCam.x = worldBefore.x - sx / newZoom;
        newCam.y = worldBefore.y - sy / newZoom;
        setCamera(newCam);
      } else {
        // Pan
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
        setSelectedId(null);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIdRef.current) {
          pushUndo();
          setElements((prev) => prev.filter((el) => el.id !== selectedIdRef.current));
          setSelectedId(null);
        }
        return;
      }

      if (e.key === "]") { bringForward(); return; }
      if (e.key === "[") { sendBackward(); return; }

      const shortcuts: Record<string, Tool> = {
        v: "select", p: "pen", e: "eraser", l: "line", a: "arrow",
        r: "rect", o: "ellipse", t: "text", f: "fill", s: "sticky",
      };
      if (!e.metaKey && !e.ctrlKey && shortcuts[e.key]) {
        setTool(shortcuts[e.key]!);
        setSelectedId(null);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") spaceHeldRef.current = false;
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", handler); window.removeEventListener("keyup", up); };
  }, [handleUndo, handleRedo, pushUndo, duplicateSelected, zoomToFit, bringForward, sendBackward, textEditing, stickyEditing, editingId]);

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
              const scale = maxDim / Math.max(w, h);
              w = Math.round(w * scale);
              h = Math.round(h * scale);
            }
            // Resize if needed
            const resizeCanvas = document.createElement("canvas");
            resizeCanvas.width = w;
            resizeCanvas.height = h;
            const rCtx = resizeCanvas.getContext("2d")!;
            rCtx.drawImage(img, 0, 0, w, h);
            const resizedUrl = resizeCanvas.toDataURL("image/png", 0.85);

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
    if (tool === "select") return selectedId ? "move" : "default";
    if (tool === "text") return "text";
    if (tool === "fill") return "crosshair";
    if (tool === "sticky") return "crosshair";
    if (SHAPE_TOOLS.includes(tool)) return "crosshair";
    if (tool === "eraser" || tool === "pen") {
      const r = Math.max(brushSize / 2, 1.5);
      const svgSize = Math.ceil(r * 2 + 4);
      const center = svgSize / 2;
      const stroke = tool === "eraser" ? "%23999" : "%23333";
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${svgSize}' height='${svgSize}'><circle cx='${center}' cy='${center}' r='${r}' fill='none' stroke='${stroke}' stroke-width='1.5'/></svg>`;
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
    <button key={t} onClick={() => { setTool(t); setSelectedId(null); }}
      style={tool === t ? activeBtnStyle : btnStyle} title={`${label} (${shortcut.toUpperCase()})`}>
      {label}
    </button>
  );

  const zoomPercent = Math.round(camera.zoom * 100);

  const toolbar = (
    <>
      {/* Drawings */}
      <div>
        <div style={labelStyle}>Drawings</div>
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
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Color */}
      <div>
        <div style={labelStyle}>Color</div>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button key={c} onClick={() => { setColor(c); if (tool === "eraser") setTool("pen"); }} title={c}
              style={{ width: "1.75rem", height: "1.75rem", borderRadius: "var(--radius-btn)", background: c, cursor: "pointer", padding: 0, boxSizing: "border-box", border: color === c && tool !== "eraser" ? "2.5px solid var(--color-accent)" : "2px solid var(--color-line)" }} />
          ))}
          <label title="Custom color" style={{ width: "1.75rem", height: "1.75rem", borderRadius: "var(--radius-btn)", border: "2px dashed var(--color-line)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", color: "var(--color-muted)", position: "relative", overflow: "hidden" }}>
            +
            <input type="color" value={color} onChange={(e) => { setColor(e.target.value); if (tool === "eraser") setTool("pen"); }}
              style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
          </label>
        </div>
      </div>

      {/* Brush / Font size */}
      <div>
        <div style={labelStyle}>{tool === "text" ? `Font: ${fontSize}px` : `Brush: ${brushSize}px`}</div>
        {tool === "text" ? (
          <input type="range" min={10} max={72} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--color-accent)" }} />
        ) : (
          <input type="range" min={1} max={20} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--color-accent)" }} />
        )}
      </div>

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

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5">
        <button onClick={handleUndo} style={btnStyle} disabled={undoStack.length === 0} title="Undo (Ctrl+Z)">Undo</button>
        <button onClick={handleRedo} style={btnStyle} disabled={redoStack.length === 0} title="Redo (Ctrl+Shift+Z)">Redo</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button onClick={handleClear} style={btnStyle}>Clear</button>
        <button onClick={handleDownload} style={btnStyle}>PNG</button>
      </div>

      {/* Selection actions */}
      {selectedId && (
        <div>
          <div style={labelStyle}>Selected</div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={duplicateSelected} style={btnStyle} title="Duplicate (Ctrl+D)">Dup</button>
            <button onClick={bringForward} style={btnStyle} title="Bring Forward (])">Fwd</button>
            <button onClick={sendBackward} style={btnStyle} title="Send Backward ([)">Back</button>
          </div>
        </div>
      )}

      {/* View */}
      <div>
        <div style={labelStyle}>View</div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setShowGrid(!showGrid)} style={showGrid ? activeBtnStyle : btnStyle}>Grid</button>
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
    </>
  );

  // -- Mobile toolbar (compact) --
  const mobileToolBtn = (t: Tool, label: string) => (
    <button key={t} onClick={() => { setTool(t); setSelectedId(null); }}
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
            {showDrawings ? "Canvas" : `Files (${drawings.length})`}
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
              + New Drawing
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
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.6, fontSize: "1rem", padding: "0 0.25rem" }}>×</button>
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
                  const el = elementsRef.current.find(e => e.id === stickyEditing.id);
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
