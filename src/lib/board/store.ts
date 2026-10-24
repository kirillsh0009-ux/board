import { create } from 'zustand'
import type { BoardElement, Camera, ConnectionStatus, Solid3Kind, Tool, UserData } from './types'
import { toWire, type WireElement } from './wire'
import type { RealtimeBus, RTEvent } from './realtime'

/** network bridge — BoardView assigns the realtime bus + boardId */
export const net: { bus: RealtimeBus | null; boardId: string | null } = { bus: null, boardId: null }

/** remote in-progress strokes (userId+strokeId -> stroke), rendered every frame */
export const remoteDrafts = new Map<string, { points: number[]; color: string; width: number; marker: boolean; ts: number }>()

export type Op =
  | { kind: 'add'; elements: BoardElement[] }
  | { kind: 'delete'; elements: BoardElement[] }
  | { kind: 'update'; before: BoardElement; after: BoardElement }
  | { kind: 'batch-update'; pairs: Array<{ before: BoardElement; after: BoardElement }> }
  | { kind: 'clear'; elements: BoardElement[] }

export interface CursorInfo {
  x: number
  y: number
  name: string
  color: string
  ts: number
}

function broadcast(ev: RTEvent) {
  const bus = net.bus
  if (bus && net.boardId) bus.send(ev)
}

/**
 * Client-side persistence queue: batches element ops and flushes them to the
 * REST batch endpoint (debounced). Survives failures with a retry timer.
 */
const persist = {
  upserts: new Map<string, WireElement>(),
  deletes: new Set<string>(),
  timer: null as ReturnType<typeof setTimeout> | null,
  flushing: false,
}

const FLUSH_DELAY = 700
const RETRY_DELAY = 2000
const UPSERT_CHUNK = 200

function scheduleFlush() {
  if (persist.timer) return
  persist.timer = setTimeout(flushPersist, FLUSH_DELAY)
}

