'use client'

import { useCallback, useEffect, useRef } from 'react'
import { Plus, Minus, Maximize } from 'lucide-react'
import { useBoardStore, net, remoteDrafts } from '@/lib/board/store'
import { elementsBounds } from '@/lib/board/utils'
import { renderToCanvas, loadFuncImages } from '@/lib/board/render'
import type { BoardElement, UserData } from '@/lib/board/types'
import { RealtimeBus, type RTEvent } from '@/lib/board/realtime'
import BoardCanvas from './BoardCanvas'
import TopBar from './TopBar'
import Toolbar from './Toolbar'
import CursorLayer from './CursorLayer'
import SelectionLayer from './SelectionLayer'
import ElementEditor from './ElementEditor'
import { useToast } from '@/hooks/use-toast'
import { upsertRecent, randomGuest } from '@/lib/board/utils'
import { fromWire } from '@/lib/board/wire'

function handleRemoteEvent(ev: RTEvent) {
  switch (ev.event) {
    case 'element:add': {
      const el = fromWire(ev.element)
      if (el) useBoardStore.getState().remoteAdd(el)
      break
    }
    case 'element:update': {
      const el = fromWire(ev.element)
      if (el) useBoardStore.getState().remoteUpdate(el)
      break
    }
    case 'element:delete':
      useBoardStore.getState().remoteDelete(ev.ids)
      break
    case 'elements:clear':
      useBoardStore.getState().remoteClear()
      break
    case 'cursor':
      useBoardStore.getState().setCursor(ev.userId, ev.x, ev.y)
      break
    case 'stroke:progress':
      if (ev.userId === useBoardStore.getState().me.id) return
      remoteDrafts.set(ev.stroke.id, { ...ev.stroke, ts: Date.now() })
      break
  }
}

const ME_KEY = 'board-me'

