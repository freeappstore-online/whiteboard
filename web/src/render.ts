import type { SceneElement, Camera, Rect } from "./types";

export function getElementBounds(el: SceneElement): Rect {
  switch (el.type) {
    case "path": {
      if (el.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of el.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      const pad = el.strokeWidth / 2;
      return { x: minX - pad, y: minY - pad, width: maxX - minX + el.strokeWidth, height: maxY - minY + el.strokeWidth };
    }
    case "line": {
      const x = Math.min(el.start.x, el.end.x);
      const y = Math.min(el.start.y, el.end.y);
      const pad = el.strokeWidth / 2;
      return { x: x - pad, y: y - pad, width: Math.abs(el.end.x - el.start.x) + el.strokeWidth, height: Math.abs(el.end.y - el.start.y) + el.strokeWidth };
    }
    case "arrow": {
      const headLen = Math.max(el.strokeWidth * 3, 12);
      const x = Math.min(el.start.x, el.end.x);
      const y = Math.min(el.start.y, el.end.y);
      const pad = Math.max(el.strokeWidth / 2, headLen);
      return { x: x - pad, y: y - pad, width: Math.abs(el.end.x - el.start.x) + pad * 2, height: Math.abs(el.end.y - el.start.y) + pad * 2 };
    }
    case "rect":
    case "ellipse": {
      const x = Math.min(el.start.x, el.end.x);
      const y = Math.min(el.start.y, el.end.y);
      const pad = el.strokeWidth / 2;
      return { x: x - pad, y: y - pad, width: Math.abs(el.end.x - el.start.x) + el.strokeWidth, height: Math.abs(el.end.y - el.start.y) + el.strokeWidth };
    }
    case "text": {
      const lines = el.text.split("\n");
      const longest = Math.max(...lines.map((l) => l.length));
      const estWidth = longest * el.fontSize * 0.55;
      return { x: el.pos.x, y: el.pos.y, width: estWidth, height: el.fontSize * 1.3 * lines.length };
    }
    case "sticky":
      return { x: el.pos.x, y: el.pos.y, width: el.width, height: el.height };
    case "image":
      return { x: el.pos.x, y: el.pos.y, width: el.width || 100, height: el.height || 100 };
  }
}

export function hitTest(elements: SceneElement[], wx: number, wy: number): SceneElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]!;
    const b = getElementBounds(el);
    if (wx >= b.x && wx <= b.x + b.width && wy >= b.y && wy <= b.y + b.height) {
      return el;
    }
  }
  return null;
}

/** Returns IDs of all elements whose bounds intersect the given world-space rect. */
export function boxSelect(elements: SceneElement[], rect: Rect): string[] {
  const ids: string[] = [];
  for (const el of elements) {
    const b = getElementBounds(el);
    if (
      b.x + b.width >= rect.x &&
      b.x <= rect.x + rect.width &&
      b.y + b.height >= rect.y &&
      b.y <= rect.y + rect.height
    ) {
      ids.push(el.id);
    }
  }
  return ids;
}

