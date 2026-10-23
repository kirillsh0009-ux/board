'use client'

import { useState } from 'react'
import {
  MousePointer2,
  Pencil,
  Highlighter,
  Eraser,
  StickyNote,
  Type,
  Square,
  Circle,
  ArrowUpRight,
  Undo2,
  Redo2,
} from 'lucide-react'
import { useBoardStore } from '@/lib/board/store'
import { PEN_COLORS, STICKY_COLORS, STROKE_WIDTHS } from '@/lib/board/utils'
import type { Tool } from '@/lib/board/types'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const TOOLS: { tool: Tool; icon: typeof Pencil; label: string; key: string }[] = [
  { tool: 'select', icon: MousePointer2, label: 'Выбор', key: 'V' },
  { tool: 'pen', icon: Pencil, label: 'Ручка', key: 'P' },
  { tool: 'marker', icon: Highlighter, label: 'Маркер', key: 'M' },
  { tool: 'eraser', icon: Eraser, label: 'Ластик', key: 'E' },
  { tool: 'sticky', icon: StickyNote, label: 'Стикер', key: 'S' },
  { tool: 'text', icon: Type, label: 'Текст', key: 'T' },
  { tool: 'rect', icon: Square, label: 'Прямоугольник', key: 'R' },
  { tool: 'ellipse', icon: Circle, label: 'Круг', key: 'O' },
  { tool: 'arrow', icon: ArrowUpRight, label: 'Стрелка', key: 'A' },
]

export default function Toolbar() {
  const tool = useBoardStore((s) => s.tool)
  const color = useBoardStore((s) => s.color)
  const stickyColor = useBoardStore((s) => s.stickyColor)
  const width = useBoardStore((s) => s.width)
  const setTool = useBoardStore((s) => s.setTool)
  const setColor = useBoardStore((s) => s.setColor)
  const setStickyColor = useBoardStore((s) => s.setStickyColor)
  const setWidth = useBoardStore((s) => s.setWidth)
  const undo = useBoardStore((s) => s.undo)
  const redo = useBoardStore((s) => s.redo)
  const undoCount = useBoardStore((s) => s.undoStack.length)
  const redoCount = useBoardStore((s) => s.redoStack.length)

  const [colorOpen, setColorOpen] = useState(false)
  const [widthOpen, setWidthOpen] = useState(false)

  const isSticky = tool === 'sticky'
  const palette = isSticky ? STICKY_COLORS : PEN_COLORS
  const activeColor = isSticky ? stickyColor : color
  const pickColor = (c: string) => (isSticky ? setStickyColor(c) : setColor(c))
  const showPalette = tool !== 'select' && tool !== 'eraser'
  const showWidth = tool === 'pen' || tool === 'marker' || tool === 'rect' || tool === 'ellipse' || tool === 'arrow'

  return (
    <TooltipProvider delayDuration={400}>
      <div
        className="pointer-events-auto absolute left-1/2 z-30 flex max-w-[calc(100vw-136px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-2xl border border-zinc-200/80 bg-white/95 p-1.5 shadow-xl backdrop-blur scrollbar-none sm:max-w-[calc(100vw-24px)]"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)' }}
        role="toolbar"
        aria-label="Инструменты доски"
      >
        {TOOLS.map(({ tool: t, icon: Icon, label, key }) => (
          <Tooltip key={t}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={label}
                aria-pressed={tool === t}
                onClick={() => setTool(t)}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                  tool === t ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-600 hover:bg-zinc-100 active:bg-zinc-200'
                }`}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={tool === t ? 2.4 : 2} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {label} · {key}
            </TooltipContent>
          </Tooltip>
        ))}

        {showPalette && (
          <>
            <div className="mx-0.5 h-6 w-px shrink-0 bg-zinc-200" aria-hidden />
            <Popover open={colorOpen} onOpenChange={setColorOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Цвет"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl hover:bg-zinc-100 active:bg-zinc-200"
                >
                  <span
                    className="h-5 w-5 rounded-full border border-zinc-300 shadow-inner"
                    style={{ backgroundColor: activeColor }}
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="center"
                className="w-auto p-3"
                style={{ marginBottom: 8 }}
              >
                <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Выбор цвета">
                  {palette.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={activeColor === c}
                      aria-label={`Цвет ${c}`}
                      onClick={() => {
                        pickColor(c)
                        setColorOpen(false)
                      }}
                      className={`flex h-9 w-9 items-center justify-center rounded-full border transition-transform hover:scale-110 active:scale-95 ${
                        activeColor === c ? 'border-zinc-900 ring-2 ring-zinc-900 ring-offset-1' : 'border-zinc-200'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </>
        )}

        {showWidth && (
          <Popover open={widthOpen} onOpenChange={setWidthOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Толщина линии"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl hover:bg-zinc-100 active:bg-zinc-200"
              >
                <span
                  className="rounded-full bg-zinc-800"
                  style={{ width: Math.min(18, 4 + width * 1.2), height: Math.min(18, 4 + width * 1.2) }}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="center" className="w-44 p-2" style={{ marginBottom: 8 }}>
              <div className="flex flex-col gap-1" role="radiogroup" aria-label="Толщина">
                {STROKE_WIDTHS.map((w) => (
                  <button
                    key={w.value}
                    type="button"
                    role="radio"
                    aria-checked={width === w.value}
                    onClick={() => {
                      setWidth(w.value)
                      setWidthOpen(false)
                    }}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                      width === w.value ? 'bg-zinc-100 font-medium' : 'hover:bg-zinc-50'
                    }`}
                  >
                    <span className="w-8" aria-hidden>
                      <span
                        className="block rounded-full bg-zinc-800"
                        style={{ height: Math.max(2, w.value), width: 28 }}
                      />
                    </span>
                    {w.label}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}

        <div className="mx-0.5 h-6 w-px shrink-0 bg-zinc-200" aria-hidden />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Отменить"
              onClick={undo}
              disabled={undoCount === 0}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-600 transition-colors hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Undo2 className="h-[18px] w-[18px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Отменить · ⌘Z</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Повторить"
              onClick={redo}
              disabled={redoCount === 0}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-600 transition-colors hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Redo2 className="h-[18px] w-[18px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Повторить · ⇧⌘Z</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}
