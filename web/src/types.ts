export interface Point {
  x: number;
  y: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface PathElement {
  id: string;
  type: "path";
  points: Point[];
  pressures?: number[];
  color: string;
  strokeWidth: number;
  opacity: number;
  eraser: boolean;
}

export interface LineElement {
  id: string;
  type: "line";
  start: Point;
  end: Point;
  color: string;
  strokeWidth: number;
  opacity: number;
}

export interface ArrowElement {
  id: string;
  type: "arrow";
  start: Point;
  end: Point;
  color: string;
  strokeWidth: number;
  opacity: number;
}

export interface RectElement {
  id: string;
  type: "rect";
  start: Point;
  end: Point;
  color: string;
  strokeWidth: number;
  opacity: number;
  filled: boolean;
}

export interface EllipseElement {
  id: string;
  type: "ellipse";
  start: Point;
  end: Point;
  color: string;
  strokeWidth: number;
  opacity: number;
  filled: boolean;
}

export interface TextElement {
  id: string;
  type: "text";
  pos: Point;
  text: string;
  color: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
}

export interface StickyElement {
  id: string;
  type: "sticky";
  pos: Point;
  width: number;
  height: number;
  text: string;
  color: string;
}

export interface ImageElement {
  id: string;
  type: "image";
  pos: Point;
  width: number;
  height: number;
  dataUrl: string;
}

export type SceneElement =
  | PathElement
  | LineElement
  | ArrowElement
  | RectElement
  | EllipseElement
  | TextElement
  | StickyElement
  | ImageElement;

export type Tool =
  | "select"
  | "pen"
  | "eraser"
  | "line"
  | "arrow"
  | "rect"
  | "ellipse"
  | "text"
  | "sticky"
  | "fill";

export interface Drawing {
  id: string;
  name: string;
  elements: SceneElement[];
  camera: Camera;
  thumbnail: string;
  updatedAt: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