function renderElement(
  ctx: CanvasRenderingContext2D,
  el: SceneElement,
  paperColor: string,
  imageCache: Map<string, HTMLImageElement>,
) {
  switch (el.type) {
    case "path": {
      if (el.points.length === 0) return;
      ctx.save();
      ctx.globalAlpha = el.opacity;
      ctx.beginPath();
      ctx.strokeStyle = el.eraser ? paperColor : el.color;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const pts = el.points;
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      if (pts.length === 1) {
        ctx.lineTo(pts[0]!.x + 0.1, pts[0]!.y);
      } else if (pts.length === 2) {
        ctx.lineTo(pts[1]!.x, pts[1]!.y);
      } else {
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i]!.x + pts[i + 1]!.x) / 2;
          const my = (pts[i]!.y + pts[i + 1]!.y) / 2;
          ctx.quadraticCurveTo(pts[i]!.x, pts[i]!.y, mx, my);
        }
        ctx.lineTo(pts[pts.length - 1]!.x, pts[pts.length - 1]!.y);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }
    case "line": {
      ctx.save();
      ctx.globalAlpha = el.opacity;
      ctx.beginPath();
      ctx.strokeStyle = el.color;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = "round";
      ctx.moveTo(el.start.x, el.start.y);
      ctx.lineTo(el.end.x, el.end.y);
      ctx.stroke();
      ctx.restore();
      return;
    }
    case "arrow": {
      ctx.save();
      ctx.globalAlpha = el.opacity;
      ctx.beginPath();
      ctx.strokeStyle = el.color;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(el.start.x, el.start.y);
      ctx.lineTo(el.end.x, el.end.y);
      ctx.stroke();
      const headLen = Math.max(el.strokeWidth * 3, 12);
      const angle = Math.atan2(el.end.y - el.start.y, el.end.x - el.start.x);
      ctx.beginPath();
      ctx.moveTo(el.end.x, el.end.y);
      ctx.lineTo(el.end.x - headLen * Math.cos(angle - Math.PI / 6), el.end.y - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(el.end.x, el.end.y);
      ctx.lineTo(el.end.x - headLen * Math.cos(angle + Math.PI / 6), el.end.y - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
      ctx.restore();
      return;
    }
    case "rect": {
      ctx.save();
      ctx.globalAlpha = el.opacity;
      ctx.beginPath();
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.rect(el.start.x, el.start.y, el.end.x - el.start.x, el.end.y - el.start.y);
      if (el.filled) {
        ctx.fillStyle = el.color;
        ctx.fill();
      } else {
        ctx.strokeStyle = el.color;
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    case "ellipse": {
      const cx = (el.start.x + el.end.x) / 2;
      const cy = (el.start.y + el.end.y) / 2;
      const rx = Math.abs(el.end.x - el.start.x) / 2;
      const ry = Math.abs(el.end.y - el.start.y) / 2;
      if (rx <= 0 || ry <= 0) return;
      ctx.save();
      ctx.globalAlpha = el.opacity;
      ctx.beginPath();
      ctx.lineWidth = el.strokeWidth;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      if (el.filled) {
        ctx.fillStyle = el.color;
        ctx.fill();
      } else {
        ctx.strokeStyle = el.color;
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    case "text": {
      const weight = el.bold ? "bold" : "normal";
      const style = el.italic ? "italic" : "normal";
      ctx.font = `${style} ${weight} ${el.fontSize}px Manrope, system-ui, sans-serif`;
      ctx.fillStyle = el.color;
      ctx.textBaseline = "top";
      const lines = el.text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i]!, el.pos.x, el.pos.y + i * el.fontSize * 1.3);
      }
      return;
    }
    case "sticky": {
      ctx.fillStyle = el.color;
      const r = 6;
      ctx.beginPath();
      ctx.moveTo(el.pos.x + r, el.pos.y);
      ctx.lineTo(el.pos.x + el.width - r, el.pos.y);
      ctx.quadraticCurveTo(el.pos.x + el.width, el.pos.y, el.pos.x + el.width, el.pos.y + r);
      ctx.lineTo(el.pos.x + el.width, el.pos.y + el.height - r);
      ctx.quadraticCurveTo(el.pos.x + el.width, el.pos.y + el.height, el.pos.x + el.width - r, el.pos.y + el.height);
      ctx.lineTo(el.pos.x + r, el.pos.y + el.height);
      ctx.quadraticCurveTo(el.pos.x, el.pos.y + el.height, el.pos.x, el.pos.y + el.height - r);
      ctx.lineTo(el.pos.x, el.pos.y + r);
      ctx.quadraticCurveTo(el.pos.x, el.pos.y, el.pos.x + r, el.pos.y);
      ctx.closePath();
      ctx.fill();
      // Shadow
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.08)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
      ctx.fill();
      ctx.restore();
      // Text
      if (el.text) {
        ctx.fillStyle = "#1a1a1a";
        ctx.font = "14px Manrope, system-ui, sans-serif";
        ctx.textBaseline = "top";
        const padding = 12;
        const maxWidth = el.width - padding * 2;
        const words = el.text.split(" ");
        let line = "";
        let y = el.pos.y + padding;
        for (const word of words) {
          const test = line ? line + " " + word : word;
          if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line, el.pos.x + padding, y);
            line = word;
            y += 18;
          } else {
            line = test;
          }
        }
        if (line) ctx.fillText(line, el.pos.x + padding, y);
      }
      return;
    }
    case "image": {
      const img = imageCache.get(el.dataUrl);
      if (!img || !img.complete) return;
      const w = el.width || img.naturalWidth;
      const h = el.height || img.naturalHeight;
      ctx.drawImage(img, el.pos.x, el.pos.y, w, h);
      return;
    }
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, viewW: number, viewH: number) {
  let spacing = 20;
  const screenSpacing = spacing * camera.zoom;
  if (screenSpacing < 10) spacing = 40;
  if (screenSpacing < 5) spacing = 100;
  if (spacing * camera.zoom < 3) return;

  const worldLeft = camera.x;
  const worldTop = camera.y;
  const worldRight = camera.x + viewW / camera.zoom;
  const worldBottom = camera.y + viewH / camera.zoom;

  const startX = Math.floor(worldLeft / spacing) * spacing;
  const startY = Math.floor(worldTop / spacing) * spacing;

  const dotSize = Math.min(1.5 / camera.zoom, 3);
  ctx.fillStyle = "rgba(128, 128, 128, 0.15)";

  for (let x = startX; x <= worldRight; x += spacing) {
    for (let y = startY; y <= worldBottom; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, dotSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function floodFill(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  fillColor: string,
  w: number,
  h: number,
) {
  const sx = Math.round(startX);
  const sy = Math.round(startY);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const tmp = document.createElement("canvas");
  tmp.width = 1;
  tmp.height = 1;
  const tc = tmp.getContext("2d")!;
  tc.fillStyle = fillColor;
  tc.fillRect(0, 0, 1, 1);
  const fd = tc.getImageData(0, 0, 1, 1).data;

  const si = (sy * w + sx) * 4;
  const tr = data[si]!, tg = data[si + 1]!, tb = data[si + 2]!, ta = data[si + 3]!;
  if (tr === fd[0] && tg === fd[1] && tb === fd[2] && ta === fd[3]) return;

  const tolerance = 30;
  const match = (i: number) =>
    Math.abs(data[i]! - tr) <= tolerance &&
    Math.abs(data[i + 1]! - tg) <= tolerance &&
    Math.abs(data[i + 2]! - tb) <= tolerance &&
    Math.abs(data[i + 3]! - ta) <= tolerance;

  const stack: number[] = [sx, sy];
  const visited = new Uint8Array(w * h);

  while (stack.length > 0) {
    const cy = stack.pop()!;
    const cx = stack.pop()!;
    const vi = cy * w + cx;
    if (visited[vi]) continue;
    const idx = vi * 4;
    if (!match(idx)) continue;
    visited[vi] = 1;
    data[idx] = fd[0]!;
    data[idx + 1] = fd[1]!;
    data[idx + 2] = fd[2]!;
    data[idx + 3] = fd[3]!;
    if (cx > 0) stack.push(cx - 1, cy);
    if (cx < w - 1) stack.push(cx + 1, cy);
    if (cy > 0) stack.push(cx, cy - 1);
    if (cy < h - 1) stack.push(cx, cy + 1);
  }

  ctx.putImageData(imageData, 0, 0);
}

function drawSelectionHandles(
  ctx: CanvasRenderingContext2D,
  b: Rect,
  camera: Camera,
  accentColor: string,
) {
  const pad = 4 / camera.zoom;
  const handleSize = 6 / camera.zoom;
  const dashLen = 5 / camera.zoom;

  // Dashed outline
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.5 / camera.zoom;
  ctx.setLineDash([dashLen, dashLen]);
  ctx.strokeRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
  ctx.setLineDash([]);

  // Corner handles
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.5 / camera.zoom;
  const corners = [
    { x: b.x - pad - handleSize / 2, y: b.y - pad - handleSize / 2 },
    { x: b.x + b.width + pad - handleSize / 2, y: b.y - pad - handleSize / 2 },
    { x: b.x - pad - handleSize / 2, y: b.y + b.height + pad - handleSize / 2 },
    { x: b.x + b.width + pad - handleSize / 2, y: b.y + b.height + pad - handleSize / 2 },
  ];
  for (const c of corners) {
    ctx.fillRect(c.x, c.y, handleSize, handleSize);
    ctx.strokeRect(c.x, c.y, handleSize, handleSize);
  }
}

/** Compute the bounding rect of all elements (world-space). Returns null if empty. */
export function getSceneBounds(elements: SceneElement[]): Rect | null {
  if (elements.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    const b = getElementBounds(el);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  if (!isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  elements: SceneElement[],
  camera: Camera,
  viewW: number,
  viewH: number,
  dpr: number,
  paperColor: string,
  accentColor: string,
) {
  const sceneBounds = getSceneBounds(elements);
  if (!sceneBounds) return;

  // Expand scene bounds to also include current viewport
  const vpLeft = camera.x;
  const vpTop = camera.y;
  const vpRight = camera.x + viewW / camera.zoom;
  const vpBottom = camera.y + viewH / camera.zoom;

  const allMinX = Math.min(sceneBounds.x, vpLeft);
  const allMinY = Math.min(sceneBounds.y, vpTop);
  const allMaxX = Math.max(sceneBounds.x + sceneBounds.width, vpRight);
  const allMaxY = Math.max(sceneBounds.y + sceneBounds.height, vpBottom);
  const allW = allMaxX - allMinX;
  const allH = allMaxY - allMinY;
  if (allW <= 0 || allH <= 0) return;

  // Minimap dimensions in screen pixels
  const mmW = 150;
  const mmH = 100;
  const mmPad = 12;
  const mmX = (viewW - mmW - mmPad) * dpr;
  const mmY = (viewH - mmH - mmPad) * dpr;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Background
  ctx.fillStyle = paperColor;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(mmX, mmY, mmW * dpr, mmH * dpr);
  ctx.globalAlpha = 1;

  // Border
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1 * dpr;
  ctx.strokeRect(mmX, mmY, mmW * dpr, mmH * dpr);

  // Scale to fit all content in minimap
  const scale = Math.min((mmW * dpr) / allW, (mmH * dpr) / allH) * 0.9;
  const offsetX = mmX + (mmW * dpr - allW * scale) / 2;
  const offsetY = mmY + (mmH * dpr - allH * scale) / 2;

  // Draw element dots/rects
  ctx.fillStyle = accentColor;
  ctx.globalAlpha = 0.5;
  for (const el of elements) {
    const b = getElementBounds(el);
    const rx = offsetX + (b.x - allMinX) * scale;
    const ry = offsetY + (b.y - allMinY) * scale;
    const rw = Math.max(b.width * scale, 2);
    const rh = Math.max(b.height * scale, 2);
    ctx.fillRect(rx, ry, rw, rh);
  }
  ctx.globalAlpha = 1;

  // Viewport rectangle
  const vx = offsetX + (vpLeft - allMinX) * scale;
  const vy = offsetY + (vpTop - allMinY) * scale;
  const vw = (vpRight - vpLeft) * scale;
  const vh = (vpBottom - vpTop) * scale;
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2 * dpr;
  ctx.strokeRect(vx, vy, vw, vh);

  ctx.restore();
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  elements: SceneElement[],
  camera: Camera,
  paperColor: string,
  showGrid: boolean,
  dpr: number,
  imageCache: Map<string, HTMLImageElement>,
  inProgress?: SceneElement | null,
  selectedIds?: ReadonlySet<string> | string | null,
  accentColor?: string,
  selectionBox?: Rect | null,
) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = paperColor;
  ctx.fillRect(0, 0, canvasW, canvasH);

  const scale = camera.zoom * dpr;
  ctx.setTransform(scale, 0, 0, scale, -camera.x * scale, -camera.y * scale);

  const viewW = canvasW / dpr;
  const viewH = canvasH / dpr;

  if (showGrid) {
    drawGrid(ctx, camera, viewW, viewH);
  }

  for (const el of elements) {
    renderElement(ctx, el, paperColor, imageCache);
  }

  if (inProgress) {
    renderElement(ctx, inProgress, paperColor, imageCache);
  }

  // Draw selection boxes and handles
  if (selectedIds && accentColor) {
    const ids = typeof selectedIds === "string" ? new Set([selectedIds]) : selectedIds;
    for (const el of elements) {
      if (ids.has(el.id)) {
        const b = getElementBounds(el);
        drawSelectionHandles(ctx, b, camera, accentColor);
      }
    }
  }

  // Draw selection box (drag-select rectangle)
  if (selectionBox && accentColor) {
    ctx.fillStyle = accentColor;
    ctx.globalAlpha = 0.08;
    ctx.fillRect(selectionBox.x, selectionBox.y, selectionBox.width, selectionBox.height);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1 / camera.zoom;
    ctx.setLineDash([4 / camera.zoom, 4 / camera.zoom]);
    ctx.strokeRect(selectionBox.x, selectionBox.y, selectionBox.width, selectionBox.height);
    ctx.setLineDash([]);
  }

  ctx.restore();

  // Mini-map
  if (elements.length > 0 && accentColor) {
    renderMinimap(ctx, elements, camera, viewW, viewH, dpr, paperColor, accentColor);
  }
}

/** Render the full board to an offscreen canvas and return it as a data URL. */
export function exportFullBoard(
  elements: SceneElement[],
  paperColor: string,
  imageCache: Map<string, HTMLImageElement>,
  padding = 40,
): string | null {
  const bounds = getSceneBounds(elements);
  if (!bounds) return null;

  const w = Math.ceil(bounds.width + padding * 2);
  const h = Math.ceil(bounds.height + padding * 2);
  const offscreen = document.createElement("canvas");
  offscreen.width = w;
  offscreen.height = h;
  const ctx = offscreen.getContext("2d")!;

  ctx.fillStyle = paperColor;
  ctx.fillRect(0, 0, w, h);

  const camera: Camera = {
    x: bounds.x - padding,
    y: bounds.y - padding,
    zoom: 1,
  };
  ctx.setTransform(1, 0, 0, 1, -camera.x, -camera.y);

  for (const el of elements) {
    renderElement(ctx, el, paperColor, imageCache);
  }

  return offscreen.toDataURL("image/png");
}
