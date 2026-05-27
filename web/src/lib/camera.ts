import type { Camera, Point } from "../types";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 5;

export function screenToWorld(sx: number, sy: number, camera: Camera): Point {
  return { x: sx / camera.zoom + camera.x, y: sy / camera.zoom + camera.y };
}

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}
