import type { BoardElement, Camera, DraftStroke, FuncElement, ImageElement, LineElement, LocalDraft, ShapeElement, Solid3Element } from './types'
import { TEXT_FONT, TEXT_MAX_WIDTH, STICKY_FONT, wrapLines } from './utils'
import { createSolid, edgeDashed, solid3Geom } from './solid3'

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, Math.min(Math.abs(w), Math.abs(h)) / 2))
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, rr)
  } else {
    ctx.moveTo(x + rr, y)
    ctx.arcTo(x + w, y, x + w, y + h, rr)
    ctx.arcTo(x + w, y + h, x, y + h, rr)
    ctx.arcTo(x, y + h, x, y, rr)
    ctx.arcTo(x, y, x + w, y, rr)
    ctx.closePath()
  }
}

function drawSmoothPath(ctx: CanvasRenderingContext2D, pts: number[]) {
  ctx.beginPath()
  const n = pts.length / 2
  if (n === 1) {
    ctx.moveTo(pts[0], pts[1])
    ctx.lineTo(pts[0] + 0.01, pts[1])
    return
  }
  ctx.moveTo(pts[0], pts[1])
  for (let i = 1; i < n - 1; i++) {
    const mx = (pts[i * 2] + pts[(i + 1) * 2]) / 2
    const my = (pts[i * 2 + 1] + pts[(i + 1) * 2 + 1]) / 2
    ctx.quadraticCurveTo(pts[i * 2], pts[i * 2 + 1], mx, my)
  }
  ctx.lineTo(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1])
}

function drawPath(ctx: CanvasRenderingContext2D, el: { points: number[]; color: string; width: number; marker: boolean }) {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = el.color
  ctx.fillStyle = el.color
  if (el.marker) {
    ctx.globalAlpha = 0.32
    ctx.lineWidth = el.width
    if (el.points.length < 4) {
      ctx.beginPath()
      ctx.arc(el.points[0], el.points[1], el.width / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      const pts: number[] = []
      for (let i = 0; i < el.points.length; i += 2) pts.push(el.points[i], el.points[i + 1])
      drawSmoothPath(ctx, pts)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    return
  }
  // pen: per-segment variable width from [x, y, wFactor] triples
  const n = el.points.length / 3
  if (n === 1) {
    const w = el.width * (el.points[2] ?? 1)
    ctx.beginPath()
    ctx.arc(el.points[0], el.points[1], Math.max(w / 2, 0.5), 0, Math.PI * 2)
    ctx.fill()
    return
  }
  for (let i = 1; i < n; i++) {
    const x1 = el.points[(i - 1) * 3]
    const y1 = el.points[(i - 1) * 3 + 1]
    const w1 = el.points[(i - 1) * 3 + 2] ?? 1
    const x2 = el.points[i * 3]
    const y2 = el.points[i * 3 + 1]
    const w2 = el.points[i * 3 + 2] ?? 1
    ctx.lineWidth = Math.max(el.width * ((w1 + w2) / 2), 0.5)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
}

function drawShape(ctx: CanvasRenderingContext2D, el: ShapeElement) {
  ctx.strokeStyle = el.color
  ctx.lineWidth = el.strokeWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (el.type === 'rect') {
    roundRectPath(ctx, el.x, el.y, el.w, el.h, 8)
    ctx.stroke()
    return
  }
  if (el.type === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.abs(el.w / 2), Math.abs(el.h / 2), 0, 0, Math.PI * 2)
    ctx.stroke()
    return
  }
  if (el.type === 'line') {
    const line = el as unknown as LineElement
    ctx.setLineDash(line.dashed ? [line.strokeWidth * 1.8 + 2, line.strokeWidth * 1.2 + 2] : [])
    ctx.beginPath()
    ctx.moveTo(line.x, line.y)
    ctx.lineTo(line.x + line.w, line.y + line.h)
    ctx.stroke()
    ctx.setLineDash([])
    return
  }
  // arrow: keep the drag direction — (x,y) is the start (press point),
  // (w,h) are signed deltas so the tip always follows the cursor
  const x2 = el.x + el.w
  const y2 = el.y + el.h
  const angle = Math.atan2(el.h, el.w)
  const hl = Math.max(14, el.strokeWidth * 3.2)
  ctx.beginPath()
  ctx.moveTo(el.x, el.y)
  ctx.lineTo(x2, y2)
  ctx.moveTo(x2 - hl * Math.cos(angle - 0.45), y2 - hl * Math.sin(angle - 0.45))
  ctx.lineTo(x2, y2)
  ctx.lineTo(x2 - hl * Math.cos(angle + 0.45), y2 - hl * Math.sin(angle + 0.45))
  ctx.stroke()
}

function drawSticky(ctx: CanvasRenderingContext2D, el: { x: number; y: number; w: number; h: number; color: string; text: string }) {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.18)'
  ctx.shadowBlur = 7
  ctx.shadowOffsetY = 2.5
  ctx.fillStyle = el.color
  roundRectPath(ctx, el.x, el.y, el.w, el.h, 4)
  ctx.fill()
  ctx.restore()

  ctx.fillStyle = '#3f3f46'
  ctx.font = STICKY_FONT(16)
  const lines = wrapLines(ctx, el.text || '', el.w - 20)
  const lineHeight = 21
  const maxLines = Math.max(0, Math.floor((el.h - 16) / lineHeight))
  ctx.textBaseline = 'top'
  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    ctx.fillText(lines[i], el.x + 10, el.y + 9 + i * lineHeight)
  }
}

