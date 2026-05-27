import { describe, it, expect } from "vitest";
import { getElementBounds, hitTest } from "./render";
import { screenToWorld, clampZoom } from "./App";
import type { SceneElement } from "./types";

// ---------------------------------------------------------------------------
// screenToWorld
// ---------------------------------------------------------------------------

describe("screenToWorld", () => {
  it("converts at zoom 1 with no offset", () => {
    expect(screenToWorld(100, 200, { x: 0, y: 0, zoom: 1 })).toEqual({ x: 100, y: 200 });
  });

  it("accounts for camera offset", () => {
    expect(screenToWorld(100, 200, { x: 50, y: 30, zoom: 1 })).toEqual({ x: 150, y: 230 });
  });

  it("accounts for zoom", () => {
    expect(screenToWorld(100, 200, { x: 0, y: 0, zoom: 2 })).toEqual({ x: 50, y: 100 });
  });

  it("accounts for both offset and zoom", () => {
    expect(screenToWorld(100, 200, { x: 50, y: 30, zoom: 2 })).toEqual({ x: 100, y: 130 });
  });

  it("handles fractional zoom", () => {
    const p = screenToWorld(100, 100, { x: 0, y: 0, zoom: 0.5 });
    expect(p).toEqual({ x: 200, y: 200 });
  });

  it("handles negative camera offset", () => {
    const p = screenToWorld(50, 50, { x: -100, y: -100, zoom: 1 });
    expect(p).toEqual({ x: -50, y: -50 });
  });

  it("screen origin maps to camera origin", () => {
    const p = screenToWorld(0, 0, { x: 42, y: 99, zoom: 3 });
    expect(p).toEqual({ x: 42, y: 99 });
  });
});

// ---------------------------------------------------------------------------
// clampZoom
// ---------------------------------------------------------------------------

