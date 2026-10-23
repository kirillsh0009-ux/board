'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useBoardStore, net } from '@/lib/board/store'
import { toWire } from '@/lib/board/wire'
import type { BoardElement, StickyElement, TextElement } from '@/lib/board/types'

export default function ElementEditor() {
  const editingId = useBoardStore((s) => s.editingId)
  const elements = useBoardStore((s) => s.elements)
  const camera = useBoardStore((s) => s.camera)
  const viewport = useBoardStore((s) => s.viewport)

  const initialRef = useRef<BoardElement | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const lastEmit = useRef(0)

  const el = editingId ? elements.get(editingId) : null

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
        if (net.socket?.connected) {
          net.socket.emit('element:update', { boardId: net.boardId, element: toWire(trimmed) })
        }
        if (before) {
          s.pushOp({ kind: 'update', before, after: trimmed })
        }
      }
    }
    initialRef.current = null
    s.setEditing(null)
  }, [])

  useEffect(() => {
    if (el && (!initialRef.current || initialRef.current.id !== el.id)) {
      initialRef.current = el
    }
    if (el && taRef.current) {
      taRef.current.focus()
      const len = taRef.current.value.length
      taRef.current.setSelectionRange(len, len)
    }
    if (!el) initialRef.current = null
  }, [el])

  // Tap/press anywhere outside the textarea -> save & close the editor.
  // Document-level capture listener: the canvas preventDefault()s pointerdown,
  // which suppresses the natural focus change, so textarea onBlur alone never fires.
  // Capture phase also wins over the canvas handler running later.
  useEffect(() => {
    if (!editingId) return
    const onDocPointerDown = (e: PointerEvent) => {
      const ta = taRef.current
      if (ta && e.target instanceof Node && ta.contains(e.target)) return // taps inside the editor are fine
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
    if (now - lastEmit.current > 300 && net.socket?.connected) {
      lastEmit.current = now
      net.socket.emit('element:update', { boardId: net.boardId, element: toWire(updated) })
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
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            ;(e.target as HTMLTextAreaElement).blur()
          }
          e.stopPropagation()
        }}
        aria-label={isSticky ? 'Текст стикера' : 'Текст'}
        placeholder={isSticky ? 'Введите текст…' : 'Введите текст…'}
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
    </div>
  )
}

const TEXT_WIDTH = 560
