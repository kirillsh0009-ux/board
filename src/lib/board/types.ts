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

export type ElementType = 'path' | 'rect' | 'ellipse' | 'arrow' | 'sticky' | 'text'

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

export type BoardElement = PathElement | ShapeElement | StickyElement | TextElement

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
  | { kind: 'shape'; tool: 'rect' | 'ellipse' | 'arrow'; x0: number; y0: number; x1: number; y1: number; color: string; width: number }
  | { kind: 'erase'; x: number; y: number; r: number }

export type ConnectionStatus = 'connecting' | 'online' | 'offline'
