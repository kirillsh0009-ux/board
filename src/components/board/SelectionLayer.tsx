'use client'

import { Trash2, PencilLine } from 'lucide-react'
import { useBoardStore } from '@/lib/board/store'
import { elementBounds, unionRect } from '@/lib/board/utils'
import type { BoardElement, Rect } from '@/lib/board/types'

export default function SelectionLayer() {
  const selectedIds = useBoardStore((s) => s.selectedIds)
  const editingId = useBoardStore((s) => s.editingId)
  const elements = useBoardStore((s) => s.elements)
  const camera = useBoardStore((s) => s.camera)
  const viewport = useBoardStore((s) => s.viewport)
  const marquee = useBoardStore((s) => s.marquee)
  const select = useBoardStore((s) => s.select)
  const deleteElements = useBoardStore((s) => s.deleteElements)
  const setEditing = useBoardStore((s) => s.setEditing)

  const toScreen = (b: Rect, pad: number) => ({
    sx: (b.x - pad - camera.x) * camera.zoom + viewport.w / 2,
    sy: (b.y - pad - camera.y) * camera.zoom + viewport.h / 2,
    sw: Math.max((b.w + pad * 2) * camera.zoom, 24),
    sh: Math.max((b.h + pad * 2) * camera.zoom, 24),
  })

  // rubber-band rect while the user is dragging a selection box
  let marqueeBox: React.ReactNode = null
  if (marquee) {
    const r = {
      x: Math.min(marquee.x0, marquee.x1),
      y: Math.min(marquee.y0, marquee.y1),
      w: Math.abs(marquee.x1 - marquee.x0),
      h: Math.abs(marquee.y1 - marquee.y0),
    }
    marqueeBox = (
      <div
        className="absolute rounded border-2 border-zinc-800/50 bg-zinc-800/5"
        style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
        data-testid="marquee-box"
      />
    )
  }

  const sel = selectedIds
    .map((id) => elements.get(id))
    .filter((e): e is BoardElement => !!e && e.id !== editingId)
  if (sel.length === 0 && !marqueeBox) return null

  const pad = 6
  const boxes: React.ReactNode[] = []
  let union: Rect | null = null
  for (const el of sel) {
    const b = elementBounds(el)
    const { sx, sy, sw, sh } = toScreen(b, pad)
    if (sx + sw < 0 || sy + sh < 0 || sx > viewport.w || sy > viewport.h) continue
    union = unionRect(union, { x: sx, y: sy, w: sw, h: sh })
    boxes.push(
      <div
        key={el.id}
        className="absolute rounded-md border-2 border-dashed border-zinc-800/70"
        style={{ left: sx, top: sy, width: sw, height: sh }}
        data-testid="selection-box"
      />
    )
  }

  // action bar over the union of the visible selected boxes
  let bar: React.ReactNode = null
  if (union && sel.length > 0) {
    const canEdit = sel.length === 1 && (sel[0].type === 'sticky' || sel[0].type === 'text' || sel[0].type === 'func')
    bar = (
      <div
        className="pointer-events-auto absolute flex gap-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg"
        style={{ left: union.x + union.w - 4, top: Math.max(union.y - 46, 8) }}
        data-testid="selection-bar"
      >
        {canEdit && (
          <button
            type="button"
            aria-label={sel[0].type === 'func' ? 'Редактировать график' : 'Редактировать текст'}
            onClick={() => setEditing(sel[0].id)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 active:bg-zinc-200"
          >
            <PencilLine className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          aria-label={sel.length > 1 ? `Удалить выбранные (${sel.length})` : 'Удалить'}
          onClick={() => {
            deleteElements(selectedIds)
            select(null)
          }}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 active:bg-red-100"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20" aria-hidden={false}>
      {marqueeBox}
      {boxes}
      {bar}
    </div>
  )
}
