'use client'

import { useEffect, useRef } from 'react'
import { useBoardStore, remoteDrafts, net } from '@/lib/board/store'
import { renderBoard } from '@/lib/board/render'
import { elementBounds, hitElement, moveElement, uid, normRect } from '@/lib/board/utils'
import { addSolidEdge, createSolid, moveSolidVertex, pickSolid, projX, projY, solid3Geom, splitSolidEdge } from '@/lib/board/solid3'
import { toWire } from '@/lib/board/wire'
import type { BoardElement, Camera, LocalDraft, Solid3Element, SolidPick } from '@/lib/board/types'

type Mode = 'none' | 'active' | 'draw' | 'shape' | 'erase' | 'move' | 'pan' | 'pinch' | 'marquee' | 'vertex' | 'edgeDraw'

interface PointerInfo {
  id: number
  x: number
  y: number
  type: string
}

const MIN_ZOOM = 0.08
const MAX_ZOOM = 8

function clampZoom(z: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
}

export default function BoardCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const pointers = useRef(new Map<number, PointerInfo>())
  const mode = useRef<Mode>('none')
  const activePointer = useRef<number | null>(null)
  const penActive = useRef(false)

  const localDraft = useRef<LocalDraft | null>(null)
  const draftElementId = useRef<string | null>(null)
  const deletedDuringErase = useRef<BoardElement[]>([])

  const panStart = useRef({ camX: 0, camY: 0, sx: 0, sy: 0 })
  const pinch = useRef({ dist: 0, zoom0: 1, worldX: 0, worldY: 0 })
  const moveCtx = useRef<{ ids: string[]; before: BoardElement[]; lastX: number; lastY: number; moved: boolean } | null>(null)
  const lastTap = useRef({ time: 0, x: 0, y: 0, id: '' })

  // 3D solid part-editing: dragging a single vertex / drawing a new edge with RMB
  const vertexCtx = useRef<{ id: string; vi: number; before: Solid3Element; moved: boolean } | null>(null)
  const edgeDrawCtx = useRef<{ id: string; from: number; before: Solid3Element; target: number | null } | null>(null)

  const lastCursorEmit = useRef(0)
  const lastProgressEmit = useRef(0)
  const lastUpdateEmit = useRef(0)

  // ---------- render loop ----------
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const rect = container.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      useBoardStore.getState().setViewport(rect.width, rect.height)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)

    let raf = 0
    const loop = () => {
      const s = useBoardStore.getState()
      const now = Date.now()
      for (const [key, d] of remoteDrafts) {
        if (now - d.ts > 8000) remoteDrafts.delete(key)
      }
      // the func stamp being edited is hidden while its editor panel is open
      let els: Iterable<BoardElement> = s.elements.values()
      if (s.editingId) {
        const ed = s.elements.get(s.editingId)
        if (ed?.type === 'func') {
          const editId = s.editingId
          els = Array.from(s.elements.values()).filter((e) => e.id !== editId)
        }
      }
      renderBoard(ctx, s.viewport.w, s.viewport.h, window.devicePixelRatio || 1, s.camera, {
        elements: els,
        drafts: Array.from(remoteDrafts, ([id, d]) => ({ ...d, id })),
        localDraft: localDraft.current,
      })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const onGesture = (e: Event) => e.preventDefault()
    document.addEventListener('gesturestart', onGesture)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      document.removeEventListener('gesturestart', onGesture)
    }
  }, [])

  function zoomAt(s: ReturnType<typeof useBoardStore.getState>, sx: number, sy: number, factor: number) {
    const { viewport } = s
    const zoom = clampZoom(s.camera.zoom * factor)
    const wx = (sx - viewport.w / 2) / s.camera.zoom + s.camera.x
    const wy = (sy - viewport.h / 2) / s.camera.zoom + s.camera.y
    s.setCamera({
      zoom,
      x: wx - (sx - viewport.w / 2) / zoom,
      y: wy - (sy - viewport.h / 2) / zoom,
    })
  }

  // ---------- wheel zoom/pan (desktop & trackpad) ----------
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const s = useBoardStore.getState()
      const rect = canvas.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.01)
        zoomAt(s, sx, sy, factor)
      } else {
        s.setCamera({
          ...s.camera,
          x: s.camera.x - e.deltaX / s.camera.zoom,
          y: s.camera.y - e.deltaY / s.camera.zoom,
        })
      }
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  function toWorld(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
    const s = useBoardStore.getState()
    const rect = canvas.getBoundingClientRect()
    const sx = clientX - rect.left
    const sy = clientY - rect.top
    return {
      x: (sx - s.viewport.w / 2) / s.camera.zoom + s.camera.x,
      y: (sy - s.viewport.h / 2) / s.camera.zoom + s.camera.y,
      sx,
      sy,
    }
  }

  function hitTopmost(wx: number, wy: number): BoardElement | null {
    const els = Array.from(useBoardStore.getState().elements.values())
    const tol = 8 / useBoardStore.getState().camera.zoom
    for (let i = els.length - 1; i >= 0; i--) {
      if (hitElement(els[i], wx, wy, tol)) return els[i]
    }
    return null
  }

  /** topmost 3D solid whose vertex/edge/fill is under the pointer (part precision) */
  function pickSolidTopmost(wx: number, wy: number): { el: Solid3Element; pick: SolidPick } | null {
    const s = useBoardStore.getState()
    const els = Array.from(s.elements.values())
    const tol = 8 / s.camera.zoom
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i]
      if (el.type !== 'solid3') continue
      const pick = pickSolid(el as Solid3Element, wx, wy, tol)
      if (pick) return { el: el as Solid3Element, pick }
    }
    return null
  }

  function eraseAt(wx: number, wy: number) {
    const s = useBoardStore.getState()
    const r = 14 / s.camera.zoom
    const tol = r
    const ids: string[] = []
    for (const el of Array.from(s.elements.values())) {
      if (hitElement(el, wx, wy, tol)) ids.push(el.id)
    }
    if (ids.length > 0) {
      // capture elements for undo, then delete locally + broadcast (undo recorded once at pointerup)
      for (const id of ids) {
        const el = s.elements.get(id)
        if (el) deletedDuringErase.current.push(el)
      }
      s.deleteElements(ids, { record: false })
    }
    localDraft.current = { kind: 'erase', x: wx, y: wy, r }
  }

  /** finish a multi-move: broadcast final positions + one undo op for the whole drag */
  function commitMove() {
    const m = moveCtx.current
    if (!m || !m.moved) return
    const st = useBoardStore.getState()
    const pairs: Array<{ before: BoardElement; after: BoardElement }> = []
    for (let i = 0; i < m.ids.length; i++) {
      const el = st.elements.get(m.ids[i])
      const b = m.before[i]
      if (el && b) pairs.push({ before: b, after: el })
    }
    if (pairs.length === 0) return
    st.broadcastUpdate(pairs.map((pr) => pr.after))
    if (pairs.length === 1) st.pushOp({ kind: 'update', before: pairs[0].before, after: pairs[0].after })
    else st.pushOp({ kind: 'batch-update', pairs })
  }

  // ---------- pointer handlers ----------
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    e.preventDefault()
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      // pointer may already be released (or synthetic) — the gesture still works
    }

    if (e.pointerType === 'pen') penActive.current = true
    // palm rejection: ignore touch while pen is down
    if (e.pointerType === 'touch' && penActive.current) return

    const p = toWorld(canvas, e.clientX, e.clientY)
    pointers.current.set(e.pointerId, { id: e.pointerId, x: p.sx, y: p.sy, type: e.pointerType })

    const touchCount = Array.from(pointers.current.values()).filter((t) => t.type === 'touch').length
    const s = useBoardStore.getState()

    // second finger -> pinch: commit whatever the first finger was doing
    if (touchCount >= 2) {
      if (mode.current === 'draw' || mode.current === 'shape') {
        localDraft.current = null
        draftElementId.current = null
      } else if (mode.current === 'erase') {
        const removed = deletedDuringErase.current
        deletedDuringErase.current = []
        if (removed.length > 0) s.pushOp({ kind: 'delete', elements: removed })
        localDraft.current = null
      } else if (mode.current === 'move' && moveCtx.current) {
        commitMove()
        moveCtx.current = null
      } else if (mode.current === 'vertex' && vertexCtx.current) {
        // finish the vertex drag exactly like a pointerup would
        const vc = vertexCtx.current
        vertexCtx.current = null
        const el = s.elements.get(vc.id)
        if (vc.moved && el) {
          s.broadcastUpdate([el])
          s.pushOp({ kind: 'update', before: vc.before, after: el })
        }
      } else if (mode.current === 'edgeDraw') {
        edgeDrawCtx.current = null
        localDraft.current = null
      }
      mode.current = 'pinch'
      activePointer.current = null
      const touches = Array.from(pointers.current.values()).filter((t) => t.type === 'touch')
      const t1 = touches[touches.length - 2]
      const t2 = touches[touches.length - 1]
      const dist = Math.hypot(t2.x - t1.x, t2.y - t1.y)
      const midX = (t1.x + t2.x) / 2
      const midY = (t1.y + t2.y) / 2
      pinch.current = {
        // floor: imprecise touchdown coords on tablets must not blow up the ratio
        dist: Math.max(dist, 24),
        // absolute reference: zoom stays exactly proportional to finger spread (1:1)
        zoom0: s.camera.zoom,
        worldX: (midX - s.viewport.w / 2) / s.camera.zoom + s.camera.x,
        worldY: (midY - s.viewport.h / 2) / s.camera.zoom + s.camera.y,
      }
      return
    }

    if (mode.current !== 'none') return
    mode.current = 'active'
    activePointer.current = e.pointerId

    // RMB on a vertex of a 3D solid -> start drawing an edge from it;
    // otherwise right/middle mouse button pans the board from any tool
    if (e.pointerType === 'mouse' && e.button === 2) {
      const solidHit = pickSolidTopmost(p.x, p.y)
      if (solidHit && solidHit.pick.kind === 'vertex') {
        mode.current = 'edgeDraw'
        edgeDrawCtx.current = { id: solidHit.el.id, from: solidHit.pick.vi, before: solidHit.el, target: null }
        const v = solidHit.el.vertices[solidHit.pick.vi]
        localDraft.current = {
          kind: 'edgeDraw',
          x1: projX(v),
          y1: projY(v),
          x2: p.x,
          y2: p.y,
          color: solidHit.el.color,
          snapped: false,
        }
        return
      }
    }
    if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2)) {
      mode.current = 'pan'
      panStart.current = { camX: s.camera.x, camY: s.camera.y, sx: p.sx, sy: p.sy }
      return
    }

    const tool = s.tool

    if (tool === 'select' || tool === 'solid3') {
      // 3D solids get part-precise handling first: vertex drag / edge double-tap
      // (works in both the select tool and the 3D tool itself)
      const solidHit = pickSolidTopmost(p.x, p.y)
      if (solidHit && solidHit.pick.kind === 'vertex') {
        s.select(solidHit.el.id)
        vertexCtx.current = { id: solidHit.el.id, vi: solidHit.pick.vi, before: solidHit.el, moved: false }
        mode.current = 'vertex'
        return
      }
      if (solidHit && solidHit.pick.kind === 'edge') {
        const now = Date.now()
        const tapId = `${solidHit.el.id}:e${solidHit.pick.ei}`
        const isDoubleTap =
          now - lastTap.current.time < 350 &&
          Math.hypot(p.sx - lastTap.current.x, p.sy - lastTap.current.y) < 24 &&
          lastTap.current.id === tapId
        lastTap.current = { time: now, x: p.sx, y: p.sy, id: tapId }
        if (isDoubleTap) {
          // double-click on an edge -> insert a draggable point in its middle
          const { el: updated } = splitSolidEdge(solidHit.el, solidHit.pick.ei)
          s.updateLocal([updated])
          s.broadcastUpdate([updated])
          s.pushOp({ kind: 'update', before: solidHit.el, after: updated })
          s.select(solidHit.el.id)
          mode.current = 'none'
          activePointer.current = null
          return
        }
        // single click on an edge -> falls through to the normal move flow
      }

      if (tool === 'select' || solidHit) {
        const hit = tool === 'select' ? hitTopmost(p.x, p.y) : solidHit!.el
        if (hit) {
        // tap on already-selected sticky/text -> edit (only when it is the sole selection)
        const now = Date.now()
        const isDoubleTap =
          now - lastTap.current.time < 350 &&
          Math.hypot(p.sx - lastTap.current.x, p.sy - lastTap.current.y) < 24 &&
          lastTap.current.id === hit.id
        // solids keep the edge-tap record from the branch above (double-click
        // on an edge inserts a point) — do not clobber it with the plain id
        if (hit.type !== 'solid3') {
          lastTap.current = { time: now, x: p.sx, y: p.sy, id: hit.id }
        }
        if (
          (hit.type === 'sticky' || hit.type === 'text' || hit.type === 'func') &&
          (isDoubleTap || (s.selectedIds.length === 1 && s.selectedIds[0] === hit.id))
        ) {
          s.select(hit.id)
          s.setEditing(hit.id)
          mode.current = 'none'
          activePointer.current = null
          return
        }
        if (e.shiftKey && e.pointerType === 'mouse') {
          // shift-click toggles membership in the multi-selection
          const next = s.selectedIds.includes(hit.id)
            ? s.selectedIds.filter((x) => x !== hit.id)
            : [...s.selectedIds, hit.id]
          s.selectMany(next)
          if (next.length === 0) {
            mode.current = 'none'
            activePointer.current = null
            return
          }
        } else if (!s.selectedIds.includes(hit.id)) {
          s.select(hit.id)
        }
        // drag moves everything currently selected
        const st = useBoardStore.getState()
        const ids = st.selectedIds.filter((id) => st.elements.has(id))
        moveCtx.current = {
          ids,
          before: ids.map((id) => st.elements.get(id) as BoardElement),
          lastX: p.x,
          lastY: p.y,
          moved: false,
        }
        mode.current = 'move'
        } else if (e.pointerType === 'mouse') {
          // left drag on empty space -> rubber-band multi-select
          s.select(null)
          s.setMarquee({ x0: p.sx, y0: p.sy, x1: p.sx, y1: p.sy })
          mode.current = 'marquee'
        } else {
          s.select(null)
          mode.current = 'pan'
          panStart.current = { camX: s.camera.x, camY: s.camera.y, sx: p.sx, sy: p.sy }
        }
        return
      }

      // 3D tool on empty space -> stamp a new solid
      localDraft.current = {
        kind: 'solid3',
        shape: s.solid3Shape,
        x0: p.x,
        y0: p.y,
        x1: p.x,
        y1: p.y,
        color: s.color,
        width: s.width,
      }
      mode.current = 'shape'
      return
    }

    if (tool === 'pen' || tool === 'marker') {
      const isPen = e.pointerType === 'pen' && e.pressure > 0
      const wf = isPen ? Math.max(0.35, Math.min(2.4, e.pressure * 2.2)) : 1
      draftElementId.current = uid()
      localDraft.current = {
        kind: 'path',
        points: tool === 'pen' ? [p.x, p.y, wf] : [p.x, p.y],
        color: s.color,
        width: tool === 'pen' ? s.width : s.width * 2.4,
        marker: tool === 'marker',
      }
      mode.current = 'draw'
      return
    }

    if (tool === 'eraser') {
      mode.current = 'erase'
      deletedDuringErase.current = []
      eraseAt(p.x, p.y)
      return
    }

    if (tool === 'rect' || tool === 'ellipse' || tool === 'arrow' || tool === 'line') {
      localDraft.current = {
        kind: 'shape',
        tool,
        x0: p.x,
        y0: p.y,
        x1: p.x,
        y1: p.y,
        color: s.color,
        width: s.width,
        dashed: tool === 'line' ? s.dashed : undefined,
      }
      mode.current = 'shape'
      return
    }

    if (tool === 'sticky') {
      const el: BoardElement = {
        id: uid(),
        type: 'sticky',
        x: p.x - 100,
        y: p.y - 100,
        w: 200,
        h: 200,
        color: s.stickyColor,
        text: '',
      }
      s.addElements([el])
      s.setTool('select')
      s.select(el.id)
      s.setEditing(el.id)
      mode.current = 'none'
      activePointer.current = null
      return
    }

    if (tool === 'text') {
      const el: BoardElement = {
        id: uid(),
        type: 'text',
        x: p.x,
        y: p.y - 16,
        size: 24,
        color: s.color,
        text: '',
      }
      s.addElements([el])
      s.setTool('select')
      s.select(el.id)
      s.setEditing(el.id)
      mode.current = 'none'
      activePointer.current = null
      return
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    e.preventDefault()
    const tracked = pointers.current.get(e.pointerId)
    const p = toWorld(canvas, e.clientX, e.clientY)
    if (tracked) {
      tracked.x = p.sx
      tracked.y = p.sy
    }

    const s = useBoardStore.getState()

    // broadcast own cursor
    const now = Date.now()
    if (now - lastCursorEmit.current > 45 && net.bus?.enabled) {
      lastCursorEmit.current = now
      net.bus.send({ event: 'cursor', userId: useBoardStore.getState().me.id, x: p.x, y: p.y })
    }

    if (mode.current === 'pinch' && tracked?.type === 'touch') {
      const touches = Array.from(pointers.current.values()).filter((t) => t.type === 'touch')
      if (touches.length < 2) return
      const t1 = touches[touches.length - 2]
      const t2 = touches[touches.length - 1]
      const dist = Math.max(Math.hypot(t2.x - t1.x, t2.y - t1.y), 1)
      const midX = (t1.x + t2.x) / 2
      const midY = (t1.y + t2.y) / 2
      // zoom = zoom at gesture start * finger spread ratio -> strict 1:1 tracking.
      // (multiplying the *current* zoom by the ratio-to-start compounds exponentially:
      //  zoom creeps first, then explodes — the classic "ничего, потом рывком" bug)
      const zoom = clampZoom(pinch.current.zoom0 * (dist / pinch.current.dist))
      s.setCamera({
        zoom,
        x: pinch.current.worldX - (midX - s.viewport.w / 2) / zoom,
        y: pinch.current.worldY - (midY - s.viewport.h / 2) / zoom,
      })
      return
    }

    if (e.pointerId !== activePointer.current || mode.current === 'none' || mode.current === 'pinch') return

    if (mode.current === 'draw') {
      const draft = localDraft.current
      if (draft && draft.kind === 'path') {
        const isPen = e.pointerType === 'pen' && e.pressure > 0
        if (draft.marker) {
          draft.points.push(p.x, p.y)
        } else {
          const wf = isPen ? Math.max(0.35, Math.min(2.4, e.pressure * 2.2)) : 1
          draft.points.push(p.x, p.y, wf)
        }
        if (now - lastProgressEmit.current > 45 && net.bus?.enabled && draftElementId.current) {
          lastProgressEmit.current = now
          net.bus.send({
            event: 'stroke:progress',
            userId: useBoardStore.getState().me.id,
            stroke: {
              id: draftElementId.current,
              points: draft.points.slice(-900),
              color: draft.color,
              width: draft.width,
              marker: draft.marker,
            },
          })
        }
      }
      return
    }

    if (mode.current === 'erase') {
      eraseAt(p.x, p.y)
      return
    }

    if (mode.current === 'marquee') {
      const m = s.marquee
      if (m) s.setMarquee({ ...m, x1: p.sx, y1: p.sy })
      return
    }

    if (mode.current === 'move' && moveCtx.current) {
      const m = moveCtx.current
      const dx = p.x - m.lastX
      const dy = p.y - m.lastY
      if (dx !== 0 || dy !== 0) {
        const moved: BoardElement[] = []
        for (const id of m.ids) {
          const el = s.elements.get(id)
          if (el) moved.push(moveElement(el, dx, dy))
        }
        if (moved.length > 0) {
          m.moved = true
          s.updateLocal(moved)
          m.lastX = p.x
          m.lastY = p.y
          if (now - lastUpdateEmit.current > 60 && net.bus?.enabled) {
            lastUpdateEmit.current = now
            for (const el of moved) net.bus.send({ event: 'element:update', element: toWire(el) })
          }
        }
      }
      return
    }

    if (mode.current === 'vertex' && vertexCtx.current) {
      const vc = vertexCtx.current
      const el = s.elements.get(vc.id)
      if (el?.type === 'solid3') {
        const updated = moveSolidVertex(el as Solid3Element, vc.vi, p.x, p.y)
        vc.moved = true
        s.updateLocal([updated])
        if (now - lastUpdateEmit.current > 60 && net.bus?.enabled) {
          lastUpdateEmit.current = now
          net.bus.send({ event: 'element:update', element: toWire(updated) })
        }
      }
      return
    }

    if (mode.current === 'edgeDraw' && edgeDrawCtx.current) {
      const ec = edgeDrawCtx.current
      const el = s.elements.get(ec.id)
      if (el?.type === 'solid3' && localDraft.current?.kind === 'edgeDraw') {
        const sol = el as Solid3Element
        // snap the free end to a nearby vertex of the same solid
        let tx = p.x
        let ty = p.y
        let snapped = false
        let target: number | null = null
        const g = solid3Geom(sol)
        const snapTol = 14 / s.camera.zoom
        for (let i = 0; i < g.pv.length; i++) {
          if (i === ec.from) continue
          if (Math.hypot(g.pv[i].x - p.x, g.pv[i].y - p.y) <= snapTol) {
            tx = g.pv[i].x
            ty = g.pv[i].y
            snapped = true
            target = i
            break
          }
        }
        ec.target = target
        localDraft.current = { ...localDraft.current, x2: tx, y2: ty, snapped }
      }
      return
    }

    if (mode.current === 'pan') {
      s.setCamera({
        ...s.camera,
        x: panStart.current.camX - (p.sx - panStart.current.sx) / s.camera.zoom,
        y: panStart.current.camY - (p.sy - panStart.current.sy) / s.camera.zoom,
      })
      return
    }

    if (mode.current === 'shape') {
      const draft = localDraft.current
      if (draft && draft.kind === 'shape') {
        draft.x1 = p.x
        draft.y1 = p.y
      }
      return
    }
  }

  const finalizePointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    pointers.current.delete(e.pointerId)
    if (e.pointerType === 'pen' && !Array.from(pointers.current.values()).some((t) => t.type === 'pen')) {
      penActive.current = false
    }

    // pinch ended with one finger still down -> keep the motion going as a one-finger pan
    if (mode.current === 'pinch') {
      const touches = Array.from(pointers.current.values()).filter((t) => t.type === 'touch')
      if (touches.length === 1) {
        const s = useBoardStore.getState()
        mode.current = 'pan'
        activePointer.current = touches[0].id
        panStart.current = { camX: s.camera.x, camY: s.camera.y, sx: touches[0].x, sy: touches[0].y }
      }
    }

    const wasActive = e.pointerId === activePointer.current
    if (pointers.current.size === 0) {
      activePointer.current = null
      if (mode.current === 'pinch') mode.current = 'none'
    }

    if (!wasActive || !canvas) {
      if (mode.current !== 'pinch' && pointers.current.size === 0) mode.current = 'none'
      return
    }

    const s = useBoardStore.getState()

    if (mode.current === 'draw') {
      const draft = localDraft.current
      if (draft && draft.kind === 'path' && draftElementId.current) {
        const points = draft.points.slice()
        const minLen = draft.marker ? 4 : 6
        if (points.length < minLen && points.length >= 2) {
          // dot: duplicate the point
          if (draft.marker) points.push(points[0] + 0.01, points[1])
          else points.push(points[0] + 0.01, points[1], points[2] ?? 1)
        }
        const el: BoardElement = {
          id: draftElementId.current,
          type: 'path',
          points,
          color: draft.color,
          width: draft.width,
          marker: draft.marker,
        }
        s.addElements([el])
      }
      localDraft.current = null
      draftElementId.current = null
    } else if (mode.current === 'shape') {
      const draft = localDraft.current
      if (draft && draft.kind === 'shape') {
        let { x0, y0, x1, y1 } = draft
        const dist = Math.hypot(x1 - x0, y1 - y0)
        if (dist < 10 / s.camera.zoom) {
          // tap -> default size
          if (draft.tool === 'arrow') {
            // horizontal arrow through the tap point
            x0 = draft.x0 - 70
            y0 = draft.y0
            x1 = draft.x0 + 70
            y1 = draft.y0
          } else if (draft.tool === 'line') {
            // horizontal segment through the tap point
            x0 = draft.x0 - 70
            y0 = draft.y0
            x1 = draft.x0 + 70
            y1 = draft.y0
          } else {
            x0 = draft.x0 - 70
            y0 = draft.y0 - 45
            x1 = draft.x0 + 70
            y1 = draft.y0 + 45
          }
        }
        if (draft.tool === 'arrow') {
          // keep direction: start = press point, w/h = signed deltas so the
          // arrowhead points the way it was drawn (any of the 4 quadrants)
          s.addElements([
            {
              id: uid(),
              type: 'arrow',
              x: x0,
              y: y0,
              w: x1 - x0,
              h: y1 - y0,
              color: draft.color,
              strokeWidth: draft.width,
            },
          ])
        } else if (draft.tool === 'line') {
          s.addElements([
            {
              id: uid(),
              type: 'line',
              x: x0,
              y: y0,
              w: x1 - x0,
              h: y1 - y0,
              color: draft.color,
              strokeWidth: draft.width,
              dashed: draft.dashed === true,
            },
          ])
        } else {
          const r = normRect(x0, y0, x1, y1)
          s.addElements([
            {
              id: uid(),
              type: draft.tool,
              x: r.x,
              y: r.y,
              w: r.w,
              h: r.h,
              color: draft.color,
              strokeWidth: draft.width,
            },
          ])
        }
      } else if (draft && draft.kind === 'solid3') {
        let { x0, y0, x1, y1 } = draft
        if (Math.hypot(x1 - x0, y1 - y0) < 10 / s.camera.zoom) {
          // tap -> default-size cube
          x0 = draft.x0 - 110
          y0 = draft.y0 - 80
          x1 = draft.x0 + 110
          y1 = draft.y0 + 80
        }
        const el = createSolid(uid(), draft.shape, x0, y0, x1, y1, draft.color, draft.width)
        s.addElements([el])
        s.select(el.id)
      }
      localDraft.current = null
    } else if (mode.current === 'vertex' && vertexCtx.current) {
      const vc = vertexCtx.current
      vertexCtx.current = null
      const el = s.elements.get(vc.id)
      if (vc.moved && el) {
        s.broadcastUpdate([el])
        s.pushOp({ kind: 'update', before: vc.before, after: el })
      }
    } else if (mode.current === 'edgeDraw' && edgeDrawCtx.current) {
      const ec = edgeDrawCtx.current
      edgeDrawCtx.current = null
      localDraft.current = null
      const el = s.elements.get(ec.id)
      if (el?.type === 'solid3' && ec.target !== null) {
        const updated = addSolidEdge(el as Solid3Element, ec.from, ec.target)
        if (updated) {
          s.updateLocal([updated])
          s.broadcastUpdate([updated])
          s.pushOp({ kind: 'update', before: ec.before, after: updated })
        }
      }
    } else if (mode.current === 'erase') {
      const removed = deletedDuringErase.current
      deletedDuringErase.current = []
      if (removed.length > 0) {
        s.pushOp({ kind: 'delete', elements: removed })
      }
      localDraft.current = null
    } else if (mode.current === 'move' && moveCtx.current) {
      commitMove()
      moveCtx.current = null
    } else if (mode.current === 'marquee') {
      const m = s.marquee
      s.setMarquee(null)
      if (m) {
        const x0 = Math.min(m.x0, m.x1)
        const x1 = Math.max(m.x0, m.x1)
        const y0 = Math.min(m.y0, m.y1)
        const y1 = Math.max(m.y0, m.y1)
        // a near-zero drag was just a click on empty space -> selection stays cleared
        if (x1 - x0 > 6 || y1 - y0 > 6) {
          const wx0 = (x0 - s.viewport.w / 2) / s.camera.zoom + s.camera.x
          const wx1 = (x1 - s.viewport.w / 2) / s.camera.zoom + s.camera.x
          const wy0 = (y0 - s.viewport.h / 2) / s.camera.zoom + s.camera.y
          const wy1 = (y1 - s.viewport.h / 2) / s.camera.zoom + s.camera.y
          const ids: string[] = []
          for (const el of s.elements.values()) {
            const b = elementBounds(el)
            if (b.x < wx1 && b.x + b.w > wx0 && b.y < wy1 && b.y + b.h > wy0) ids.push(el.id)
          }
          if (ids.length > 0) s.selectMany(ids)
        }
      }
    } else if (mode.current === 'pan') {
      // nothing
    }

    mode.current = 'none'
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    finalizePointer(e)
  }

  const onPointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // cancel in-progress actions gracefully
    if (e.pointerId === activePointer.current && (mode.current === 'draw' || mode.current === 'shape')) {
      localDraft.current = null
      draftElementId.current = null
    }
    if (e.pointerId === activePointer.current && mode.current === 'edgeDraw') {
      edgeDrawCtx.current = null
      localDraft.current = null
    }
    finalizePointer(e)
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  return (
    <div ref={containerRef} className="absolute inset-0" data-testid="board-canvas-container">
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none select-none"
        style={{ touchAction: 'none', WebkitTouchCallout: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') finalizePointer(e)
        }}
        onContextMenu={onContextMenu}
      />
    </div>
  )
}
