'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useBoardStore } from '@/lib/board/store'
import type { BoardElement, FuncElement, StickyElement, TextElement } from '@/lib/board/types'
import FuncEditor, { withExpr, isCoarsePointer, type FuncStampApi, type FuncView } from './FuncEditor'
import { uid } from '@/lib/board/utils'

export default function ElementEditor() {
  const editingId = useBoardStore((s) => s.editingId)
  const elements = useBoardStore((s) => s.elements)
  const camera = useBoardStore((s) => s.camera)
  const viewport = useBoardStore((s) => s.viewport)

  const initialRef = useRef<BoardElement | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const funcPanelRef = useRef<HTMLDivElement | null>(null)
  const stampApiRef = useRef<FuncStampApi | null>(null)
  const lastEmit = useRef(0)
  const [funcOpen, setFuncOpen] = useState(false)
  // mirror for commit() (stable callback must not read stale state)
  const funcOpenRef = useRef(false)
  useEffect(() => {
    funcOpenRef.current = funcOpen
  }, [funcOpen])

  const el = editingId ? elements.get(editingId) : null
  const isText = el?.type === 'text'
  const hasFunc = isText && (el as TextElement).text.includes('[func]')

  // [func] token appeared -> open the editor; token removed -> close it.
  // (state adjustment during render — the sanctioned alternative to setState-in-effect)
  const [prevHasFunc, setPrevHasFunc] = useState(false)
  if (hasFunc !== prevHasFunc) {
    setPrevHasFunc(hasFunc)
    setFuncOpen(hasFunc)
  }

  /** keep the source text's [func] expression in sync after a stamp re-edit */
  const syncSourceText = useCallback((stamp: FuncElement) => {
    const s = useBoardStore.getState()
    if (!stamp.srcId) return
    const src = s.elements.get(stamp.srcId)
    if (!src || src.type !== 'text') return
    const newText = withExpr(src.text, stamp.expr)
    if (newText === src.text) return
    const updated = { ...src, text: newText } as TextElement
    s.updateLocal([updated])
    s.broadcastUpdate([updated])
  }, [])

  /**
   * Stamp the currently visible graph onto the board.
   * source is a func element -> re-stamp it in place (re-editing a stamp).
   * source is a text element -> update the stamp created by this text
   * (matched by srcId), or create the first stamp. Matching prevents the
   * duplicate-stamp bug: every later close of the same [func] panel used to
   * spawn another copy.
   * No-op when the panel has no snapshot (already closed) or nothing is plotted.
   */
  const applyStamp = useCallback(
    (source: FuncElement | TextElement) => {
      const api = stampApiRef.current
      if (!api) return
      const data = api.getStamp()
      if (!data || !data.img) return
      const s = useBoardStore.getState()
      const cam = s.camera
      const vp = s.viewport
      // the stamp keeps the popup's on-screen size: convert screen -> world
      const wx = (data.sx - vp.w / 2) / cam.zoom + cam.x
      const wy = (data.sy - vp.h / 2) / cam.zoom + cam.y
      const w = data.w / cam.zoom
      const h = data.h / cam.zoom
      const view = { ...data.view }

      if (source.type === 'func') {
        // keep the old stamp when nothing is plotted (empty/typo) — don't wipe it
        if (!data.valid) return
        const existing = source
        const same =
          existing.x === wx &&
          existing.y === wy &&
          existing.w === w &&
          existing.h === h &&
          existing.img === data.img &&
          existing.expr === data.expr &&
          existing.view.cx === view.cx &&
          existing.view.cy === view.cy &&
          existing.view.scale === view.scale
        if (same) return
        const updated: FuncElement = { ...existing, x: wx, y: wy, w, h, img: data.img, expr: data.expr, view }
        s.updateLocal([updated])
        s.broadcastUpdate([updated])
        s.pushOp({ kind: 'update', before: existing, after: updated })
        syncSourceText(updated)
        return
      }

      if (!data.valid) return // nothing plotted -> no stamp
      let linked: FuncElement | null = null
      for (const e of s.elements.values()) {
        if (e.type === 'func' && (e as FuncElement).srcId === source.id) {
          linked = e as FuncElement
          break
        }
      }
      if (linked) {
        // update the linked stamp in place, keeping its board position
        if (
          linked.w === w &&
          linked.h === h &&
          linked.img === data.img &&
          linked.expr === data.expr &&
          linked.view.cx === view.cx &&
          linked.view.cy === view.cy &&
          linked.view.scale === view.scale
        )
          return
        const updated: FuncElement = { ...linked, w, h, img: data.img, expr: data.expr, view }
        s.updateLocal([updated])
        s.broadcastUpdate([updated])
        s.pushOp({ kind: 'update', before: linked, after: updated })
        return
      }
      const created: FuncElement = {
        id: uid(),
        type: 'func',
        x: wx,
        y: wy,
        w,
        h,
        img: data.img,
        expr: data.expr,
        view,
        srcId: source.id,
      }
      s.addElements([created])
    },
    [syncSourceText],
  )

  /** save & close; reads everything from the store so it never works on stale data */
  const commit = useCallback(() => {
    const s = useBoardStore.getState()
    const id = s.editingId
    if (!id) return // already committed (blur + outside tap can both fire)
    const current = s.elements.get(id)
    // editing a func stamp: any outside tap re-stamps it and closes
    if (current?.type === 'func') {
      applyStamp(current)
      s.setEditing(null)
      return
    }
    const before = initialRef.current && initialRef.current.id === id ? initialRef.current : null
    if (current && (current.type === 'sticky' || current.type === 'text')) {
      // [func] panel is open -> update this text's stamp (or create it once) before closing
      if (current.type === 'text' && funcOpenRef.current) {
        applyStamp(current)
      }
      const text = current.text.trim()
      if (!text) {
        // empty -> remove element entirely
        s.deleteElements([id], { record: false })
        if (before) s.pushOp({ kind: 'delete', elements: [before] })
      } else {
        const trimmed = { ...current, text: current.text.replace(/\s+$/g, '') } as StickyElement | TextElement
        s.updateLocal([trimmed])
        // broadcast + persist (persistUpdate: realtime event + batch queue)
        s.broadcastUpdate([trimmed])
        if (before) {
          s.pushOp({ kind: 'update', before, after: trimmed })
        }
      }
    }
    initialRef.current = null
    s.setEditing(null)
  }, [applyStamp])

  /** FuncEditor writes the expression back into the live store element */
  const onFuncWriteText = useCallback((expr: string) => {
    const s = useBoardStore.getState()
    const id = s.editingId
    if (!id) return
    const cur = s.elements.get(id)
    if (!cur || cur.type !== 'text') return
    const newText = withExpr(cur.text, expr)
    if (newText === cur.text) return
    const updated = { ...cur, text: newText } as TextElement
    s.updateLocal([updated])
    s.broadcastUpdate([updated])
  }, [])

  /** close button / Escape inside the panel: stamp, then close (and keep text editing) */
  const onFuncClose = useCallback(() => {
    const s = useBoardStore.getState()
    const id = s.editingId
    const cur = id ? s.elements.get(id) : null
    if (cur?.type === 'func') {
      applyStamp(cur)
      s.setEditing(null)
      return
    }
    if (cur?.type === 'text') applyStamp(cur)
    setFuncOpen(false)
    // touch devices: do not re-focus — the system keyboard would pop up again;
    // it returns on a direct tap into the textarea
    if (!isCoarsePointer()) taRef.current?.focus()
  }, [applyStamp])

  useEffect(() => {
    if (!el) {
      initialRef.current = null
      return
    }
    if (!initialRef.current || initialRef.current.id !== el.id) {
      initialRef.current = el
      // focus only when the editing session starts (never steal focus back
      // from the [func] panel while typing there). On touch devices skip the
      // autofocus when the [func] panel is open — the system keyboard would
      // cover half the screen; it returns on a direct tap into the field.
      const ta = taRef.current
      if (ta && !(isCoarsePointer() && funcOpenRef.current)) {
        ta.focus()
        const len = ta.value.length
        ta.setSelectionRange(len, len)
      }
    }
  }, [el])

  // [func] panel opened while typing on a touch device -> fold the system
  // keyboard away; the panel's keypad edits the expression without focus
  useEffect(() => {
    if (funcOpen && isCoarsePointer()) taRef.current?.blur()
  }, [funcOpen])

  // Tap/press anywhere outside the textarea -> save & close the editor.
  // Document-level capture listener: the canvas preventDefault()s pointerdown,
  // which suppresses the natural focus change, so textarea onBlur alone never fires.
  // Capture phase also wins over the canvas handler running later.
  // Taps inside the [func] panel are ignored (the panel manages its own closing).
  useEffect(() => {
    if (!editingId) return
    const onDocPointerDown = (e: PointerEvent) => {
      const ta = taRef.current
      if (ta && e.target instanceof Node && ta.contains(e.target)) return // taps inside the editor are fine
      if (funcPanelRef.current && e.target instanceof Node && funcPanelRef.current.contains(e.target)) return
      commit()
    }
    document.addEventListener('pointerdown', onDocPointerDown, true)
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true)
  }, [editingId, commit])

  // ---- editing a func stamp: just the panel, no textarea --------------------
  if (!editingId || !el) return null
  if (el.type === 'func') {
    const fel = el as FuncElement
    const fsx = (fel.x - camera.x) * camera.zoom + viewport.w / 2
    const fsy = (fel.y - camera.y) * camera.zoom + viewport.h / 2
    return (
      <div className="pointer-events-none absolute inset-0 z-40">
        <FuncEditor
          initial={{
            expr: fel.expr,
            view: { ...fel.view },
            w: Math.max(260, Math.min(920, Math.round(fel.w * camera.zoom))),
            h: Math.max(180, Math.min(640, Math.round(fel.h * camera.zoom))),
          }}
          anchor={{ sx: fsx, sy: fsy }}
          viewport={viewport}
          containerRef={funcPanelRef}
          stampApiRef={stampApiRef}
          onClose={onFuncClose}
        />
      </div>
    )
  }
  if (el.type !== 'sticky' && el.type !== 'text') return null

  const sx = (el.x - camera.x) * camera.zoom + viewport.w / 2
  const sy = (el.y - camera.y) * camera.zoom + viewport.h / 2

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    const s = useBoardStore.getState()
    const current = s.elements.get(el.id)
    if (!current) return
    const updated =
      current.type === 'sticky'
        ? ({ ...(current as StickyElement), text: value } as StickyElement)
        : ({ ...(current as TextElement), text: value } as TextElement)
    s.updateLocal([updated])
    const now = Date.now()
    if (now - lastEmit.current > 300) {
      lastEmit.current = now
      s.broadcastUpdate([updated])
    }
  }

  const isSticky = el.type === 'sticky'
  const fontSize = isSticky ? 16 * camera.zoom : (el as TextElement).size * camera.zoom

  // seed the reopened panel from this text's stamp (pan/zoom/size survive)
  let funcSeed: { view: FuncView; w: number; h: number } | undefined
  if (isText) {
    for (const e of elements.values()) {
      if (e.type === 'func' && (e as FuncElement).srcId === el.id) {
        const st = e as FuncElement
        funcSeed = {
          view: { ...st.view },
          w: Math.max(260, Math.min(920, Math.round(st.w * camera.zoom))),
          h: Math.max(180, Math.min(640, Math.round(st.h * camera.zoom))),
        }
        break
      }
    }
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      <textarea
        ref={taRef}
        data-testid="element-editor"
        value={el.text}
        onChange={onChange}
        onInput={(e) => {
          const ta = e.target as HTMLTextAreaElement
          if (!isSticky) {
            ta.style.height = 'auto'
            ta.style.height = `${ta.scrollHeight}px`
          }
        }}
        onBlur={(e) => {
          // focus moved into the [func] panel -> keep editing (outside taps are
          // handled by the document capture listener)
          if (funcOpen) {
            e.preventDefault()
            return
          }
          commit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            if (funcOpen) {
              // stamp the graph, close the panel, stay in the text editor
              onFuncClose()
            } else {
              ;(e.target as HTMLTextAreaElement).blur()
            }
          }
          e.stopPropagation()
        }}
        aria-label={isSticky ? 'Текст стикера' : 'Текст'}
        placeholder="Введите текст…"
        className={
          isSticky
            ? 'pointer-events-auto absolute resize-none rounded-md border-2 border-zinc-800/80 shadow-xl outline-none placeholder:text-zinc-500'
            : 'pointer-events-auto absolute resize-none overflow-hidden border-2 border-dashed border-zinc-800/70 bg-white/90 outline-none placeholder:text-zinc-400'
        }
        style={{
          left: sx,
          top: sy,
          width: isSticky ? el.w * camera.zoom : Math.max(140 * camera.zoom, TEXT_WIDTH * camera.zoom),
          height: isSticky ? el.h * camera.zoom : undefined,
          minHeight: isSticky ? undefined : fontSize * 1.4,
          background: isSticky ? el.color : undefined,
          color: isSticky ? '#3f3f46' : el.color,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: `${fontSize}px`,
          lineHeight: isSticky ? `${21 * camera.zoom}px` : `${(el as TextElement).size * 1.3 * camera.zoom}px`,
          padding: isSticky ? `${9 * camera.zoom}px ${10 * camera.zoom}px` : '0 2px',
        }}
      />
      {isText && funcOpen ? (
        <FuncEditor
          el={el as TextElement}
          seed={funcSeed}
          anchor={{ sx, sy }}
          viewport={viewport}
          containerRef={funcPanelRef}
          stampApiRef={stampApiRef}
          onClose={onFuncClose}
          onWriteText={onFuncWriteText}
        />
      ) : null}
    </div>
  )
}

const TEXT_WIDTH = 560
