'use client'

import { Trash2, PencilLine } from 'lucide-react'
import { useBoardStore } from '@/lib/board/store'
import { elementBounds } from '@/lib/board/utils'

export default function SelectionLayer() {
  const selectedId = useBoardStore((s) => s.selectedId)
  const editingId = useBoardStore((s) => s.editingId)
  const elements = useBoardStore((s) => s.elements)
  const camera = useBoardStore((s) => s.camera)
  const viewport = useBoardStore((s) => s.viewport)
  const select = useBoardStore((s) => s.select)
  const deleteElements = useBoardStore((s) => s.deleteElements)
  const setEditing = useBoardStore((s) => s.setEditing)

  if (!selectedId || editingId === selectedId) return null
  const el = elements.get(selectedId)
  if (!el) return null

  const b = elementBounds(el)
  const pad = 6
  const sx = (b.x - pad - camera.x) * camera.zoom + viewport.w / 2
  const sy = (b.y - pad - camera.y) * camera.zoom + viewport.h / 2
  const sw = Math.max((b.w + pad * 2) * camera.zoom, 24)
  const sh = Math.max((b.h + pad * 2) * camera.zoom, 24)
  if (sx + sw < 0 || sy + sh < 0 || sx > viewport.w || sy > viewport.h) return null

  const canEdit = el.type === 'sticky' || el.type === 'text' || el.type === 'func'

  return (
    <div className="pointer-events-none absolute inset-0 z-20" aria-hidden={false}>
      <div
        className="absolute rounded-md border-2 border-dashed border-zinc-800/70"
        style={{ left: sx, top: sy, width: sw, height: sh }}
        data-testid="selection-box"
      />
      <div
        className="pointer-events-auto absolute flex gap-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg"
        style={{ left: sx + sw - 4, top: Math.max(sy - 46, 8) }}
      >
        {canEdit && (
          <button
            type="button"
            aria-label={el.type === 'func' ? 'Редактировать график' : 'Редактировать текст'}
            onClick={() => setEditing(el.id)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 active:bg-zinc-200"
          >
            <PencilLine className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          aria-label="Удалить"
          onClick={() => {
            deleteElements([el.id])
            select(null)
          }}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 active:bg-red-100"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
