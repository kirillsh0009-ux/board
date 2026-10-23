// Production server: Next.js (App Router) + socket.io real-time sync on ONE port.
// This is a faithful JS port of mini-services/board-ws/index.ts so that the whole
// app fits a single free hosting instance (Render/Koyeb) with the WS on the same
// origin (path /socket.io) — no CORS, no second service.
//
// Env:
//   PORT                 — listen port (Render sets it; default 3000)
//   API_BASE             — REST base for persistence (default http://127.0.0.1:$PORT, i.e. itself)
//   WS_PATH              — socket.io path (default /socket.io)
//   PROD_SERVER_NO_NEXT=1— test mode: WS only, no Next (for local integration tests)
//   NEXT_PUBLIC_WS_URL / NEXT_PUBLIC_WS_PATH — client side (see BoardView.tsx)

import { createServer } from 'node:http'

const PORT = Number(process.env.PORT || 3000)
const NO_NEXT = process.env.PROD_SERVER_NO_NEXT === '1'
const API_BASE = process.env.API_BASE || (NO_NEXT ? 'http://127.0.0.1:3000' : `http://127.0.0.1:${PORT}`)
const WS_PATH = process.env.WS_PATH || '/socket.io'

const MAX_ELEMENTS_PER_ROOM = 8000
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000
const FLUSH_DEBOUNCE_MS = 700
const FLUSH_RETRY_MS = 2000
const FETCH_TIMEOUT_MS = 5000

// ---------- Types ----------

/** @typedef {{ id: string, type: string, data: object }} BoardElement */
/** @typedef {{ elements: Map<string, BoardElement>, loaded: boolean, emptyTimer: any }} Room */

// ---------- In-memory state ----------

/** @type {Map<string, Room>} */
const rooms = new Map()
/** @type {Map<string, Map<string, { id: string, name: string, color: string }>>} */
const roomUsers = new Map()
/** @type {Map<string, Set<string>>} */
const socketBoards = new Map()

/** @type {Map<string, Map<string, BoardElement>>} */
const pendingUpserts = new Map()
/** @type {Map<string, Set<string>>} */
const pendingDeletes = new Map()
const pendingClear = new Set()
/** @type {Map<string, any>} */
const flushTimers = new Map()
/** @type {Map<string, any>} */
const retryTimers = new Map()

// ---------- Utils ----------

function getRoom(boardId, autoCreate = false) {
  let room = rooms.get(boardId)
  if (!room && autoCreate) {
    room = { elements: new Map(), loaded: false, emptyTimer: null }
    rooms.set(boardId, room)
  }
  return room ?? null
}

function getUsersMap(boardId) {
  let users = roomUsers.get(boardId)
  if (!users) {
    users = new Map()
    roomUsers.set(boardId, users)
  }
  return users
}

function isValidBoardId(boardId) {
  return typeof boardId === 'string' && boardId.length > 0 && boardId.length < 64
}

/** Element: id — string < 64 chars, type — non-empty string, data — object */
function sanitizeElement(raw) {
  if (typeof raw !== 'object' || raw === null) return null
  const el = raw
  if (typeof el.id !== 'string' || el.id.length === 0 || el.id.length >= 64) return null
  if (typeof el.type !== 'string' || el.type.length === 0) return null
  const data = typeof el.data === 'object' && el.data !== null ? el.data : {}
  return { id: el.id, type: el.type, data }
}

/** Insert with room size cap (drop oldest — Map order) */
function setElementInRoom(room, element) {
  if (!room.elements.has(element.id) && room.elements.size >= MAX_ELEMENTS_PER_ROOM) {
    const oldest = room.elements.keys().next().value
    if (oldest !== undefined) room.elements.delete(oldest)
  }
  room.elements.set(element.id, element)
}

/** Schedule room memory eviction when nobody is inside */
function scheduleRoomCleanup(boardId) {
  const room = rooms.get(boardId)
  if (!room) return
  if (room.emptyTimer) clearTimeout(room.emptyTimer)
  room.emptyTimer = setTimeout(() => {
    const users = roomUsers.get(boardId)
    if (users && users.size > 0) return // someone re-joined in time
    rooms.delete(boardId)
    roomUsers.delete(boardId)
    console.log(`[board-ws] room ${boardId}: memory evicted after idle`)
  }, EMPTY_ROOM_TTL_MS)
}

// ---------- Persistence (batched via REST API) ----------

function getUpserts(boardId) {
  let map = pendingUpserts.get(boardId)
  if (!map) {
    map = new Map()
    pendingUpserts.set(boardId, map)
  }
  return map
}

function getDeletes(boardId) {
  let set = pendingDeletes.get(boardId)
  if (!set) {
    set = new Set()
    pendingDeletes.set(boardId, set)
  }
  return set
}

