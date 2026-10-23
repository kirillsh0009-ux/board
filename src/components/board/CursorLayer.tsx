'use client'

import { useEffect } from 'react'
import { useBoardStore } from '@/lib/board/store'

export default function CursorLayer() {
  const cursors = useBoardStore((s) => s.cursors)
  const camera = useBoardStore((s) => s.camera)
  const viewport = useBoardStore((s) => s.viewport)
  const pruneCursors = useBoardStore((s) => s.pruneCursors)
  const meId = useBoardStore((s) => s.me.id)

  useEffect(() => {
    const t = setInterval(() => pruneCursors(), 5000)
    return () => clearInterval(t)
  }, [pruneCursors])

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden>
      {Array.from(cursors.entries()).map(([id, c]) => {
        if (id === meId) return null
        const sx = (c.x - camera.x) * camera.zoom + viewport.w / 2
        const sy = (c.y - camera.y) * camera.zoom + viewport.h / 2
        if (sx < -60 || sy < -60 || sx > viewport.w + 60 || sy > viewport.h + 60) return null
        return (
          <div
            key={id}
            className="absolute left-0 top-0 will-change-transform"
            style={{ transform: `translate(${sx}px, ${sy}px)` }}
          >
            <svg width="20" height="24" viewBox="0 0 20 24" className="drop-shadow-sm">
              <path d="M3 2 L3 19 L8 14 L11.5 21.5 L14.5 20 L11 12.8 L17.5 12.2 Z" fill={c.color} stroke="white" strokeWidth="1.4" />
            </svg>
            <span
              className="ml-3 -mt-1 inline-block max-w-32 truncate rounded-full px-2 py-0.5 text-[11px] font-medium text-white shadow"
              style={{ backgroundColor: c.color }}
            >
              {c.name}
            </span>
          </div>
        )
      })}
    </div>
  )
}
