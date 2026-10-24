import type { Solid3Element, Solid3Kind, Solid3Vertex } from './types'

/**
 * 3D wireframe solids (school stereometry drawings): cube, box, triangular
 * prism, pyramid. Vertices live in world coords (x, y on the board plane,
 * z = depth). The projection is the classic oblique ("кабинетная") one used in
 * textbooks: increasing z shifts the projected point up-right.
 *
 * Hidden edges are detected automatically: a face is front-facing when its
 * outward normal looks towards the viewer (n · VIEW_DIR < 0); an edge is drawn
 * solid when at least one of the faces it lies on is front-facing, otherwise
 * dashed. Chords drawn by the user between vertices are dashed when their
 * midpoint is inside the solid.
 */

export const PROJ_KX = 0.5
export const PROJ_KY = 0.5

/** sight-ray direction: p and p + t·VIEW_DIR project to the same 2D point */
const VIEW_DIR = { x: -PROJ_KX, y: PROJ_KY, z: 1 }

export const projX = (v: Solid3Vertex) => v.x + PROJ_KX * v.z
export const projY = (v: Solid3Vertex) => v.y - PROJ_KY * v.z

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface FacePlane {
  /** outward unit normal (best-fit via Newell's method) */
  n: Vec3
  /** a point on the plane (face centroid) */
  c: Vec3
  /** front-facing = seen by the viewer */
  visible: boolean
}

export interface Solid3Geom {
  /** projected vertex positions (board-plane coords) */
  pv: Array<{ x: number; y: number }>
  planes: FacePlane[]
  /** plane-distance tolerance, scaled to the solid size */
  eps: number
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z

function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/** point in polygon (ray crossing); points on the boundary count as inside */
export function pointInPoly(pts: Array<{ x: number; y: number }>, x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if (distToSeg(x, y, pts[i].x, pts[i].y, pts[j].x, pts[j].y) < 0.75) return true
    const yi = pts[i].y
    const yj = pts[j].y
    if ((yi > y) !== (yj > y) && x < ((pts[j].x - pts[i].x) * (y - yi)) / (yj - yi) + pts[i].x) {
      inside = !inside
    }
  }
  return inside
}

/** best-fit plane of a face; the normal is oriented OUTWARD (solid centroid inside) */
function newellPlane(verts: Solid3Vertex[], face: number[], centroid: Vec3): { n: Vec3; c: Vec3 } {
  let nx = 0
  let ny = 0
  let nz = 0
  let cx = 0
  let cy = 0
  let cz = 0
  const k = face.length
  for (let i = 0; i < k; i++) {
    const p = verts[face[i]]
    const q = verts[face[(i + 1) % k]]
    nx += (p.y - q.y) * (p.z + q.z)
    ny += (p.z - q.z) * (p.x + q.x)
    nz += (p.x - q.x) * (p.y + q.y)
    cx += p.x
    cy += p.y
    cz += p.z
  }
  const len = Math.hypot(nx, ny, nz) || 1
  const c = { x: cx / k, y: cy / k, z: cz / k }
  let n = { x: nx / len, y: ny / len, z: nz / len }
  const outward: Vec3 = { x: c.x - centroid.x, y: c.y - centroid.y, z: c.z - centroid.z }
  if (dot(n, outward) < 0) n = { x: -n.x, y: -n.y, z: -n.z }
  return { n, c }
}

/** projection + face planes + tolerances for visibility math (cheap, call per render) */
export function solid3Geom(el: Solid3Element): Solid3Geom {
  const pv = el.vertices.map((v) => ({ x: projX(v), y: projY(v) }))
  let gx = 0
  let gy = 0
  let gz = 0
  for (const v of el.vertices) {
    gx += v.x
    gy += v.y
    gz += v.z
  }
  const k = el.vertices.length || 1
  const centroid: Vec3 = { x: gx / k, y: gy / k, z: gz / k }
  let radius = 0
  for (const v of el.vertices) {
    radius = Math.max(radius, Math.hypot(v.x - centroid.x, v.y - centroid.y, v.z - centroid.z))
  }
  const planes = el.faces.map((face) => {
    const { n, c } = newellPlane(el.vertices, face, centroid)
    return { n, c, visible: dot(n, VIEW_DIR) < 0 }
  })
  return { pv, planes, eps: Math.max(1, radius * 0.012) }
}

/**
 * Visibility of one edge: on the surface -> solid iff some face under it is
 * front-facing; strictly inside the solid -> dashed; outside -> solid.
 */
