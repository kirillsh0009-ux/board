import type { BoardElement, Rect, TextElement, PathElement } from './types'

const ID_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'

export function uid(len = 10): string {
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  let out = ''
  for (let i = 0; i < len; i++) out += ID_ALPHABET[arr[i] % ID_ALPHABET.length]
  return out
}

export const boardCode = () => uid(8)

export const PEN_COLORS = [
  '#1e293b',
  '#e11d48',
  '#f97316',
  '#eab308',
  '#16a34a',
  '#0d9488',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#78716c',
]

export const STICKY_COLORS = ['#fff176', '#ffcc80', '#f8bbd0', '#a5d6a7', '#80cbc4', '#e0e0e0']

export const USER_COLORS = ['#e11d48', '#f97316', '#16a34a', '#0d9488', '#7c3aed', '#db2777', '#ca8a04', '#0284c7']

export const STROKE_WIDTHS = [
  { value: 2, label: 'Тонкая' },
  { value: 4, label: 'Обычная' },
  { value: 7, label: 'Толстая' },
  { value: 12, label: 'Жирная' },
]

const GUEST_NAMES = ['Гость', 'Художник', 'Мыслитель', 'Капитан', 'Пилот', 'Изобретатель', 'Исследователь']

export function randomGuest(): { name: string; color: string } {
  const name = `${GUEST_NAMES[Math.floor(Math.random() * GUEST_NAMES.length)]}-${Math.floor(100 + Math.random() * 900)}`
  const color = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]
  return { name, color }
}

// ---------- geometry ----------

export function normRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  }
}

function expandRect(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b }
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  }
}

/** offscreen canvas for text measurement */
let measureCtx: CanvasRenderingContext2D | null = null
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const c = document.createElement('canvas')
    measureCtx = c.getContext('2d')!
  }
  return measureCtx
}

export const STICKY_FONT = (size = 16) => `${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
export const TEXT_FONT = (size: number) => `${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
export const TEXT_MAX_WIDTH = 560

export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = []
  for (const rawLine of text.split('\n')) {
    if (rawLine === '') {
      out.push('')
      continue
    }
    const words = rawLine.split(/(\s+)/)
    let line = ''
    for (const word of words) {
      const test = line + word
      if (ctx.measureText(test).width > maxWidth && line.trim() !== '') {
        out.push(line.replace(/\s+$/, ''))
        line = word.replace(/^\s+/, '')
      } else {
        line = test
      }
      // break very long words
      while (ctx.measureText(line).width > maxWidth && line.length > 1) {
        let cut = line.length - 1
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--
        out.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    out.push(line)
  }
  return out
}

export function textBounds(el: TextElement): Rect {
  const ctx = getMeasureCtx()
  ctx.font = TEXT_FONT(el.size)
  const lines = wrapLines(ctx, el.text, TEXT_MAX_WIDTH)
  let w = 0
  for (const l of lines) w = Math.max(w, ctx.measureText(l).width)
  const h = Math.max(el.size * 1.3, lines.length * el.size * 1.3)
  return { x: el.x, y: el.y, w: Math.max(w, 8), h }
}

export function pathBounds(el: PathElement): Rect {
  const step = el.marker ? 2 : 3
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < el.points.length; i += step) {
    const x = el.points[i]
    const y = el.points[i + 1]
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function elementBounds(el: BoardElement): Rect {
  switch (el.type) {
    case 'path':
      return pathBounds(el)
    case 'text':
      return textBounds(el)
    case 'arrow': {
      // w/h are signed deltas (direction of the arrow) — normalize to a bbox
      const x2 = el.x + el.w
      const y2 = el.y + el.h
      return { x: Math.min(el.x, x2), y: Math.min(el.y, y2), w: Math.abs(el.w), h: Math.abs(el.h) }
    }
    default:
      return { x: el.x, y: el.y, w: el.w, h: el.h }
  }
}

export function elementsBounds(elements: Iterable<BoardElement>): Rect | null {
  let acc: Rect | null = null
  for (const el of elements) acc = unionRect(acc, elementBounds(el))
  return acc
}

export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

export function hitElement(el: BoardElement, wx: number, wy: number, tol: number): boolean {
  switch (el.type) {
    case 'path': {
      const step = el.marker ? 2 : 3
      const halfW = el.width / 2 + tol
      for (let i = 0; i + step - 1 < el.points.length; i += step) {
        const x1 = el.points[i]
        const y1 = el.points[i + 1]
        if (i + step * 2 - 1 >= el.points.length && el.points.length <= step) {
          return Math.hypot(wx - x1, wy - y1) <= halfW
        }
        const j = i + step
        if (j + 1 >= el.points.length + 1) break
        const x2 = el.points[j]
        const y2 = el.points[j + 1]
        if (j + 1 < el.points.length + 1 && x2 !== undefined && y2 !== undefined) {
          if (distToSegment(wx, wy, x1, y1, x2, y2) <= halfW) return true
        }
      }
      if (el.points.length === step) return Math.hypot(wx - el.points[0], wy - el.points[1]) <= halfW
      return false
    }
    case 'rect':
    case 'sticky': {
      const r = expandRect({ x: el.x, y: el.y, w: el.w, h: el.h }, el.type === 'rect' ? el.strokeWidth / 2 + tol : tol)
      return wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h
    }
    case 'ellipse': {
      const cx = el.x + el.w / 2
      const cy = el.y + el.h / 2
      const rx = el.w / 2 + tol
      const ry = el.h / 2 + tol
      if (rx <= 0 || ry <= 0) return false
      return ((wx - cx) / rx) ** 2 + ((wy - cy) / ry) ** 2 <= 1
    }
    case 'arrow': {
      return distToSegment(wx, wy, el.x, el.y, el.x + el.w, el.y + el.h) <= el.strokeWidth / 2 + tol
    }
    case 'text': {
      const r = expandRect(textBounds(el), tol)
      return wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h
    }
  }
}

export function moveElement<T extends BoardElement>(el: T, dx: number, dy: number): T {
  if (el.type === 'path') {
    const points = el.points.slice()
    const step = el.marker ? 2 : 3
    for (let i = 0; i < points.length; i += step) {
      points[i] += dx
      points[i + 1] += dy
    }
    return { ...el, points }
  }
  return { ...el, x: el.x + dx, y: el.y + dy }
}

// ---------- recent boards (localStorage) ----------

export interface RecentBoard {
  id: string
  name: string
  ts: number
}

const RECENTS_KEY = 'board-recents'

export function getRecents(): RecentBoard[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as RecentBoard[]
    return Array.isArray(list) ? list.slice(0, 20) : []
  } catch {
    return []
  }
}

export function upsertRecent(id: string, name: string): RecentBoard[] {
  const list = getRecents().filter((r) => r.id !== id)
  list.unshift({ id, name, ts: Date.now() })
  const trimmed = list.slice(0, 20)
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(trimmed))
  } catch {
    /* ignore */
  }
  return trimmed
}

export function removeRecent(id: string): RecentBoard[] {
  const list = getRecents().filter((r) => r.id !== id)
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
  return list
}

/** extract board id from raw user input: plain code or full URL with ?board= */
export function parseBoardInput(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  const m = value.match(/[?&]board=([a-zA-Z0-9_-]{4,32})/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9_-]{4,32}$/.test(value)) return value
  return null
}

export function formatDate(ts: number): string {
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return 'только что'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч назад`
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}