function drawText(ctx: CanvasRenderingContext2D, el: { x: number; y: number; size: number; color: string; text: string }) {
  ctx.fillStyle = el.color
  ctx.font = TEXT_FONT(el.size)
  ctx.textBaseline = 'top'
  const lines = wrapLines(ctx, el.text || '', TEXT_MAX_WIDTH)
  const lineHeight = el.size * 1.3
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) ctx.fillText(lines[i], el.x, el.y + i * lineHeight)
  }
}

function drawSolid3(ctx: CanvasRenderingContext2D, el: Solid3Element) {
  const geom = solid3Geom(el)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = el.color
  ctx.lineWidth = el.strokeWidth
  const solid = new Path2D()
  const dashed = new Path2D()
  for (let i = 0; i < el.edges.length; i++) {
    const e = el.edges[i]
    const pa = geom.pv[e.a]
    const pb = geom.pv[e.b]
    if (!pa || !pb) continue
    const path = edgeDashed(geom, el, i) ? dashed : solid
    path.moveTo(pa.x, pa.y)
    path.lineTo(pb.x, pb.y)
  }
  ctx.setLineDash([])
  ctx.stroke(solid)
  ctx.setLineDash([el.strokeWidth * 1.8 + 2, el.strokeWidth * 1.2 + 2])
  ctx.stroke(dashed)
  ctx.setLineDash([])
  // vertex dots — draggable points of the wireframe
  ctx.fillStyle = el.color
  const r = Math.max(el.strokeWidth * 0.7, 2)
  ctx.beginPath()
  for (const p of geom.pv) {
    ctx.moveTo(p.x + r, p.y)
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
  }
  ctx.fill()
}

/** decoded image cache for func stamps + photo elements (keyed by element id, re-created when img changes) */
const rasterImages = new Map<string, { src: string; img: HTMLImageElement }>()

function getRasterImage(id: string, src: string): HTMLImageElement | null {
  const hit = rasterImages.get(id)
  if (hit && hit.src === src) return hit.img.complete && hit.img.naturalWidth > 0 ? hit.img : null
  if (typeof Image === 'undefined') return null
  const img = new Image()
  img.src = src
  rasterImages.set(id, { src, img })
  if (rasterImages.size > 160) {
    const first = rasterImages.keys().next()
    if (!first.done) rasterImages.delete(first.value)
  }
  return null // drawn as placeholder for this frame; the image appears on the next one
}

/** preload all func stamp + photo images before PNG export (so renderToCanvas sees them) */
export function loadRasterImages(elements: BoardElement[]): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve()
  const imgs: HTMLImageElement[] = []
  for (const el of elements) {
    if (el.type !== 'func' && el.type !== 'image') continue
    const src = el.img
    const hit = rasterImages.get(el.id)
    if (hit && hit.src === src) continue
    const img = new Image()
    img.src = src
    rasterImages.set(el.id, { src, img })
    imgs.push(img)
  }
  if (imgs.length === 0) return Promise.resolve()
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((res) => {
          if (img.complete) return res()
          img.onload = () => res()
          img.onerror = () => res()
        })
    )
  ).then(() => undefined)
}

