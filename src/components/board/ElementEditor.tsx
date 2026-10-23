'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useBoardStore } from '@/lib/board/store'
import type { BoardElement, StickyElement, TextElement } from '@/lib/board/types'
import FuncEditor, { withExpr } from './FuncEditor'

export default function ElementEditor() {
  const editingId = useBoardStore((s) => s.editingId)
  const elements = useBoardStore((s) => s.elements)
  const camera = useBoardStore((s) => s.camera)
  const viewport = useBoardStore((s) => s.viewport)

  const initialRef = useRef<BoardElement | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const funcPanelRef = useRef<HTMLDivElement | null>(null)
  const lastEmit = useRef(0)
  const [funcOpen, setFuncOpen] = useState(false)

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

  /** save & close; reads everything from the store so it never works on stale data */
  const commit = useCallback(() => {
    const s = useBoardStore.getState()
    const id = s.editingId
    if (!id) return // already committed (blur + outside tap can both fire)
    const before = initialRef.current && initialRef.current.id === id ? initialRef.current : null
    const current = s.elements.get(id)
    if (current && (current.type === 'sticky' || current.type === 'text')) {
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
  }, [])

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

  const onFuncClose = useCallback(() => {
    setFuncOpen(false)
    taRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!el) {
      initialRef.current = null
      return
    }
    if (!initialRef.current || initialRef.current.id !== el.id) {
      initialRef.current = el
      // focus only when the editing session starts (never steal focus back
      // from the [func] panel while typing there)
      const ta = taRef.current
      if (ta) {
        ta.focus()
        const len = ta.value.length
        ta.setSelectionRange(len, len)
      }
    }
  }, [el])

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

  if (!editingId || !el || (el.type !== 'sticky' && el.type !== 'text')) return null

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
              setFuncOpen(false)
              ;(e.target as HTMLTextAreaElement).focus()
            } else {
              ;(e.target as HTMLTextAreaElement).blur()
            }
          }
          e.stopPropagation()
        }}
        aria-label={isSticky ? 'Текст стикера' : 'Текст'}
        placeholder={isSticky ? 'Введите текст…' : 'Введите текст… (подсказка: [func] — график функции)'}
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
          anchor={{ sx, sy }}
          viewport={viewport}
          containerRef={funcPanelRef}
          onClose={onFuncClose}
          onWriteText={onFuncWriteText}
        />
      ) : null}
    </div>
  )
}

const TEXT_WIDTH = 560
