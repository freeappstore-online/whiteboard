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

function renderElement(
  ctx: CanvasRenderingContext2D,
  el: SceneElement,
  paperColor: string,
  imageCache: Map<string, HTMLImageElement>,
) {
  switch (el.type) {
    case "path": {
      if (el.points.length === 0) return;
      ctx.beginPath();
      ctx.strokeStyle = el.eraser ? paperColor : el.color;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(el.points[0]!.x, el.points[0]!.y);
      for (let i = 1; i < el.points.length; i++) {
        ctx.lineTo(el.points[i]!.x, el.points[i]!.y);
      }
      if (el.points.length === 1) {
        ctx.lineTo(el.points[0]!.x + 0.1, el.points[0]!.y);
      }
      ctx.stroke();
      return;
    }
    case "line": {
      ctx.beginPath();
      ctx.strokeStyle = el.color;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = "round";
      ctx.moveTo(el.start.x, el.start.y);
      ctx.lineTo(el.end.x, el.end.y);
      ctx.stroke();
      return;
    }
    case "arrow": {
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
      return;
    }
    case "rect": {
      ctx.beginPath();
      ctx.strokeStyle = el.color;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.rect(el.start.x, el.start.y, el.end.x - el.start.x, el.end.y - el.start.y);
      ctx.stroke();
      return;
    }
    case "ellipse": {
      const cx = (el.start.x + el.end.x) / 2;
      const cy = (el.start.y + el.end.y) / 2;
      const rx = Math.abs(el.end.x - el.start.x) / 2;
      const ry = Math.abs(el.end.y - el.start.y) / 2;
      if (rx <= 0 || ry <= 0) return;
      ctx.beginPath();
      ctx.strokeStyle = el.color;
      ctx.lineWidth = el.strokeWidth;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    case "text": {
      ctx.font = `${el.fontSize}px Manrope, system-ui, sans-serif`;
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

  const dotSize = 1.5 / camera.zoom;
  ctx.fillStyle = "rgba(128, 128, 128, 0.15)";

  for (let x = startX; x <= worldRight; x += spacing) {
    for (let y = startY; y <= worldBottom; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, dotSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }
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
  selectedId?: string | null,
  accentColor?: string,
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

  if (selectedId && accentColor) {
    const sel = elements.find((e) => e.id === selectedId);
    if (sel) {
      const b = getElementBounds(sel);
      const pad = 4 / camera.zoom;
      const dashLen = 5 / camera.zoom;
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.5 / camera.zoom;
      ctx.setLineDash([dashLen, dashLen]);
      ctx.strokeRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
      ctx.setLineDash([]);
    }
  }

  ctx.restore();
}