function drawFunc(ctx: CanvasRenderingContext2D, el: FuncElement) {
  // white card behind the (transparent-cornered) snapshot + soft shadow
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.15)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetY = 2
  ctx.fillStyle = '#ffffff'
  roundRectPath(ctx, el.x, el.y, el.w, el.h, 6)
  ctx.fill()
  ctx.restore()

  const img = getRasterImage(el.id, el.img)
  if (img) {
    ctx.save()
    roundRectPath(ctx, el.x, el.y, el.w, el.h, 6)
    ctx.clip()
    ctx.drawImage(img, el.x, el.y, el.w, el.h)
    ctx.restore()
  }
}

function drawImageEl(ctx: CanvasRenderingContext2D, el: ImageElement) {
  const img = getRasterImage(el.id, el.img)
  if (!img) {
    // placeholder while the dataURL decodes (one frame)
    ctx.save()
    ctx.fillStyle = '#f4f4f5'
    roundRectPath(ctx, el.x, el.y, el.w, el.h, 6)
    ctx.fill()
    ctx.restore()
    return
  }
  // soft shadow from an invisible rounded card
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.15)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetY = 2
  ctx.fillStyle = '#ffffff'
  roundRectPath(ctx, el.x, el.y, el.w, el.h, 6)
  ctx.fill()
  ctx.restore()

  ctx.save()
  roundRectPath(ctx, el.x, el.y, el.w, el.h, 6)
  ctx.clip()
  ctx.drawImage(img, el.x, el.y, el.w, el.h)
  ctx.restore()
}

export function drawElement(ctx: CanvasRenderingContext2D, el: BoardElement | { id?: string; type: 'path'; points: number[]; color: string; width: number; marker: boolean } | { type: 'rect' | 'ellipse' | 'arrow'; x: number; y: number; w: number; h: number; color: string; strokeWidth: number }) {
  switch (el.type) {
    case 'path':
      drawPath(ctx, el as { points: number[]; color: string; width: number; marker: boolean })
      break
    case 'rect':
    case 'ellipse':
    case 'arrow':
      drawShape(ctx, el as ShapeElement)
      break
    case 'line':
      drawShape(ctx, el as unknown as ShapeElement)
      break
    case 'solid3':
      drawSolid3(ctx, el as Solid3Element)
      break
    case 'sticky':
      drawSticky(ctx, el)
      break
    case 'text':
      drawText(ctx, el)
      break
    case 'func':
      drawFunc(ctx, el as FuncElement)
      break
    case 'image':
      drawImageEl(ctx, el as ImageElement)
      break
  }
}

function drawDots(ctx: CanvasRenderingContext2D, cam: Camera, cssW: number, cssH: number) {
  // World-locked dot grid (like Miro): constant spacing in world coordinates,
  // dots scale with zoom. When zoomed out and dots get denser than ~26px on
  // screen they fade out smoothly — no density doubling, no visible "jumps".
  const spacing = 32
  const gap = spacing * cam.zoom // on-screen distance between dots
  if (gap < 13) return // too dense — invisible, and skips a huge fill loop
  const alpha = Math.max(0, Math.min(1, (gap - 13) / 13))
  if (alpha <= 0.01) return

  const wx0 = (0 - cssW / 2) / cam.zoom + cam.x
  const wx1 = (cssW - cssW / 2) / cam.zoom + cam.x
  const wy0 = (0 - cssH / 2) / cam.zoom + cam.y
  const wy1 = (cssH - cssH / 2) / cam.zoom + cam.y
  const startX = Math.floor(wx0 / spacing) * spacing
  const startY = Math.floor(wy0 / spacing) * spacing

  // round dots in screen space (ctx is in CSS px here), world-locked positions,
  // radius grows with zoom but softly capped so it stays tasteful when zoomed in
  const r = Math.min(1.5 * cam.zoom, 3)
  ctx.fillStyle = '#d4d4d8'
  ctx.globalAlpha = alpha
  ctx.beginPath()
  for (let x = startX; x <= wx1; x += spacing) {
    for (let y = startY; y <= wy1; y += spacing) {
      const sx = (x - cam.x) * cam.zoom + cssW / 2
      const sy = (y - cam.y) * cam.zoom + cssH / 2
      ctx.moveTo(sx + r, sy)
      ctx.arc(sx, sy, r, 0, Math.PI * 2)
    }
  }
  ctx.fill()
  ctx.globalAlpha = 1
}