export function edgeDashed(geom: Solid3Geom, el: Solid3Element, ei: number): boolean {
  const e = el.edges[ei]
  if (!e) return false
  const a = el.vertices[e.a]
  const b = el.vertices[e.b]
  if (!a || !b) return false
  const m: Vec3 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
  const mp = { x: projX(m), y: projY(m) }
  let onAny = false
  let onVisible = false
  for (let f = 0; f < el.faces.length; f++) {
    const pl = geom.planes[f]
    const d = dot(pl.n, { x: m.x - pl.c.x, y: m.y - pl.c.y, z: m.z - pl.c.z })
    if (Math.abs(d) > geom.eps) continue
    const loop = el.faces[f].map((i) => geom.pv[i])
    if (!pointInPoly(loop, mp.x, mp.y)) continue
    onAny = true
    if (pl.visible) onVisible = true
  }
  if (onAny) return !onVisible
  for (const pl of geom.planes) {
    if (dot(pl.n, { x: m.x - pl.c.x, y: m.y - pl.c.y, z: m.z - pl.c.z }) > geom.eps) return false
  }
  return true
}

/**
 * Build a solid from a drag rect (any direction). Cube fits a square into the
 * drag (anchored bottom-center); box uses the rect as the front face; prism
 * and pyramid use the rect as their base footprint on the ground plane; depth
 * is half of the smaller side.
 */
