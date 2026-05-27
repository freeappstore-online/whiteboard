import { describe, it, expect } from "vitest";
import { getElementBounds, hitTest } from "./render";
import { screenToWorld, clampZoom } from "./App";
import type { SceneElement } from "./types";

describe("screenToWorld", () => {
  it("converts at zoom 1 with no offset", () => {
    const p = screenToWorld(100, 200, { x: 0, y: 0, zoom: 1 });
    expect(p).toEqual({ x: 100, y: 200 });
  });

  it("accounts for camera offset", () => {
    const p = screenToWorld(100, 200, { x: 50, y: 30, zoom: 1 });
    expect(p).toEqual({ x: 150, y: 230 });
  });

  it("accounts for zoom", () => {
    const p = screenToWorld(100, 200, { x: 0, y: 0, zoom: 2 });
    expect(p).toEqual({ x: 50, y: 100 });
  });

  it("accounts for both offset and zoom", () => {
    const p = screenToWorld(100, 200, { x: 50, y: 30, zoom: 2 });
    expect(p).toEqual({ x: 100, y: 130 });
  });
});

describe("clampZoom", () => {
  it("returns value within range", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(2.5)).toBe(2.5);
  });

  it("clamps below minimum", () => {
    expect(clampZoom(0.01)).toBe(0.1);
    expect(clampZoom(-1)).toBe(0.1);
  });

  it("clamps above maximum", () => {
    expect(clampZoom(10)).toBe(5);
    expect(clampZoom(100)).toBe(5);
  });
});

describe("getElementBounds", () => {
  it("computes path bounds from points", () => {
    const el: SceneElement = {
      id: "1", type: "path",
      points: [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 20, y: 10 }],
      color: "#000", strokeWidth: 4, eraser: false,
    };
    const b = getElementBounds(el);
    expect(b.x).toBe(8); // 10 - 4/2
    expect(b.y).toBe(8); // 10 - 4/2
    expect(b.width).toBe(24); // 30-10 + 4
    expect(b.height).toBe(34); // 40-10 + 4
  });

  it("computes rect bounds", () => {
    const el: SceneElement = {
      id: "2", type: "rect",
      start: { x: 10, y: 20 }, end: { x: 50, y: 60 },
      color: "#000", strokeWidth: 2,
    };
    const b = getElementBounds(el);
    expect(b.x).toBe(9); // 10 - 2/2
    expect(b.y).toBe(19); // 20 - 2/2
    expect(b.width).toBe(42); // 40 + 2
    expect(b.height).toBe(42); // 40 + 2
  });

  it("computes sticky bounds", () => {
    const el: SceneElement = {
      id: "3", type: "sticky",
      pos: { x: 100, y: 200 }, width: 180, height: 140,
      text: "hello", color: "#fef3c7",
    };
    const b = getElementBounds(el);
    expect(b).toEqual({ x: 100, y: 200, width: 180, height: 140 });
  });

  it("computes text bounds", () => {
    const el: SceneElement = {
      id: "4", type: "text",
      pos: { x: 50, y: 60 }, text: "hello", color: "#000", fontSize: 20,
    };
    const b = getElementBounds(el);
    expect(b.x).toBe(50);
    expect(b.y).toBe(60);
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBe(26); // 20 * 1.3 * 1 line
  });

  it("handles empty path", () => {
    const el: SceneElement = {
      id: "5", type: "path",
      points: [], color: "#000", strokeWidth: 2, eraser: false,
    };
    const b = getElementBounds(el);
    expect(b.width).toBe(0);
    expect(b.height).toBe(0);
  });
});

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
    const hit = hitTest(elements, 150, 150);
    expect(hit?.id).toBe("s1");
  });

  it("returns null when point is outside all elements", () => {
    const hit = hitTest(elements, 0, 0);
    expect(hit).toBeNull();
  });

  it("returns topmost element when overlapping", () => {
    const overlapping: SceneElement = {
      id: "s2", type: "sticky",
      pos: { x: 100, y: 100 }, width: 180, height: 140,
      text: "", color: "#dbeafe",
    };
    const hit = hitTest([sticky, overlapping], 150, 150);
    expect(hit?.id).toBe("s2");
  });

  it("hits rect element within bounds", () => {
    const hit = hitTest(elements, 350, 350);
    expect(hit?.id).toBe("r1");
  });
});