async function flushPersist() {
  persist.timer = null
  if (persist.flushing) return
  const boardId = net.boardId
  if (!boardId) return

  persist.flushing = true
  try {
    while (persist.deletes.size > 0 || persist.upserts.size > 0) {
      const deletes = Array.from(persist.deletes).slice(0, UPSERT_CHUNK)
      for (const id of deletes) persist.deletes.delete(id)
      const upserts: WireElement[] = []
      for (const [id, el] of persist.upserts) {
        if (upserts.length >= UPSERT_CHUNK) break
        upserts.push(el)
        persist.upserts.delete(id)
      }
      if (deletes.length === 0 && upserts.length === 0) break

      const res = await fetch(`/api/boards/${boardId}/elements/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upserts, deletes }),
      })
      if (!res.ok) throw new Error(`batch ${res.status}`)
    }
  } catch {
    // retry whatever is left in the queues after a delay
    persist.timer = setTimeout(flushPersist, RETRY_DELAY)
  } finally {
    persist.flushing = false
  }
}

function clearPersistState() {
  if (persist.timer) {
    clearTimeout(persist.timer)
    persist.timer = null
  }
  persist.upserts.clear()
  persist.deletes.clear()
}

async function persistClear() {
  const boardId = net.boardId
  if (!boardId) return
  clearPersistState()
  try {
    const res = await fetch(`/api/boards/${boardId}/clear`, { method: 'POST' })
    if (!res.ok) throw new Error(`clear ${res.status}`)
  } catch {
    // retry once after a delay
    setTimeout(() => {
      void fetch(`/api/boards/${boardId}/clear`, { method: 'POST' }).catch(() => {})
    }, RETRY_DELAY)
  }
}

interface BoardStore {
  boardId: string
  boardName: string
  elements: Map<string, BoardElement>
  camera: Camera
  viewport: { w: number; h: number }
  tool: Tool
  color: string
  stickyColor: string
  width: number
  /** line tool: draw new lines dashed ("штрихи", hidden-edge style) */
  dashed: boolean
  /** solid3 tool: shape to stamp on drag */
  solid3Shape: Solid3Kind
  /** multi-selection (empty = nothing selected) */
  selectedIds: string[]
  /** rubber-band selection rect in screen coords while dragging (transient) */
  marquee: { x0: number; y0: number; x1: number; y1: number } | null
  editingId: string | null
  users: UserData[]
  me: UserData
  status: ConnectionStatus
  cursors: Map<string, CursorInfo>
  undoStack: Op[]
  redoStack: Op[]

  init: (boardId: string, me: UserData) => void
  setBoardName: (name: string) => void
  setStatus: (status: ConnectionStatus) => void
  setUsers: (users: UserData[]) => void
  addUser: (user: UserData) => void
  removeUser: (userId: string) => void
  setViewport: (w: number, h: number) => void
  setCamera: (cam: Camera) => void
  setTool: (tool: Tool) => void
  setColor: (color: string) => void
  setStickyColor: (color: string) => void
  setWidth: (width: number) => void
  setDashed: (dashed: boolean) => void
  setSolid3Shape: (shape: Solid3Kind) => void
  select: (id: string | null) => void
  /** replace the whole multi-selection */
  selectMany: (ids: string[]) => void
  setMarquee: (m: { x0: number; y0: number; x1: number; y1: number } | null) => void
  setEditing: (id: string | null) => void

  /** local create */
  addElements: (els: BoardElement[], opts?: { record?: boolean }) => void
  /** local move/edit without broadcasting (broadcast handled by caller) */
  updateLocal: (els: BoardElement[]) => void
  /** broadcast element:update for elements */
  broadcastUpdate: (els: BoardElement[]) => void
  /** local delete */
  deleteElements: (ids: string[], opts?: { record?: boolean }) => void
  /** local clear */
  clearAll: () => void

  pushOp: (op: Op) => void
  /** remove the most recent op (a gesture retracted it, e.g. double-click reverting the first tap's dash flip) */
  popOp: () => void
  undo: () => void
  redo: () => void

  replaceAll: (elements: BoardElement[]) => void
  remoteAdd: (el: BoardElement) => void
  remoteUpdate: (el: BoardElement) => void
  remoteDelete: (ids: string[]) => void
  remoteClear: () => void
  setCursor: (userId: string, x: number, y: number) => void
  pruneCursors: () => void
}

const MAX_OPS = 120

function persistAdd(els: BoardElement[]) {
  for (const el of els) {
    broadcast({ event: 'element:add', element: toWire(el) })
    persist.deletes.delete(el.id)
    persist.upserts.set(el.id, toWire(el))
  }
  scheduleFlush()
}
function persistUpdate(els: BoardElement[]) {
  for (const el of els) {
    broadcast({ event: 'element:update', element: toWire(el) })
    persist.upserts.set(el.id, toWire(el))
  }
  scheduleFlush()
}
function persistDelete(ids: string[]) {
  if (ids.length === 0) return
  broadcast({ event: 'element:delete', ids })
  for (const id of ids) {
    persist.upserts.delete(id)
    persist.deletes.add(id)
  }
  scheduleFlush()
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  boardId: '',
  boardName: 'Новая доска',
  elements: new Map(),
  camera: { x: 0, y: 0, zoom: 1 },
  viewport: { w: 0, h: 0 },
  tool: 'pen',
  color: '#1e293b',
  stickyColor: '#fff176',
  width: 4,
  dashed: false,
  solid3Shape: 'cube',
  selectedIds: [],
  marquee: null,
  editingId: null,
  users: [],
  me: { id: '', name: '', color: '#1e293b' },
  status: 'connecting',
  cursors: new Map(),
  undoStack: [],
  redoStack: [],

  init: (boardId, me) => set({ boardId, me, elements: new Map(), undoStack: [], redoStack: [] }),
  setBoardName: (boardName) => set({ boardName }),
  setStatus: (status) => set({ status }),
  setUsers: (users) => set({ users }),
  addUser: (user) =>
    set((s) => (s.users.some((u) => u.id === user.id) ? s : { users: [...s.users, user] })),
  removeUser: (userId) =>
    set((s) => {
      const cursors = new Map(s.cursors)
      cursors.delete(userId)
      return { users: s.users.filter((u) => u.id !== userId), cursors }
    }),
  setViewport: (w, h) => set({ viewport: { w, h } }),
  setCamera: (camera) => set({ camera }),
  setTool: (tool) => set({ tool, selectedIds: tool === 'select' ? get().selectedIds : [] }),
  setColor: (color) => set({ color }),
  setStickyColor: (stickyColor) => set({ stickyColor }),
  setWidth: (width) => set({ width }),
  setDashed: (dashed) => set({ dashed }),
  setSolid3Shape: (solid3Shape) => set({ solid3Shape }),
  select: (id) => set({ selectedIds: id ? [id] : [] }),
  selectMany: (ids) => set({ selectedIds: ids }),
  setMarquee: (marquee) => set({ marquee }),
  setEditing: (editingId) => set({ editingId }),

  addElements: (els, opts) => {
    set((s) => {
      const map = new Map(s.elements)
      for (const el of els) map.set(el.id, el)
      return { elements: map }
    })
    persistAdd(els)
    if (opts?.record !== false) get().pushOp({ kind: 'add', elements: els })
  },

  updateLocal: (els) => {
    set((s) => {
      const map = new Map(s.elements)
      for (const el of els) map.set(el.id, el)
      return { elements: map }
    })
  },

  broadcastUpdate: (els) => persistUpdate(els),

  deleteElements: (ids, opts) => {
    const s = get()
    const removed: BoardElement[] = []
    const map = new Map(s.elements)
    for (const id of ids) {
      const el = map.get(id)
      if (el) {
        removed.push(el)
        map.delete(id)
      }
    }
    if (removed.length === 0) return
    set({
      elements: map,
      selectedIds: s.selectedIds.filter((id) => !ids.includes(id)),
      editingId: s.editingId && ids.includes(s.editingId) ? null : s.editingId,
    })
    persistDelete(ids)
    if (opts?.record !== false) get().pushOp({ kind: 'delete', elements: removed })
  },

  clearAll: () => {
    const s = get()
    const elements = Array.from(s.elements.values())
    if (elements.length === 0) return
    set({ elements: new Map(), selectedIds: [], marquee: null, editingId: null })
    broadcast({ event: 'elements:clear' })
    void persistClear()
    get().pushOp({ kind: 'clear', elements })
  },

  pushOp: (op) =>
    set((s) => ({
      undoStack: [...s.undoStack.slice(-MAX_OPS), op],
      redoStack: [],
    })),

  popOp: () => set((s) => ({ undoStack: s.undoStack.slice(0, -1) })),

  undo: () => {
    const s = get()
    const op = s.undoStack[s.undoStack.length - 1]
    if (!op) return
    set({ undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, op] })
    const map = new Map(s.elements)
    switch (op.kind) {
      case 'add':
        for (const el of op.elements) map.delete(el.id)
        set({ elements: map })
        persistDelete(op.elements.map((e) => e.id))
        break
      case 'delete':
        for (const el of op.elements) map.set(el.id, el)
        set({ elements: map })
        persistAdd(op.elements)
        break
      case 'update':
        map.set(op.before.id, op.before)
        set({ elements: map })
        persistUpdate([op.before])
        break
      case 'batch-update':
        for (const pr of op.pairs) map.set(pr.before.id, pr.before)
        set({ elements: map })
        persistUpdate(op.pairs.map((pr) => pr.before))
        break
      case 'clear':
        for (const el of op.elements) map.set(el.id, el)
        set({ elements: map })
        persistAdd(op.elements)
        break
    }
  },

  redo: () => {
    const s = get()
    const op = s.redoStack[s.redoStack.length - 1]
    if (!op) return
    set({ redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, op] })
    const map = new Map(s.elements)
    switch (op.kind) {
      case 'add':
        for (const el of op.elements) map.set(el.id, el)
        set({ elements: map })
        persistAdd(op.elements)
        break
      case 'delete':
        for (const el of op.elements) map.delete(el.id)
        set({ elements: map })
        persistDelete(op.elements.map((e) => e.id))
        break
      case 'update':
        map.set(op.after.id, op.after)
        set({ elements: map })
        persistUpdate([op.after])
        break
      case 'batch-update':
        for (const pr of op.pairs) map.set(pr.after.id, pr.after)
        set({ elements: map })
        persistUpdate(op.pairs.map((pr) => pr.after))
        break
      case 'clear':
        set({ elements: new Map(), selectedIds: [] })
        broadcast({ event: 'elements:clear' })
        void persistClear()
        break
    }
  },

  replaceAll: (elements) => set({ elements: new Map(elements.map((e) => [e.id, e])) }),

  remoteAdd: (el) => {
    set((s) => {
      const map = new Map(s.elements)
      map.set(el.id, el)
      return { elements: map }
    })
    remoteDrafts.delete(el.id)
  },

  remoteUpdate: (el) => {
    set((s) => {
      if (!s.elements.has(el.id)) return s
      const map = new Map(s.elements)
      map.set(el.id, el)
      return { elements: map }
    })
  },

  remoteDelete: (ids) => {
    set((s) => {
      const map = new Map(s.elements)
      const selectedIds = s.selectedIds.filter((id) => !ids.includes(id))
      let editingId = s.editingId
      for (const id of ids) {
        map.delete(id)
        if (editingId === id) editingId = null
      }
      return { elements: map, selectedIds, editingId }
    })
    for (const id of ids) remoteDrafts.delete(id)
  },

  remoteClear: () => set({ elements: new Map(), selectedIds: [], marquee: null, editingId: null }),

  setCursor: (userId, x, y) => {
    set((s) => {
      const user = s.users.find((u) => u.id === userId)
      if (!user) return s
      const cursors = new Map(s.cursors)
      cursors.set(userId, { x, y, name: user.name, color: user.color, ts: Date.now() })
      return { cursors }
    })
  },

  pruneCursors: () => {
    const now = Date.now()
    set((s) => {
      let changed = false
      const cursors = new Map(s.cursors)
      for (const [id, c] of cursors) {
        if (now - c.ts > 15000) {
          cursors.delete(id)
          changed = true
        }
      }
      return changed ? { cursors } : s
    })
  },
}))