function queueUpsert(boardId, element) {
  // upsert cancels a pending delete of the same element
  pendingDeletes.get(boardId)?.delete(element.id)
  getUpserts(boardId).set(element.id, element)
  scheduleFlush(boardId)
}

function queueDelete(boardId, ids) {
  const upserts = pendingUpserts.get(boardId)
  for (const id of ids) {
    // delete cancels a pending upsert of the same element
    upserts?.delete(id)
    getDeletes(boardId).add(id)
  }
  scheduleFlush(boardId)
}

function queueClear(boardId) {
  // clear wipes both upserts and deletes
  pendingUpserts.delete(boardId)
  pendingDeletes.delete(boardId)
  pendingClear.add(boardId)
  scheduleFlush(boardId)
}

function scheduleFlush(boardId) {
  if (flushTimers.has(boardId) || retryTimers.has(boardId)) return
  flushTimers.set(
    boardId,
    setTimeout(() => {
      flushTimers.delete(boardId)
      void flushBoard(boardId, false)
    }, FLUSH_DEBOUNCE_MS)
  )
}

async function flushBoard(boardId, isRetry) {
  // Snapshot buffers — new operations keep accumulating meanwhile
  const clearFlag = pendingClear.has(boardId)
  pendingClear.delete(boardId)

  const upsertList = Array.from(pendingUpserts.get(boardId)?.values() ?? [])
  pendingUpserts.delete(boardId)

  const deleteList = Array.from(pendingDeletes.get(boardId) ?? [])
  pendingDeletes.delete(boardId)

  if (!clearFlag && upsertList.length === 0 && deleteList.length === 0) return

  try {
    if (clearFlag) {
      const res = await fetch(`${API_BASE}/api/boards/${boardId}/clear`, {
        method: 'POST',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok && res.status !== 404) {
        throw new Error(`clear failed with ${res.status}`)
      }
    }
    if (upsertList.length > 0) {
      const res = await fetch(`${API_BASE}/api/boards/${boardId}/elements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elements: upsertList }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok && res.status !== 404 && res.status !== 400) {
        throw new Error(`upsert failed with ${res.status}`)
      }
    }
    if (deleteList.length > 0) {
      const res = await fetch(`${API_BASE}/api/boards/${boardId}/elements/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: deleteList }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok && res.status !== 404) {
        throw new Error(`delete failed with ${res.status}`)
      }
    }
  } catch (err) {
    console.error(`[board-ws] flush failed for board ${boardId}:`, err)
    // Put the data back into buffers
    if (clearFlag) pendingClear.add(boardId)
    if (upsertList.length > 0) {
      const upserts = getUpserts(boardId)
      for (const el of upsertList) upserts.set(el.id, el)
    }
    if (deleteList.length > 0) {
      const deletes = getDeletes(boardId)
      for (const id of deleteList) deletes.add(id)
    }
    // Single retry of the whole flush after 2s
    if (!isRetry && !retryTimers.has(boardId)) {
      retryTimers.set(
        boardId,
        setTimeout(() => {
          retryTimers.delete(boardId)
          void flushBoard(boardId, true)
        }, FLUSH_RETRY_MS)
      )
    }
  }
}

// ---------- HTTP server (Next.js or test stub) ----------

let handler
if (NO_NEXT) {
  handler = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('board prod-server: ws-only test mode')
  }
  console.log('[prod-server] WS-only test mode (Next.js disabled)')
} else {
  const nextFactory = (await import('next')).default
  const app = nextFactory({ dev: false })
  await app.prepare()
  handler = app.getRequestHandler()
  console.log('[prod-server] Next.js prepared')
}

const httpServer = createServer((req, res) => {
  handler(req, res)
})

// ---------- Socket.io ----------

import { Server } from 'socket.io'