export interface RenderOpts {
  elements: Iterable<BoardElement>
  drafts?: Iterable<DraftStroke>
  localDraft?: LocalDraft | null
  selectedId?: string | null
  /** draw the dot grid background (default true; PNG export passes false) */
  grid?: boolean
}

export function renderBoard(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  dpr: number,
  cam: Camera,
  opts: RenderOpts
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cssW, cssH)
  if (opts.grid !== false) drawDots(ctx, cam, cssW, cssH)

  ctx.setTransform(
    cam.zoom * dpr,
    0,
    0,
    cam.zoom * dpr,
    dpr * (cssW / 2 - cam.x * cam.zoom),
    dpr * (cssH / 2 - cam.y * cam.zoom)
  )

  for (const el of opts.elements) drawElement(ctx, el)

  if (opts.drafts) {
    for (const d of opts.drafts) drawPath(ctx, d)
  }

  const ld = opts.localDraft
  if (ld) {
    if (ld.kind === 'path') {
      drawPath(ctx, { points: ld.points, color: ld.color, width: ld.width, marker: ld.marker })
    } else if (ld.kind === 'shape') {
      const isArrow = ld.tool === 'arrow'
      const isLine = ld.tool === 'line'
      drawShape(ctx, {
        id: 'draft',
        type: isLine ? 'line' : ld.tool,
        // arrow/line keep the drag direction: start = press point, end = cursor;
        // rect/ellipse stay normalized to a top-left anchored box
        x: isArrow || isLine ? ld.x0 : Math.min(ld.x0, ld.x1),
        y: isArrow || isLine ? ld.y0 : Math.min(ld.y0, ld.y1),
        w: isArrow || isLine ? ld.x1 - ld.x0 : Math.abs(ld.x1 - ld.x0),
        h: isArrow || isLine ? ld.y1 - ld.y0 : Math.abs(ld.y1 - ld.y0),
        color: ld.color,
        strokeWidth: ld.width,
        dashed: ld.dashed === true,
      } as unknown as ShapeElement)
    } else if (ld.kind === 'solid3') {
      drawSolid3(ctx, createSolid('draft', ld.shape, ld.x0, ld.y0, ld.x1, ld.y1, ld.color, ld.width))
    } else if (ld.kind === 'edgeDraw') {
      // RMB edge being drawn between two vertices of a solid
      ctx.save()
      ctx.strokeStyle = ld.color
      ctx.lineWidth = 2
      ctx.setLineDash([6, 5])
      ctx.beginPath()
      ctx.moveTo(ld.x1, ld.y1)
      ctx.lineTo(ld.x2, ld.y2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = ld.color
      ctx.beginPath()
      ctx.arc(ld.x2, ld.y2, ld.snapped ? 5 : 3.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    } else if (ld.kind === 'erase') {
      ctx.save()
      ctx.strokeStyle = '#a1a1aa'
      ctx.lineWidth = 1.5 / cam.zoom
      ctx.setLineDash([4 / cam.zoom, 4 / cam.zoom])
      ctx.beginPath()
      ctx.arc(ld.x, ld.y, ld.r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }
}

/** render elements into an offscreen canvas for PNG export */
export function renderToCanvas(
  canvas: HTMLCanvasElement,
  elements: BoardElement[],
  bounds: { x: number; y: number; w: number; h: number },
  scale: number
) {
  canvas.width = Math.max(1, Math.round(bounds.w * scale))
  canvas.height = Math.max(1, Math.round(bounds.h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const cam: Camera = {
    x: bounds.x + bounds.w / 2,
    y: bounds.y + bounds.h / 2,
    zoom: scale,
  }
  // dpr = 1: canvas dims are already device pixels, transform factor = zoom = scale
  renderBoard(ctx, canvas.width, canvas.height, 1, cam, { elements, grid: false })
}
