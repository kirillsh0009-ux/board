export type Tool =
  | 'select'
  | 'pen'
  | 'marker'
  | 'eraser'
  | 'sticky'
  | 'text'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'solid3'

export type ElementType = 'path' | 'rect' | 'ellipse' | 'arrow' | 'line' | 'solid3' | 'sticky' | 'text' | 'func' | 'image'

export interface UserData {
  id: string
  name: string
  color: string
}

export interface Camera {
  x: number
  y: number
  zoom: number
}

export interface PathElement {
  id: string
  type: 'path'
  /** flat array: pen -> [x, y, widthFactor, ...], marker -> [x, y, ...] */
  points: number[]
  color: string
  width: number
  marker: boolean
}

export interface ShapeElement {
  id: string
  type: 'rect' | 'ellipse' | 'arrow'
  x: number
  y: number
  w: number
  h: number
  color: string
  strokeWidth: number
}

/** straight segment, drawn with the line tool; (w, h) are signed deltas */
export interface LineElement {
  id: string
  type: 'line'
  x: number
  y: number
  w: number
  h: number
  color: string
  strokeWidth: number
  /** "штрихи" — hidden-edge style from geometry drawings */
  dashed: boolean
}

export interface StickyElement {
  id: string
  type: 'sticky'
  x: number
  y: number
  w: number
  h: number
  color: string
  text: string
}

export interface TextElement {
  id: string
  type: 'text'
  x: number
  y: number
  size: number
  color: string
  text: string
}

/**
 * Stamped function graph: a PNG snapshot of the [func] editor canvas exactly as
 * it was visible at close time, plus the expression + graph view so the stamp
 * can be re-opened for editing later.
 */
export interface FuncElement {
  id: string
  type: 'func'
  x: number
  y: number
  w: number
  h: number
  /** PNG dataURL (rounded corners + frame baked in, transparent outside) */
  img: string
  /** expression(s), split on ';' — kept for re-editing */
  expr: string
  /** graph viewport at stamp time: math coords of the center + px per unit */
  view: { cx: number; cy: number; scale: number }
  /**
   * id of the text element whose [func] token created this stamp. Closing that
   * text's [func] panel again updates this stamp in place (no duplicates).
   */
  srcId?: string
}

export type BoardElement =
  | PathElement
  | ShapeElement
  | LineElement
  | Solid3Element
  | StickyElement
  | TextElement
  | FuncElement
  | ImageElement

export type Solid3Kind = 'cube' | 'box' | 'prism' | 'pyramid'

export interface Solid3Vertex {
  /** board-plane position (world) */
  x: number
  y: number
  /** depth; the oblique projection shifts it up-right on screen */
  z: number
}

export interface Solid3Edge {
  /** vertex indices */
  a: number
  b: number
}

/**
 * 3D wireframe solid (cube / box / prism / pyramid and any user-deformed
 * variant). Hidden edges are NOT stored — they are derived at render time
 * from the face topology + projection (see lib/board/solid3.ts), so the
 * drawing "understands" visibility by itself as vertices are dragged.
 */
export interface Solid3Element {
  id: string
  type: 'solid3'
  shape: Solid3Kind
  vertices: Solid3Vertex[]
  edges: Solid3Edge[]
  /** face topology as vertex-index loops (visibility math) */
  faces: number[][]
  color: string
  strokeWidth: number
}

/**
 * Uploaded photo / pasted image. `img` is a dataURL (downscaled + re-encoded
 * on import so it stays well under the realtime broadcast payload limit).
 */
export interface ImageElement {
  id: string
  type: 'image'
  x: number
  y: number
  w: number
  h: number
  /** data:image/png|jpeg dataURL */
  img: string
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface DraftStroke {
  id: string
  points: number[]
  color: string
  width: number
  marker: boolean
  ts: number
}

export type LocalDraft =
  | { kind: 'path'; points: number[]; color: string; width: number; marker: boolean }
  | { kind: 'shape'; tool: 'rect' | 'ellipse' | 'arrow' | 'line'; x0: number; y0: number; x1: number; y1: number; color: string; width: number; dashed?: boolean }
  | { kind: 'solid3'; shape: Solid3Kind; x0: number; y0: number; x1: number; y1: number; color: string; width: number }
  | { kind: 'edgeDraw'; x1: number; y1: number; x2: number; y2: number; color: string; snapped: boolean }
  | { kind: 'erase'; x: number; y: number; r: number }

export type ConnectionStatus = 'connecting' | 'online' | 'offline'