describe("clampZoom", () => {
  it("returns value within range", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(2.5)).toBe(2.5);
  });

  it("clamps below minimum (0.1)", () => {
    expect(clampZoom(0.01)).toBe(0.1);
    expect(clampZoom(-1)).toBe(0.1);
    expect(clampZoom(0)).toBe(0.1);
  });

  it("clamps above maximum (5)", () => {
    expect(clampZoom(10)).toBe(5);
    expect(clampZoom(100)).toBe(5);
  });

  it("boundary values are included", () => {
    expect(clampZoom(0.1)).toBe(0.1);
    expect(clampZoom(5)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// getElementBounds — path
// ---------------------------------------------------------------------------

describe("getElementBounds — path", () => {
  it("computes bounds from multiple points", () => {
    const el: SceneElement = {
      id: "1", type: "path",
      points: [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 20, y: 10 }],
      color: "#000", strokeWidth: 4, eraser: false,
    };
    const b = getElementBounds(el);
    expect(b.x).toBe(8);
    expect(b.y).toBe(8);
    expect(b.width).toBe(24);
    expect(b.height).toBe(34);
  });

  it("handles single point", () => {
    const el: SceneElement = {
      id: "sp", type: "path",
      points: [{ x: 50, y: 50 }],
      color: "#000", strokeWidth: 6, eraser: false,
    };
    const b = getElementBounds(el);
    expect(b.x).toBe(47);
    expect(b.y).toBe(47);
    expect(b.width).toBe(6);
    expect(b.height).toBe(6);
  });

  it("handles empty path", () => {
    const el: SceneElement = {
      id: "ep", type: "path",
      points: [], color: "#000", strokeWidth: 2, eraser: false,
    };
    const b = getElementBounds(el);
    expect(b.width).toBe(0);
    expect(b.height).toBe(0);
  });

  it("eraser flag does not affect bounds", () => {
    const pen: SceneElement = {
      id: "p1", type: "path",
      points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
      color: "#000", strokeWidth: 4, eraser: false,
    };
    const eraser: SceneElement = { ...pen, id: "p2", eraser: true };
    expect(getElementBounds(pen)).toEqual(getElementBounds(eraser));
  });
});

// ---------------------------------------------------------------------------
// getElementBounds — line
// ---------------------------------------------------------------------------

describe("getElementBounds — line", () => {
  it("computes bounds for diagonal line", () => {
    const el: SceneElement = {
      id: "l1", type: "line",
      start: { x: 10, y: 20 }, end: { x: 50, y: 60 },
      color: "#000", strokeWidth: 2,
    };
    const b = getElementBounds(el);
    expect(b.x).toBe(9);
    expect(b.y).toBe(19);
    expect(b.width).toBe(42);
    expect(b.height).toBe(42);
  });

  it("handles inverted direction (end < start)", () => {
    const el: SceneElement = {
      id: "l2", type: "line",
      start: { x: 100, y: 100 }, end: { x: 20, y: 30 },
      color: "#000", strokeWidth: 4,
    };
    const b = getElementBounds(el);
    expect(b.x).toBe(18);
    expect(b.y).toBe(28);
    expect(b.width).toBe(84);
    expect(b.height).toBe(74);
  });

  it("horizontal line has strokeWidth height", () => {
    const el: SceneElement = {
      id: "l3", type: "line",
      start: { x: 0, y: 50 }, end: { x: 100, y: 50 },
      color: "#000", strokeWidth: 6,
    };
    const b = getElementBounds(el);
    expect(b.height).toBe(6);
    expect(b.width).toBe(106);
  });
});

// ---------------------------------------------------------------------------
// getElementBounds — arrow
// ---------------------------------------------------------------------------

describe("getElementBounds — arrow", () => {
  it("includes arrowhead padding", () => {
    const el: SceneElement = {
      id: "a1", type: "arrow",
      start: { x: 10, y: 10 }, end: { x: 110, y: 10 },
      color: "#000", strokeWidth: 2,
    };
    const b = getElementBounds(el);
    const headLen = Math.max(2 * 3, 12);
    expect(b.x).toBe(10 - headLen);
    expect(b.width).toBe(100 + headLen * 2);
  });

  it("arrow bounds are larger than equivalent line bounds", () => {
    const base = { id: "x", start: { x: 0, y: 0 }, end: { x: 50, y: 50 }, color: "#000", strokeWidth: 2 };
    const line: SceneElement = { ...base, type: "line" as const };
    const arrow: SceneElement = { ...base, type: "arrow" as const };
    const lb = getElementBounds(line);
    const ab = getElementBounds(arrow);
    expect(ab.width).toBeGreaterThan(lb.width);
    expect(ab.height).toBeGreaterThan(lb.height);
  });
});

// ---------------------------------------------------------------------------
// getElementBounds — rect / ellipse
// ---------------------------------------------------------------------------

describe("getElementBounds — rect", () => {
  it("computes bounds with stroke padding", () => {
    const el: SceneElement = {
      id: "r1", type: "rect",
      start: { x: 10, y: 20 }, end: { x: 50, y: 60 },
      color: "#000", strokeWidth: 2,
    };
    const b = getElementBounds(el);
    expect(b.x).toBe(9);
    expect(b.y).toBe(19);
    expect(b.width).toBe(42);
    expect(b.height).toBe(42);
  });

  it("handles inverted rect (dragged up-left)", () => {
    const el: SceneElement = {
      id: "r2", type: "rect",
      start: { x: 100, y: 100 }, end: { x: 20, y: 30 },
      color: "#000", strokeWidth: 4,
    };
    const b = getElementBounds(el);
    expect(b.x).toBe(18);
    expect(b.y).toBe(28);
  });
});

describe("getElementBounds — ellipse", () => {
  it("bounds match rect for same start/end", () => {
    const base = { id: "e1", start: { x: 10, y: 20 }, end: { x: 110, y: 80 }, color: "#000", strokeWidth: 2 };
    const rect: SceneElement = { ...base, type: "rect" as const };
    const ellipse: SceneElement = { ...base, type: "ellipse" as const };
    expect(getElementBounds(ellipse)).toEqual(getElementBounds(rect));
  });
});

// ---------------------------------------------------------------------------
// getElementBounds — text
// ---------------------------------------------------------------------------

describe("getElementBounds — text", () => {
  it("single line text", () => {
    const el: SceneElement = {
      id: "t1", type: "text",
      pos: { x: 50, y: 60 }, text: "hello", color: "#000", fontSize: 20,
    };
    const b = getElementBounds(el);
    expect(b.x).toBe(50);
    expect(b.y).toBe(60);
    expect(b.width).toBe(5 * 20 * 0.55);
    expect(b.height).toBe(26);
  });

  it("multiline text uses longest line for width", () => {
    const el: SceneElement = {
      id: "t2", type: "text",
      pos: { x: 0, y: 0 }, text: "hi\nworld\nok", color: "#000", fontSize: 20,
    };
    const b = getElementBounds(el);
    expect(b.width).toBe(5 * 20 * 0.55); // "world" is longest (5 chars)
    expect(b.height).toBe(20 * 1.3 * 3);
  });

  it("empty text has zero width", () => {
    const el: SceneElement = {
      id: "t3", type: "text",
      pos: { x: 10, y: 10 }, text: "", color: "#000", fontSize: 16,
    };
    const b = getElementBounds(el);
    expect(b.width).toBe(0);
    expect(b.height).toBe(16 * 1.3);
  });
});

// ---------------------------------------------------------------------------
// getElementBounds — sticky / image
// ---------------------------------------------------------------------------

describe("getElementBounds — sticky", () => {
  it("returns exact position and dimensions", () => {
    const el: SceneElement = {
      id: "s1", type: "sticky",
      pos: { x: 100, y: 200 }, width: 180, height: 140,
      text: "hello", color: "#fef3c7",
    };
    expect(getElementBounds(el)).toEqual({ x: 100, y: 200, width: 180, height: 140 });
  });
});

describe("getElementBounds — image", () => {
  it("returns exact dimensions when set", () => {
    const el: SceneElement = {
      id: "i1", type: "image",
      pos: { x: 0, y: 0 }, width: 400, height: 300,
      dataUrl: "data:image/png;base64,x",
    };
    expect(getElementBounds(el)).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });

  it("falls back to 100x100 when dimensions are 0", () => {
    const el: SceneElement = {
      id: "i2", type: "image",
      pos: { x: 50, y: 50 }, width: 0, height: 0,
      dataUrl: "data:image/png;base64,x",
    };
    const b = getElementBounds(el);
    expect(b.width).toBe(100);
    expect(b.height).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// hitTest
// ---------------------------------------------------------------------------

describe("hitTest", () => {
  const sticky: SceneElement = {
    id: "s1", type: "sticky",
    pos: { x: 100, y: 100 }, width: 180, height: 140,
    text: "", color: "#fef3c7",
  };
  const rect: SceneElement = {
    id: "r1", type: "rect",
    start: { x: 300, y: 300 }, end: { x: 400, y: 400 },
    color: "#000", strokeWidth: 2,
  };
  const elements = [sticky, rect];

  it("returns element when point is inside", () => {
    expect(hitTest(elements, 150, 150)?.id).toBe("s1");
  });

  it("returns null when point is outside all elements", () => {
    expect(hitTest(elements, 0, 0)).toBeNull();
  });

  it("returns topmost (last) element when overlapping", () => {
    const overlapping: SceneElement = {
      id: "s2", type: "sticky",
      pos: { x: 100, y: 100 }, width: 180, height: 140,
      text: "", color: "#dbeafe",
    };
    expect(hitTest([sticky, overlapping], 150, 150)?.id).toBe("s2");
  });

  it("hits rect element within bounds", () => {
    expect(hitTest(elements, 350, 350)?.id).toBe("r1");
  });

  it("returns null for empty elements array", () => {
    expect(hitTest([], 50, 50)).toBeNull();
  });

  it("hit on boundary edge is included", () => {
    expect(hitTest([sticky], 100, 100)?.id).toBe("s1");
    expect(hitTest([sticky], 280, 240)?.id).toBe("s1");
  });

  it("just outside boundary misses", () => {
    expect(hitTest([sticky], 99.9, 150)).toBeNull();
    expect(hitTest([sticky], 150, 240.1)).toBeNull();
  });

  it("hits path element by bounding box", () => {
    const path: SceneElement = {
      id: "p1", type: "path",
      points: [{ x: 10, y: 10 }, { x: 50, y: 50 }],
      color: "#000", strokeWidth: 4, eraser: false,
    };
    expect(hitTest([path], 30, 30)?.id).toBe("p1");
    expect(hitTest([path], 0, 0)).toBeNull();
  });

  it("hits arrow element including arrowhead padding", () => {
    const arrow: SceneElement = {
      id: "a1", type: "arrow",
      start: { x: 100, y: 100 }, end: { x: 200, y: 100 },
      color: "#000", strokeWidth: 2,
    };
    const headLen = Math.max(2 * 3, 12);
    expect(hitTest([arrow], 100 - headLen + 1, 100)?.id).toBe("a1");
  });

  it("hits text element", () => {
    const text: SceneElement = {
      id: "t1", type: "text",
      pos: { x: 50, y: 50 }, text: "hello", color: "#000", fontSize: 20,
    };
    expect(hitTest([text], 55, 55)?.id).toBe("t1");
  });
});
