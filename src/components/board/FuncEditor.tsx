'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, Plus, Minus, RotateCcw } from 'lucide-react'
import { compileAll, niceStep, fmtTick, splitExprs } from '@/lib/board/funcplot'
import type { TextElement } from '@/lib/board/types'

/** coarse pointer (iPad/phone): the on-screen keyboard must appear only on a
 *  direct tap into an input field — read lazily (pointer can change at runtime) */
export const isCoarsePointer = () =>
  window.matchMedia?.('(pointer: coarse)')?.matches ?? false

const COLORS = ['#e11d48', '#059669', '#d97706', '#7c3aed', '#0891b2', '#65a30d']
const FUNC_TOKEN = '[func]'

/** extract the expression stored after "[func]" in the element text */
export function extractFuncExpr(text: string): string {
  const idx = text.indexOf(FUNC_TOKEN)
  if (idx === -1) return ''
  const rest = text.slice(idx + FUNC_TOKEN.length)
  const lineEnd = rest.indexOf('\n')
  return (lineEnd === -1 ? rest : rest.slice(0, lineEnd)).trim()
}

/** graph view stored inside a func stamp (math center + px per unit) */
export interface FuncView {
  cx: number
  cy: number
  scale: number
}

/** everything the owner needs to stamp the currently visible graph onto the board */
export interface FuncStampData {
  expr: string
  view: FuncView
  /** graph canvas top-left in viewport (overlay) coordinates */
  sx: number
  sy: number
  /** graph canvas CSS size */
  w: number
  h: number
  /** PNG dataURL of the visible graph (rounded corners + frame baked in) */
  img: string | null
  /** at least one valid expression is plotted */
  valid: boolean
}

export interface FuncStampApi {
  getStamp: () => FuncStampData | null
}

interface FuncEditorProps {
  el?: TextElement
  /** stamp re-edit mode: seed expr/view/size from an existing func element */
  initial?: { expr: string; view: FuncView; w: number; h: number }
  /** text mode: reopen seed from this text's linked stamp (view/size survive) */
  seed?: { view: FuncView; w: number; h: number }
  anchor: { sx: number; sy: number }
  viewport: { w: number; h: number }
  containerRef: React.RefObject<HTMLDivElement | null>
  /** registered with getStamp() every render — call it before closing to stamp */
  stampApiRef?: React.MutableRefObject<FuncStampApi | null>
  onClose: () => void
  /** (text mode) writes the new element text back into the store */
  onWriteText?: (newText: string) => void
}

/** build the new element text: replace the segment after the [func] token on its line */
export function withExpr(text: string, expr: string): string {
  const idx = text.indexOf(FUNC_TOKEN)
  const seg = expr.trim() ? ` ${expr.trim()}` : ''
  if (idx === -1) return expr.trim() ? `${text}${text ? '\n' : ''}${FUNC_TOKEN}${seg}`.trimStart() : text
  const lineEnd = text.indexOf('\n', idx)
  const at = idx + FUNC_TOKEN.length
  return text.slice(0, at) + seg + (lineEnd === -1 ? '' : text.slice(lineEnd))
}

/** PNG snapshot with rounded corners + border baked in (corners transparent) */
function snapshotWithFrame(canvas: HTMLCanvasElement): string | null {
  const off = document.createElement('canvas')
  off.width = canvas.width
  off.height = canvas.height
  const ctx = off.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(canvas, 0, 0)
  const cssW = canvas.getBoundingClientRect().width || canvas.width
  const px = canvas.width / cssW // device scale
  const r = 8 * px
  const lw = Math.max(1, Math.round(px))
  ctx.globalCompositeOperation = 'destination-in'
  rrPath(ctx, 0, 0, canvas.width, canvas.height, r)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
  ctx.strokeStyle = '#d4d4d8'
  ctx.lineWidth = lw
  rrPath(ctx, lw / 2, lw / 2, canvas.width - lw, canvas.height - lw, r)
  ctx.stroke()
  return off.toDataURL('image/png')
}

function rrPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2))
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