function loadMe(): UserData {
  try {
    const raw = localStorage.getItem(ME_KEY)
    if (raw) {
      const me = JSON.parse(raw) as UserData
      if (me?.id && me?.name && me?.color) return me
    }
  } catch {
    /* ignore */
  }
  const guest = randomGuest()
  const me: UserData = { id: `u${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, ...guest }
  try {
    localStorage.setItem(ME_KEY, JSON.stringify(me))
  } catch {
    /* ignore */
  }
  return me
}

export default function BoardView({ boardId }: { boardId: string }) {
  const init = useBoardStore((s) => s.init)
  const setStatus = useBoardStore((s) => s.setStatus)
  const setCamera = useBoardStore((s) => s.setCamera)
  const camera = useBoardStore((s) => s.camera)
  const zoom = camera.zoom
  const viewport = useBoardStore((s) => s.viewport)
  const elements = useBoardStore((s) => s.elements)
  const boardName = useBoardStore((s) => s.boardName)
  const me = useBoardStore((s) => s.me)
  const { toast } = useToast()

  const busRef = useRef<RealtimeBus | null>(null)
  const fittedRef = useRef(false)

  // init store with boardId + me
  useEffect(() => {
    const meLoaded = loadMe()
    init(boardId, meLoaded)
    net.boardId = boardId
    // debug handle for E2E diagnostics
    ;(window as unknown as { __board?: unknown }).__board = useBoardStore
  }, [boardId])

  const fitToContent = useCallback(
    (els: BoardElement[]) => {
      const s = useBoardStore.getState()
      const bounds = elementsBounds(els)
      if (!bounds || s.viewport.w === 0) return
      const pad = 80
      const bw = Math.max(bounds.w + pad * 2, 100)
      const bh = Math.max(bounds.h + pad * 2, 100)
      const zoomLevel = Math.min(Math.min(s.viewport.w / bw, s.viewport.h / bh), 1.4)
      s.setCamera({
        zoom: Math.max(0.1, zoomLevel),
        x: bounds.x + bounds.w / 2,
        y: bounds.y + bounds.h / 2,
      })
    },
    []
  )

  // create-or-fetch board, load snapshot, then join the realtime channel
  useEffect(() => {
    let cancelled = false
    let bus: RealtimeBus | null = null

    const ensureBoard = async () => {
      try {
        let res = await fetch(`/api/boards/${boardId}`)
        if (res.status === 404) {
          res = await fetch('/api/boards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: boardId, name: 'Новая доска' }),
          })
        }
        if (!res.ok) return null
        const data = await res.json()
        return data.board as { id: string; name: string }
      } catch {
        return null
      }
    }

    const loadSnapshot = async () => {
      try {
        const res = await fetch(`/api/boards/${boardId}/elements`)
        if (!res.ok) return
        const data = (await res.json()) as { elements?: Array<BoardElement & { data?: Record<string, unknown> }> }
        if (cancelled) return
        const flat = (data.elements || []).map(fromWire).filter((e): e is BoardElement => e !== null)
        useBoardStore.getState().replaceAll(flat)
        remoteDrafts.clear()
        if (!fittedRef.current && flat.length > 0) {
          fittedRef.current = true
          fitToContent(flat)
        }
      } catch {
        /* offline: keep whatever we have */
      }
    }

    const connect = () => {
      const s = useBoardStore.getState()
      bus = new RealtimeBus()
      busRef.current = bus
      net.bus = bus

      bus.connect(
        boardId,
        { id: s.me.id, name: s.me.name, color: s.me.color },
        {
          onStatus: (st) => {
            if (!cancelled) setStatus(st)
          },
          onUsers: (users) => {
            if (!cancelled) useBoardStore.getState().setUsers(users)
          },
          onUserJoined: (user) => {
            if (cancelled) return
            useBoardStore.getState().addUser(user)
            toast({ title: `${user.name} присоединился` })
          },
          onUserLeft: (user) => {
            if (cancelled) return
            const st = useBoardStore.getState()
            const known = st.users.find((x) => x.id === user.id)
            st.removeUser(user.id)
            if (known) toast({ title: `${known.name} покинул доску` })
          },
          onEvent: (ev) => {
            if (cancelled) return
            if (ev.event === 'elements:clear') toast({ title: 'Доска очищена участником' })
            handleRemoteEvent(ev)
          },
        }
      )
    }

    ;(async () => {
      const board = await ensureBoard()
      if (cancelled) return
      if (board) useBoardStore.getState().setBoardName(board.name)
      upsertRecent(boardId, board?.name || 'Новая доска')
      // join first (events received before the snapshot are buffered),
      // then apply the snapshot, then unbuffer
      connect()
      await loadSnapshot()
      if (cancelled) return
      busRef.current?.markReady()
    })()

    return () => {
      cancelled = true
      bus?.disconnect()
      busRef.current = null
      net.bus = null
    }
  }, [boardId])

  // prune cursors periodically
  useEffect(() => {
    const t = setInterval(() => useBoardStore.getState().pruneCursors(), 5000)
    return () => clearInterval(t)
  }, [])

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useBoardStore.getState()
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || s.editingId)) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedId) {
          e.preventDefault()
          s.deleteElements([s.selectedId])
          s.select(null)
        }
      } else if (e.key === 'Escape') {
        s.select(null)
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const map: Record<string, string> = {
          v: 'select',
          p: 'pen',
          m: 'marker',
          e: 'eraser',
          s: 'sticky',
          t: 'text',
          r: 'rect',
          o: 'ellipse',
          a: 'arrow',
        }
        const tool = map[e.key.toLowerCase()]
        if (tool) s.setTool(tool as never)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const zoomBy = (factor: number) => {
    const s = useBoardStore.getState()
    const cx = s.viewport.w / 2
    const cy = s.viewport.h / 2
    const newZoom = Math.max(0.08, Math.min(8, s.camera.zoom * factor))
    const wx = (cx - s.viewport.w / 2) / s.camera.zoom + s.camera.x
    const wy = (cy - s.viewport.h / 2) / s.camera.zoom + s.camera.y
    s.setCamera({
      zoom: newZoom,
      x: wx - (cx - s.viewport.w / 2) / newZoom,
      y: wy - (cy - s.viewport.h / 2) / newZoom,
    })
  }

  const onRename = async (name: string) => {
    try {
      await fetch(`/api/boards/${boardId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      upsertRecent(boardId, name)
    } catch {
      toast({ title: 'Не удалось сохранить название' })
    }
  }

  const onExport = async () => {
    const els = Array.from(useBoardStore.getState().elements.values())
    if (els.length === 0) {
      toast({ title: 'Доска пуста', description: 'Добавьте что-нибудь перед экспортом' })
      return
    }
    const bounds = elementsBounds(els)
    if (!bounds) return
    const pad = 48
    const b = { x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + pad * 2, h: bounds.h + pad * 2 }
    let scale = 2
    if (b.w * scale > 4096) scale = Math.max(0.5, 4096 / b.w)
    // func stamps draw from <img> snapshots — make sure they are decoded first
    await loadFuncImages(els)
    const canvas = document.createElement('canvas')
    renderToCanvas(canvas, els, b, scale)
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${boardName || 'Доска'}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      toast({ title: 'PNG готов', description: 'Файл загружается…' })
    }, 'image/png')
  }

  const onClear = () => {
    useBoardStore.getState().clearAll()
  }

  const onUpdateUser = (name: string, color: string) => {
    const s = useBoardStore.getState()
    const updated = { ...s.me, name, color }
    useBoardStore.setState({ me: updated })
    try {
      localStorage.setItem(ME_KEY, JSON.stringify(updated))
    } catch {
      /* ignore */
    }
    busRef.current?.updateMe({ id: updated.id, name, color })
  }

  const goHome = () => {
    window.location.assign('/')
  }

  const fit = () => {
    fitToContent(Array.from(useBoardStore.getState().elements.values()))
  }

  return (
    <div className="relative h-[100dvh] w-full select-none overflow-hidden bg-white no-callout" data-testid="board-view">
      <BoardCanvas />
      <CursorLayer />
      <SelectionLayer />
      <ElementEditor />
      <TopBar onBack={goHome} onRename={onRename} onExport={onExport} onClear={onClear} onUpdateUser={onUpdateUser} />
      <Toolbar />

      {/* zoom controls */}
      <div
        className="absolute right-3 z-30 flex flex-col items-center gap-0.5 rounded-2xl border border-zinc-200/80 bg-white/95 p-1 shadow-lg backdrop-blur"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)' }}
        role="group"
        aria-label="Масштаб"
      >
        <button
          type="button"
          aria-label="Приблизить"
          onClick={() => zoomBy(1.25)}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-zinc-600 hover:bg-zinc-100 active:bg-zinc-200"
        >
          <Plus className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          aria-label="Сбросить масштаб"
          onClick={() => setCamera({ ...camera, zoom: 1 })}
          className="flex h-7 w-10 items-center justify-center rounded-lg text-xs font-semibold text-zinc-500 hover:bg-zinc-100"
          data-testid="zoom-level"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          aria-label="Отдалить"
          onClick={() => zoomBy(0.8)}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-zinc-600 hover:bg-zinc-100 active:bg-zinc-200"
        >
          <Minus className="h-[18px] w-[18px]" />
        </button>
        <div className="my-0.5 h-px w-6 bg-zinc-200" aria-hidden />
        <button
          type="button"
          aria-label="Показать всё"
          onClick={fit}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-zinc-600 hover:bg-zinc-100 active:bg-zinc-200"
        >
          <Maximize className="h-4 w-4" />
        </button>
      </div>
      {/* viewport used to trigger fit after first data; keep ref for tests */}
      <span data-me-id={me.id} className="hidden" />
    </div>
  )
}