const io = new Server(httpServer, {
  path: WS_PATH,
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

async function loadBoardElements(boardId) {
  try {
    const res = await fetch(`${API_BASE}/api/boards/${boardId}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return []
    const body = await res.json()
    if (!Array.isArray(body.elements)) return []
    const result = []
    for (const raw of body.elements) {
      const el = sanitizeElement(raw)
      if (el) result.push(el)
    }
    return result
  } catch (err) {
    console.error(`[board-ws] failed to load board ${boardId}:`, err)
    return []
  }
}

function leaveBoard(socket, boardId) {
  const boards = socketBoards.get(socket.id)
  if (boards) boards.delete(boardId)

  const users = getUsersMap(boardId)
  const user = users.get(socket.id)
  users.delete(socket.id)

  if (user) {
    io.to(boardId).emit('user:left', { userId: user.id })
    io.to(boardId).emit('users', { users: Array.from(users.values()) })
  }

  if (users.size === 0) {
    roomUsers.delete(boardId)
    scheduleRoomCleanup(boardId)
  }
  socket.leave(boardId)
}

io.on('connection', (socket) => {
  socketBoards.set(socket.id, new Set())

  socket.on('board:join', async (payload, ack) => {
    try {
      const { boardId, user } = payload ?? {}
      if (!isValidBoardId(boardId) || typeof user !== 'object' || user === null) {
        ack?.({ ok: false, error: 'invalid_payload' })
        return
      }
      const u = user
      if (typeof u.id !== 'string' || typeof u.name !== 'string' || typeof u.color !== 'string') {
        ack?.({ ok: false, error: 'invalid_user' })
        return
      }

      // Room: auto-create empty, cancel pending eviction
      const room = getRoom(boardId, true)
      if (room && room.emptyTimer) {
        clearTimeout(room.emptyTimer)
        room.emptyTimer = null
      }

      // Lazy-load elements from REST API on first join
      if (room && !room.loaded) {
        room.loaded = true
        const elements = await loadBoardElements(boardId)
        for (const el of elements) room.elements.set(el.id, el)
      }

      socket.join(boardId)
      socketBoards.get(socket.id)?.add(boardId)

      const users = getUsersMap(boardId)
      users.set(socket.id, { id: u.id, name: u.name, color: u.color })

      const elements = room ? Array.from(room.elements.values()) : []
      ack?.({ ok: true, elements, users: Array.from(users.values()) })

      // Everyone else in the room
      socket.to(boardId).emit('user:joined', { user: { id: u.id, name: u.name, color: u.color } })
      console.log(`[board-ws] board ${boardId}: user ${u.id} joined (${users.size} online)`)
    } catch (err) {
      console.error('[board-ws] board:join error:', err)
      ack?.({ ok: false, error: 'internal_error' })
    }
  })

  socket.on('element:add', (payload) => {
    const { boardId, element } = payload ?? {}
    if (!isValidBoardId(boardId)) return
    const room = getRoom(boardId) // unknown board -> ignore
    if (!room) return
    const el = sanitizeElement(element)
    if (!el) return
    setElementInRoom(room, el)
    queueUpsert(boardId, el)
    socket.to(boardId).emit('element:add', { element: el })
  })

  socket.on('element:update', (payload) => {
    const { boardId, element } = payload ?? {}
    if (!isValidBoardId(boardId)) return
    const room = getRoom(boardId)
    if (!room) return
    const el = sanitizeElement(element)
    if (!el) return
    // accept even if the element was not in memory
    setElementInRoom(room, el)
    queueUpsert(boardId, el)
    socket.to(boardId).emit('element:update', { element: el })
  })

  socket.on('element:delete', (payload) => {
    const { boardId, ids } = payload ?? {}
    if (!isValidBoardId(boardId)) return
    const room = getRoom(boardId)
    if (!room) return
    if (!Array.isArray(ids) || ids.length === 0) return
    const validIds = ids.filter((v) => typeof v === 'string' && v.length > 0 && v.length < 64)
    if (validIds.length === 0) return
    for (const id of validIds) room.elements.delete(id)
    queueDelete(boardId, validIds)
    socket.to(boardId).emit('element:delete', { ids: validIds })
  })

  socket.on('elements:clear', (payload) => {
    const { boardId } = payload ?? {}
    if (!isValidBoardId(boardId)) return
    const room = getRoom(boardId)
    if (!room) return
    room.elements.clear()
    queueClear(boardId)
    socket.to(boardId).emit('elements:clear', {})
  })

  socket.on('cursor', (payload) => {
    const { boardId, x, y } = payload ?? {}
    if (!isValidBoardId(boardId)) return
    if (typeof x !== 'number' || typeof y !== 'number') return
    const user = roomUsers.get(boardId)?.get(socket.id)
    if (!user) return
    socket.to(boardId).emit('cursor', { userId: user.id, x, y })
  })

  socket.on('stroke:progress', (payload) => {
    const { boardId, stroke } = payload ?? {}
    if (!isValidBoardId(boardId)) return
    const user = roomUsers.get(boardId)?.get(socket.id)
    if (!user) return
    socket.to(boardId).emit('stroke:progress', { userId: user.id, stroke })
  })

  socket.on('disconnect', () => {
    const boards = socketBoards.get(socket.id)
    socketBoards.delete(socket.id)
    if (!boards) return
    for (const boardId of boards) {
      leaveBoard(socket, boardId)
    }
  })
})

httpServer.listen(PORT, () => {
  console.log(`Board prod server (Next + WS) listening on port ${PORT}, ws path: ${WS_PATH}, API_BASE: ${API_BASE}`)
})

process.on('SIGTERM', () => {
  console.log('[prod-server] SIGTERM, shutting down...')
  httpServer.close(() => process.exit(0))
})

process.on('SIGINT', () => {
  console.log('[prod-server] SIGINT, shutting down...')
  httpServer.close(() => process.exit(0))
})