/** marching squares case table: bit 1=v00, 2=v10, 4=v11, 8=v01; edges 0=bottom,1=right,2=top,3=left */
const CASE_SEGS: Array<Array<[number, number]>> = [
  [],
  [[3, 0]],
  [[0, 1]],
  [[3, 1]],
  [[1, 2]],
  [[3, 2], [0, 1]],
  [[0, 2]],
  [[3, 2]],
  [[2, 3]],
  [[0, 2]],
  [[0, 3], [1, 2]],
  [[1, 2]],
  [[3, 1]],
  [[0, 1]],
  [[0, 3]],
  [],
]

export default function FuncEditor({ el, initial, seed, anchor, viewport, containerRef, stampApiRef, onClose, onWriteText }: FuncEditorProps) {
  const isStamp = initial !== undefined
  const seedSrc = initial ?? seed
  const [expr, setExpr] = useState(() => (initial ? initial.expr : el ? extractFuncExpr(el.text) : ''))
  const [size, setSize] = useState(() => (seedSrc ? { w: seedSrc.w, h: seedSrc.h } : { w: 440, h: 250 }))
  const [view, setView] = useState<FuncView>(() =>
    seedSrc ? { ...seedSrc.view } : { cx: 0, cy: 0, scale: 440 / 13 }
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const resizeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const appliedRef = useRef(expr)
  const dirtyRef = useRef(false)
  const exprRef = useRef(expr)
  useEffect(() => {
    exprRef.current = expr
  })

  const fns = useMemo(() => compileAll(expr), [expr])
  const firstError = fns.find((f) => f.error)?.error ?? null
  const hasAnything = splitExprs(expr).length > 0

  // coarse pointer: skip the autofocus — the system keyboard would cover half
  // the screen. Desktop keeps it ("курсор переключается в окошко").
  useEffect(() => {
    if (isCoarsePointer()) return
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [])

  // virtual caret: keypad edits track the selection even while the input is
  // unfocused (no focus() — it would pop the system keyboard)
  const caretRef = useRef({ s: -1, e: -1 })
  const trackCaret = (el: HTMLInputElement) => {
    caretRef.current = {
      s: el.selectionStart ?? el.value.length,
      e: el.selectionEnd ?? el.selectionStart ?? el.value.length,
    }
  }
  const caretOf = (input: HTMLInputElement): { s: number; e: number } => {
    if (document.activeElement === input) {
      const s = input.selectionStart ?? input.value.length
      return { s, e: input.selectionEnd ?? s }
    }
    const c = caretRef.current
    return c.s >= 0 ? c : { s: input.value.length, e: input.value.length }
  }

  /** (text mode) write expression back into the element text (debounced) */
  useEffect(() => {
    if (isStamp) return
    if (expr === appliedRef.current) return
    const t = setTimeout(() => {
      appliedRef.current = expr
      dirtyRef.current = false
      onWriteText?.(expr)
    }, 400)
    return () => clearTimeout(t)
  }, [expr, isStamp, onWriteText])

  /** (text mode) final write on close/unmount (expr via ref — the closure would be stale) */
  useEffect(() => {
    if (isStamp) return
    return () => {
      if (dirtyRef.current) {
        dirtyRef.current = false
        onWriteText?.(exprRef.current)
      }
    }
  }, [isStamp, onWriteText])

  const markDirty = useCallback(() => {
    dirtyRef.current = true
  }, [])

  // ---- graph drawing -------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const { w, h } = size
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const { cx, cy, scale } = view
    const worldLeft = cx - w / 2 / scale
    const worldRight = cx + w / 2 / scale
    const worldTop = cy + h / 2 / scale
    const worldBottom = cy - h / 2 / scale
    const X = (wx: number) => (wx - cx) * scale + w / 2
    const Y = (wy: number) => h / 2 - (wy - cy) * scale

    // grid
    const step = niceStep(scale)
    ctx.lineWidth = 1
    ctx.strokeStyle = '#f4f4f5'
    ctx.beginPath()
    for (let gx = Math.ceil(worldLeft / step) * step; gx <= worldRight; gx += step) {
      const px = Math.round(X(gx)) + 0.5
      ctx.moveTo(px, 0)
      ctx.lineTo(px, h)
    }
    for (let gy = Math.ceil(worldBottom / step) * step; gy <= worldTop; gy += step) {
      const py = Math.round(Y(gy)) + 0.5
      ctx.moveTo(0, py)
      ctx.lineTo(w, py)
    }
    ctx.stroke()

    // axes
    ctx.strokeStyle = '#a1a1aa'
    ctx.beginPath()
    if (Y(0) >= 0 && Y(0) <= h) {
      ctx.moveTo(0, Math.round(Y(0)) + 0.5)
      ctx.lineTo(w, Math.round(Y(0)) + 0.5)
    }
    if (X(0) >= 0 && X(0) <= w) {
      ctx.moveTo(Math.round(X(0)) + 0.5, 0)
      ctx.lineTo(Math.round(X(0)) + 0.5, h)
    }
    ctx.stroke()

    // tick labels
    ctx.fillStyle = '#71717a'
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
    const xAxisY = Math.max(12, Math.min(h - 5, Y(0) + 12))
    for (let gx = Math.ceil(worldLeft / step) * step; gx <= worldRight; gx += step) {
      if (Math.abs(gx) < step / 2) continue
      ctx.fillText(fmtTick(gx, step), X(gx) + 2, xAxisY)
    }
    const yAxisX = Math.max(3, Math.min(w - 34, X(0) + 4))
    for (let gy = Math.ceil(worldBottom / step) * step; gy <= worldTop; gy += step) {
      if (Math.abs(gy) < step / 2) continue
      ctx.fillText(fmtTick(gy, step), yAxisX, Y(gy) - 3)
    }

    // curves
    const valid = fns.filter((f) => !f.error && f.raw)
    const explicit = valid.filter((f) => !f.usesY)
    const implicit = valid.filter((f) => f.usesY)

    let N = Math.round(Math.min(Math.max(w, 240), 700))
    if (explicit.length > 1) N = Math.min(N, Math.max(300, Math.floor(3600 / explicit.length)))
    const breakWorld = (h / scale) * 6

    for (let k = 0; k < explicit.length; k++) {
      const f = explicit[k]
      ctx.beginPath()
      ctx.strokeStyle = COLORS[k % COLORS.length]
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      let prevY: number | null = null
      for (let i = 0; i <= N; i++) {
        const wx = worldLeft + ((worldRight - worldLeft) * i) / N
        const y = f.f(wx, 0)
        if (!isFinite(y) || Math.abs(y) > 1e9) {
          prevY = null
          continue
        }
        const sy = Y(y)
        const jump = prevY !== null && Math.abs(y - prevY) > breakWorld
        const signFlip = prevY !== null && prevY * y < 0 && Math.abs(y - prevY) > (h / scale) * 1.5
        if (prevY === null || jump || signFlip) ctx.moveTo(X(wx), sy)
        else ctx.lineTo(X(wx), sy)
        prevY = y
      }
      ctx.stroke()
    }

    // implicit curves (equations with y) via marching squares
    for (let k = 0; k < implicit.length; k++) {
      const f = implicit[k]
      ctx.beginPath()
      ctx.strokeStyle = COLORS[(explicit.length + k) % COLORS.length]
      ctx.lineWidth = 2
      const gw = 120
      const gh = Math.max(40, Math.round((120 * h) / w))
      const dx = (worldRight - worldLeft) / gw
      const dy = (worldTop - worldBottom) / gh
      const vals = new Float64Array((gw + 1) * (gh + 1))
      for (let j = 0; j <= gh; j++) {
        const wy = worldBottom + j * dy
        for (let i = 0; i <= gw; i++) {
          const v = f.f(worldLeft + i * dx, wy)
          vals[j * (gw + 1) + i] = isFinite(v) && Math.abs(v) < 1e12 ? v : NaN
        }
      }
      for (let j = 0; j < gh; j++) {
        for (let i = 0; i < gw; i++) {
          const v00 = vals[j * (gw + 1) + i]
          const v10 = vals[j * (gw + 1) + i + 1]
          const v11 = vals[(j + 1) * (gw + 1) + i + 1]
          const v01 = vals[(j + 1) * (gw + 1) + i]
          if (isNaN(v00) || isNaN(v10) || isNaN(v11) || isNaN(v01)) continue
          let cs = 0
          if (v00 > 0) cs |= 1
          if (v10 > 0) cs |= 2
          if (v11 > 0) cs |= 4
          if (v01 > 0) cs |= 8
          const segs = CASE_SEGS[cs]
          if (segs.length === 0) continue
          const bx = worldLeft + i * dx
          const by = worldBottom + j * dy
          const pts: Array<[number, number]> = [
            [bx + dx * (v00 / (v00 - v10)), by],
            [bx + dx, by + dy * (v10 / (v10 - v11))],
            [bx + dx * (v01 / (v01 - v11)), by + dy],
            [bx, by + dy * (v00 / (v00 - v01))],
          ]
          for (const [a, b] of segs) {
            ctx.moveTo(X(pts[a][0]), Y(pts[a][1]))
            ctx.lineTo(X(pts[b][0]), Y(pts[b][1]))
          }
        }
      }
      ctx.stroke()
    }
  }, [fns, size, view])

  // rAF-throttled redraw
  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [draw])

  // ---- interactions --------------------------------------------------------
  // wheel zoom around cursor (non-passive to preventDefault)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = Math.exp(-e.deltaY * 0.0015)
      setView((v) => {
        const ns = Math.max(2, Math.min(5000, v.scale * factor))
        const wx = v.cx + (mx - size.w / 2) / v.scale
        const wy = v.cy + (size.h / 2 - my) / v.scale
        return { scale: ns, cx: wx - (mx - size.w / 2) / ns, cy: wy - (size.h / 2 - my) / ns }
      })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [size])

  const zoomBy = (factor: number) =>
    setView((v) => ({ ...v, scale: Math.max(2, Math.min(5000, v.scale * factor)) }))

  const resetView = () => setView({ cx: 0, cy: 0, scale: size.w / 13 })

  const onCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    inputRef.current?.blur() // fold the system keyboard when panning the graph
    try {
      ;(e.target as HTMLCanvasElement).setPointerCapture(e.pointerId)
    } catch {
      // pointer may already be released (or synthetic) — the drag still works
    }
    dragRef.current = { x: e.clientX, y: e.clientY }
  }
  const onCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const last = dragRef.current
    if (!last) return
    const dx = e.clientX - last.x
    const dy = e.clientY - last.y
    dragRef.current = { x: e.clientX, y: e.clientY }
    setView((v) => ({ ...v, cx: v.cx - dx / v.scale, cy: v.cy + dy / v.scale }))
  }
  const onCanvasPointerUp = () => {
    dragRef.current = null
  }

  const onResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      ;(e.target as HTMLDivElement).setPointerCapture(e.pointerId)
    } catch {
      // pointer may already be released (or synthetic) — the resize still works
    }
    resizeRef.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }
  }
  const onResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = resizeRef.current
    if (!st) return
    const maxW = Math.min(920, window.innerWidth - 28)
    const maxH = Math.min(640, window.innerHeight - 150)
    setSize({
      w: Math.max(260, Math.min(maxW, st.w + (e.clientX - st.x))),
      h: Math.max(180, Math.min(maxH, st.h + (e.clientY - st.y))),
    })
  }
  const onResizePointerUp = () => {
    resizeRef.current = null
  }

  // ---- keypad actions (event handlers — ref access is fine here) -----------
  const insert = (str: string, caretBack = 0) => {
    markDirty()
    const input = inputRef.current
    if (!input) {
      setExpr((e) => e + str)
      return
    }
    const { s, e: eEnd } = caretOf(input)
    const next = input.value.slice(0, s) + str + input.value.slice(eEnd)
    const pos = s + str.length - caretBack
    caretRef.current = { s: pos, e: pos }
    setExpr(next)
    requestAnimationFrame(() => {
      // focus() would pop the system keyboard on touch devices; restore the
      // caret only when the input is already focused (desktop or direct tap)
      if (!isCoarsePointer()) input.focus()
      if (document.activeElement === input) input.setSelectionRange(pos, pos)
    })
  }

  const backspace = () => {
    markDirty()
    const input = inputRef.current
    if (!input) {
      setExpr((e) => e.slice(0, -1))
      return
    }
    const { s, e: eEnd } = caretOf(input)
    if (s !== eEnd) {
      const next = input.value.slice(0, s) + input.value.slice(eEnd)
      caretRef.current = { s, e: s }
      setExpr(next)
      requestAnimationFrame(() => {
        if (!isCoarsePointer()) input.focus()
        if (document.activeElement === input) input.setSelectionRange(s, s)
      })
    } else if (s > 0) {
      const next = input.value.slice(0, s - 1) + input.value.slice(s)
      caretRef.current = { s: s - 1, e: s - 1 }
      setExpr(next)
      requestAnimationFrame(() => {
        if (!isCoarsePointer()) input.focus()
        if (document.activeElement === input) input.setSelectionRange(s - 1, s - 1)
      })
    }
  }

  // ---- panel position ------------------------------------------------------
  const panelW = size.w + 28
  const narrow = viewport.w < 640
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  // text mode: panel to the right of the text anchor; stamp mode: cover the stamp
  const left = narrow
    ? clamp((viewport.w - panelW) / 2, 8, Math.max(8, viewport.w - panelW - 10))
    : clamp(initial ? anchor.sx - 13 : anchor.sx + 22, 8, Math.max(8, viewport.w - panelW - 10))
  const top = narrow
    ? 72
    : clamp(initial ? anchor.sy - 96 : anchor.sy - 10, 60, Math.max(60, viewport.h - 200))

  // ---- stamp API: fresh closure every render (reads left/top/size/view) ----
  useEffect(() => {
    if (!stampApiRef) return
    stampApiRef.current = {
      getStamp: () => {
        const canvas = canvasRef.current
        if (!canvas) return null
        let img: string | null = null
        try {
          img = snapshotWithFrame(canvas)
        } catch {
          img = null
        }
        // canvas offset inside the panel -> panel position is known in viewport coords
        const panel = containerRef.current
        const rect = canvas.getBoundingClientRect()
        let dx = 13
        let dy = 100
        if (panel) {
          const pr = panel.getBoundingClientRect()
          dx = rect.left - pr.left
          dy = rect.top - pr.top
        }
        return {
          expr,
          view: { ...view },
          sx: left + dx,
          sy: top + dy,
          w: size.w,
          h: size.h,
          img,
          valid: fns.some((f) => !f.error && f.raw),
        }
      },
    }
    return () => {
      stampApiRef.current = null
    }
  })

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label={isStamp ? 'Редактирование графика' : 'Редактор функции'}
      data-testid="func-editor"
      className="pointer-events-auto absolute flex flex-col rounded-xl border border-zinc-200 bg-white shadow-2xl"
      style={{ left, top, width: panelW, maxHeight: Math.max(240, viewport.h - top - 16) }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
        e.stopPropagation()
      }}
    >
      {/* header */}
      <div className="flex items-center justify-between rounded-t-xl border-b border-zinc-100 bg-zinc-50/80 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-800 font-serif italic text-white">ƒ</span>
          {isStamp ? 'Редактирование графика' : 'График функции'}
        </div>
        <div className="flex items-center gap-0.5">
          <button type="button" aria-label="Отдалить график" onClick={() => zoomBy(1 / 1.3)} className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-200/70">
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="Приблизить график" onClick={() => zoomBy(1.3)} className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-200/70">
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="Сбросить вид графика" onClick={resetView} className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-200/70">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="Закрыть редактор функции" data-testid="func-close" onClick={onClose} className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-200/70">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 pt-2">
        {/* expression input */}
        <input
          ref={inputRef}
          data-testid="func-input"
          value={expr}
          inputMode="none"
          onPointerDown={(e) => {
            // the system keyboard appears only on a direct tap into the field
            e.currentTarget.setAttribute('inputmode', 'text')
          }}
          onSelect={(e) => trackCaret(e.currentTarget)}
          onFocus={(e) => trackCaret(e.currentTarget)}
          onBlur={(e) => trackCaret(e.currentTarget)}
          onChange={(e) => {
            markDirty()
            setExpr(e.target.value)
          }}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="sin(x); x^2 + 3x"
          autoComplete="off"
          spellCheck={false}
          aria-label="Выражение функции"
          className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 font-mono text-sm text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-500"
        />
        {firstError ? (
          <p data-testid="func-error" className="mt-1 text-xs font-medium text-rose-600">
            {firstError}
          </p>
        ) : null}

        {/* graph */}
        <div className="relative mt-2 overflow-hidden rounded-lg border border-zinc-200" style={{ width: size.w, height: size.h }}>
          <canvas
            ref={canvasRef}
            data-testid="func-canvas"
            width={size.w}
            height={size.h}
            className="block cursor-grab touch-none"
            style={{ width: size.w, height: size.h }}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerUp}
            aria-label="График функции"
          />
          {!hasAnything ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="rounded-lg bg-white/85 px-3 py-1.5 text-xs text-zinc-500">Введите функцию — график появится здесь</p>
            </div>
          ) : null}
          {/* resize handle */}
          <div
            data-testid="func-resize"
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
            onPointerCancel={onResizePointerUp}
            role="separator"
            aria-label="Изменить размер графика"
            className="absolute bottom-0 right-0 flex h-5 w-5 cursor-nwse-resize touch-none items-end justify-end rounded-tl-md bg-gradient-to-br from-transparent to-zinc-300"
            style={{ borderBottomRightRadius: 7 }}
          >
            <svg viewBox="0 0 8 8" className="h-2 w-2 text-zinc-500">
              <path d="M7 1 L1 7 M7 4 L4 7" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
          </div>
        </div>

        {/* legend */}
        {fns.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="func-legend">
            {fns.map((f, i) =>
              f.error ? null : (
                <span key={i} className="flex max-w-full items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLORS[colorIndexFor(fns, i) % COLORS.length] }} />
                  <span className="truncate font-mono">{f.raw.length > 26 ? `${f.raw.slice(0, 26)}…` : f.raw}</span>
                </span>
              )
            )}
          </div>
        ) : null}

        {/* keypad */}
        <div className="mt-2 grid grid-cols-6 gap-1">
          {KEYPAD.map((k) => (
            <button
              key={k.label}
              type="button"
              data-testid={k.testId}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (k.del ? backspace() : insert(k.ins ?? '', k.back ?? 0))}
              className="flex h-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-xs font-medium text-zinc-700 hover:bg-zinc-100 active:bg-zinc-200"
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** legend color index matching the draw order: explicit curves first, then implicit */
function colorIndexFor(fns: Array<{ usesY: boolean; error: string | null }>, i: number): number {
  let explicitBefore = 0
  let implicitBefore = 0
  for (let k = 0; k < i; k++) {
    if (fns[k].error) continue
    if (fns[k].usesY) implicitBefore++
    else explicitBefore++
  }
  return fns[i].usesY ? explicitBefore + implicitBefore : explicitBefore
}

/** math keypad: insertion strings + optional caret shift back (for "fn()" inserts) */
const KEYPAD: Array<{ label: string; ins?: string; back?: number; del?: boolean; testId?: string }> = [
  { label: 'x', ins: 'x', testId: 'func-key-x' },
  { label: 'y', ins: 'y', testId: 'func-key-y' },
  { label: 'π', ins: 'pi', testId: 'func-key-pi' },
  { label: 'x²', ins: '^2', testId: 'func-key-sq' },
  { label: 'xⁿ', ins: '^', testId: 'func-key-pow' },
  { label: '√', ins: 'sqrt()', back: 1, testId: 'func-key-sqrt' },
  { label: '7', ins: '7' },
  { label: '8', ins: '8' },
  { label: '9', ins: '9' },
  { label: '÷', ins: '/' },
  { label: '×', ins: '*' },
  { label: '−', ins: '-' },
  { label: '4', ins: '4' },
  { label: '5', ins: '5' },
  { label: '6', ins: '6' },
  { label: '+', ins: '+' },
  { label: '(', ins: '(' },
  { label: ')', ins: ')' },
  { label: '1', ins: '1' },
  { label: '2', ins: '2' },
  { label: '3', ins: '3' },
  { label: '0', ins: '0' },
  { label: '.', ins: '.' },
  { label: ';', ins: '; ', testId: 'func-key-sep' },
  { label: 'sin', ins: 'sin()', back: 1, testId: 'func-key-sin' },
  { label: 'cos', ins: 'cos()', back: 1 },
  { label: 'tan', ins: 'tan()', back: 1 },
  { label: 'ln', ins: 'ln()', back: 1 },
  { label: 'log', ins: 'log()', back: 1 },
  { label: '⌫', del: true, testId: 'func-key-back' },
]