export function createSolid(
  id: string,
  kind: Solid3Kind,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  strokeWidth: number
): Solid3Element {
  const x = Math.min(x0, x1)
  const y = Math.min(y0, y1)
  const w = Math.max(Math.abs(x1 - x0), 24)
  const h = Math.max(Math.abs(y1 - y0), 24)
  const V: Solid3Vertex[] = []
  const E: Array<{ a: number; b: number }> = []
  const F: number[][] = []
  if (kind === 'cube' || kind === 'box') {
    const fw = kind === 'cube' ? Math.min(w, h) : w
    const fh = kind === 'cube' ? Math.min(w, h) : h
    const fx = kind === 'cube' ? x + (w - fw) / 2 : x
    const by = y + fh
    const D = kind === 'cube' ? 0.45 * fw : 0.5 * Math.min(w, h)
    V.push(
      { x: fx, y: by, z: 0 },
      { x: fx + fw, y: by, z: 0 },
      { x: fx + fw, y: by - fh, z: 0 },
      { x: fx, y: by - fh, z: 0 },
      { x: fx, y: by, z: D },
      { x: fx + fw, y: by, z: D },
      { x: fx + fw, y: by - fh, z: D },
      { x: fx, y: by - fh, z: D }
    )
    E.push(
      { a: 0, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 3 }, { a: 3, b: 0 },
      { a: 4, b: 5 }, { a: 5, b: 6 }, { a: 6, b: 7 }, { a: 7, b: 4 },
      { a: 0, b: 4 }, { a: 1, b: 5 }, { a: 2, b: 6 }, { a: 3, b: 7 }
    )
    F.push([0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [1, 2, 6, 5], [0, 3, 7, 4])
  } else if (kind === 'prism') {
    // prism standing on its triangular base: base ABC on the ground plane
    // (front edge AB, rear vertex C pushed back by D), top triangle directly
    // above — the classic upright textbook drawing
    const D = 0.5 * Math.min(w, h)
    const H = Math.max(h - PROJ_KY * D, h * 0.3)
    V.push(
      { x, y: y + h, z: 0 },
      { x: x + w, y: y + h, z: 0 },
      { x: x + w / 2, y: y + h, z: D },
      { x, y: y + h - H, z: 0 },
      { x: x + w, y: y + h - H, z: 0 },
      { x: x + w / 2, y: y + h - H, z: D }
    )
    E.push(
      { a: 0, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 0 },
      { a: 3, b: 4 }, { a: 4, b: 5 }, { a: 5, b: 3 },
      { a: 0, b: 3 }, { a: 1, b: 4 }, { a: 2, b: 5 }
    )
    F.push([0, 1, 2], [3, 4, 5], [0, 1, 4, 3], [1, 2, 5, 4], [2, 0, 3, 5])
  } else {
    // pyramid: triangular base on the ground plane (front edge AB, rear vertex
    // C pushed back by D), apex S above the base centroid — the classic
    // textbook drawing of a triangular pyramid
    const D = 0.5 * Math.min(w, h)
    const H = Math.max(h - (PROJ_KY * D) / 3, h * 0.3)
    V.push(
      { x, y: y + h, z: 0 },
      { x: x + w, y: y + h, z: 0 },
      { x: x + w / 2, y: y + h, z: D },
      { x: x + w / 2, y: y + h - H, z: D / 3 }
    )
    E.push(
      { a: 0, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 0 },
      { a: 0, b: 3 }, { a: 1, b: 3 }, { a: 2, b: 3 }
    )
    F.push([0, 1, 2], [0, 1, 3], [1, 2, 3], [2, 0, 3])
  }
  return { id, type: 'solid3', shape: kind, vertices: V, edges: E, faces: F, color, strokeWidth }
}

/** drag a vertex: the pointer moves the board-plane part (x, y), depth z is kept */
export function moveSolidVertex(el: Solid3Element, vi: number, sx: number, sy: number): Solid3Element {
  const v = el.vertices[vi]
  if (!v) return el
  const vertices = el.vertices.slice()
  vertices[vi] = { x: sx - PROJ_KX * v.z, y: sy + PROJ_KY * v.z, z: v.z }
  return { ...el, vertices }
}

/**
 * double-click on an edge: insert a draggable point at the clicked position
 * (projected onto the edge, clamped away from the endpoints); without click
 * coords the point lands in the middle.
 */
export function splitSolidEdge(
  el: Solid3Element,
  ei: number,
  wx?: number,
  wy?: number
): { el: Solid3Element; index: number } {
  const e = el.edges[ei]
  if (!e) return { el, index: -1 }
  const a = el.vertices[e.a]
  const b = el.vertices[e.b]
  let t = 0.5
  if (wx !== undefined && wy !== undefined) {
    const ax = projX(a)
    const ay = projY(a)
    const dx = projX(b) - ax
    const dy = projY(b) - ay
    const len2 = dx * dx + dy * dy
    if (len2 > 0) {
      t = ((wx - ax) * dx + (wy - ay) * dy) / len2
      t = Math.max(0.08, Math.min(0.92, t))
    }
  }
  const m: Solid3Vertex = {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  }
  const vertices = [...el.vertices, m]
  const mi = vertices.length - 1
  const edges = el.edges.slice()
  edges[ei] = { a: e.a, b: mi }
  edges.push({ a: mi, b: e.b })
  // keep faces consistent: insert the new vertex into every loop passing a->b
  const faces = el.faces.map((face) => {
    const k = face.length
    for (let i = 0; i < k; i++) {
      const p = face[i]
      const q = face[(i + 1) % k]
      if ((p === e.a && q === e.b) || (p === e.b && q === e.a)) {
        const out = face.slice()
        out.splice(i + 1, 0, mi)
        return out
      }
    }
    return face
  })
  return { el: { ...el, vertices, edges, faces }, index: mi }
}

/** connect two vertices with a new edge (dedup); visibility is computed at render */
export function addSolidEdge(el: Solid3Element, a: number, b: number): Solid3Element | null {
  if (a === b || a < 0 || b < 0 || a >= el.vertices.length || b >= el.vertices.length) return null
  if (el.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) return null
  return { ...el, edges: [...el.edges, { a, b }] }
}

/**
 * Tap on an edge: flip its rendered style dashed <-> solid. The override is
 * stored on the edge, so afterwards the edge keeps the chosen style even when
 * moving vertices re-computes hidden-line visibility for the rest.
 */
export function toggleSolidEdgeDash(el: Solid3Element, ei: number): Solid3Element | null {
  const e = el.edges[ei]
  if (!e) return null
  const computed = edgeDashed(solid3Geom(el), el, ei)
  const effective = e.dash ?? computed
  const edges = el.edges.slice()
  edges[ei] = { a: e.a, b: e.b, dash: !effective }
  return { ...el, edges }
}

/** move the whole solid (element move) */
export function translateSolid(el: Solid3Element, dx: number, dy: number): Solid3Element {
  return { ...el, vertices: el.vertices.map((v) => ({ ...v, x: v.x + dx, y: v.y + dy })) }
}

export type SolidPick =
  | { kind: 'vertex'; vi: number }
  | { kind: 'edge'; ei: number }
  | { kind: 'inside' }

/** hit-test with part precision: vertex (for dragging / RMB edge draw), edge, or fill */
export function pickSolid(el: Solid3Element, wx: number, wy: number, tol: number): SolidPick | null {
  const g = solid3Geom(el)
  let bestV = -1
  let bestD = tol + 4
  for (let i = 0; i < g.pv.length; i++) {
    const d = Math.hypot(g.pv[i].x - wx, g.pv[i].y - wy)
    if (d < bestD) {
      bestD = d
      bestV = i
    }
  }
  if (bestV >= 0) return { kind: 'vertex', vi: bestV }
  const et = el.strokeWidth / 2 + tol
  for (let i = el.edges.length - 1; i >= 0; i--) {
    const e = el.edges[i]
    if (distToSeg(wx, wy, g.pv[e.a].x, g.pv[e.a].y, g.pv[e.b].x, g.pv[e.b].y) <= et) {
      return { kind: 'edge', ei: i }
    }
  }
  for (const f of el.faces) {
    if (pointInPoly(f.map((i) => g.pv[i]), wx, wy)) return { kind: 'inside' }
  }
  return null
}

/** projected bounding box (for selection frames / marquee / export) */
export function solid3Bounds(el: Solid3Element): { x: number; y: number; w: number; h: number } {
  const g = solid3Geom(el)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of g.pv) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
