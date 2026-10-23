import { create } from 'zustand'
import type { Socket } from 'socket.io-client'
import type { BoardElement, Camera, ConnectionStatus, Tool, UserData } from './types'
import { toWire } from './wire'

/** network bridge — BoardView assigns socket + boardId */
export const net: { socket: Socket | null; boardId: string | null } = { socket: null, boardId: null }

/** remote in-progress strokes (userId+strokeId -> stroke), rendered every frame */
export const remoteDrafts = new Map<string, { points: number[]; color: string; width: number; marker: boolean; ts: number }>()

export type Op =
  | { kind: 'add'; elements: BoardElement[] }
  | { kind: 'delete'; elements: BoardElement[] }
  | { kind: 'update'; before: BoardElement; after: BoardElement }
  | { kind: 'clear'; elements: BoardElement[] }

export interface CursorInfo {
  x: number
  y: number
  name: string
  color: string
  ts: number
}

function emit(event: string, payload: Record<string, unknown>) {
  const s = net.socket
  if (s && net.boardId && s.connected) s.emit(event, { boardId: net.boardId, ...payload })
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
  selectedId: string | null
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
  select: (id: string | null) => void
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
  for (const el of els) emit('element:add', { element: toWire(el) })
}
function persistUpdate(els: BoardElement[]) {
  for (const el of els) emit('element:update', { element: toWire(el) })
}
function persistDelete(ids: string[]) {
  if (ids.length > 0) emit('element:delete', { ids })
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
  selectedId: null,
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
  setTool: (tool) => set({ tool, selectedId: tool === 'select' ? get().selectedId : null }),
  setColor: (color) => set({ color }),
  setStickyColor: (stickyColor) => set({ stickyColor }),
  setWidth: (width) => set({ width }),
  select: (selectedId) => set({ selectedId }),
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
    set({ elements: map, selectedId: s.selectedId && ids.includes(s.selectedId) ? null : s.selectedId, editingId: s.editingId && ids.includes(s.editingId) ? null : s.editingId })
    persistDelete(ids)
    if (opts?.record !== false) get().pushOp({ kind: 'delete', elements: removed })
  },

  clearAll: () => {
    const s = get()
    const elements = Array.from(s.elements.values())
    if (elements.length === 0) return
    set({ elements: new Map(), selectedId: null, editingId: null })
    emit('elements:clear', {})
    get().pushOp({ kind: 'clear', elements })
  },

  pushOp: (op) =>
    set((s) => ({
      undoStack: [...s.undoStack.slice(-MAX_OPS), op],
      redoStack: [],
    })),

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
      case 'clear':
        set({ elements: new Map(), selectedId: null })
        emit('elements:clear', {})
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
      let selectedId = s.selectedId
      let editingId = s.editingId
      for (const id of ids) {
        map.delete(id)
        if (selectedId === id) selectedId = null
        if (editingId === id) editingId = null
      }
      return { elements: map, selectedId, editingId }
    })
    for (const id of ids) remoteDrafts.delete(id)
  },

  remoteClear: () => set({ elements: new Map(), selectedId: null, editingId: null }),

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
