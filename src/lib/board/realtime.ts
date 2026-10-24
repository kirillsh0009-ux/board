'use client'

/**
 * Realtime bus over Supabase Realtime (broadcast + presence).
 *
 * Replaces the former socket.io transport: board events (element ops,
 * cursors, in-progress strokes) are relayed via Supabase broadcast channels,
 * and the online-users list is powered by Realtime presence.
 *
 * If NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set
 * the bus is disabled and the board works in local-only mode.
 */

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import type { WireElement } from './wire'

export interface RTUser {
  id: string
  name: string
  color: string
}

export type RTEvent =
  | { event: 'element:add'; element: WireElement }
  | { event: 'element:update'; element: WireElement }
  | { event: 'element:delete'; ids: string[] }
  | { event: 'elements:clear' }
  | { event: 'cursor'; userId: string; x: number; y: number }
  | {
      event: 'stroke:progress'
      userId: string
      stroke: { id: string; points: number[]; color: string; width: number; marker: boolean }
    }

export interface RealtimeHandlers {
  onStatus: (status: 'online' | 'offline') => void
  onUsers: (users: RTUser[]) => void
  onUserJoined: (user: RTUser) => void
  onUserLeft: (user: RTUser) => void
  onEvent: (ev: RTEvent) => void
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

function usersFromPresence(ch: RealtimeChannel, selfId: string | null): RTUser[] {
  const state = ch.presenceState() as Record<string, Array<{ id?: string; name?: string; color?: string }>>
  const users: RTUser[] = []
  for (const [key, metas] of Object.entries(state)) {
    const meta = metas[metas.length - 1]
    if (!meta || typeof meta.name !== 'string' || typeof meta.color !== 'string') continue
    users.push({ id: key === selfId ? (selfId as string) : key, name: meta.name, color: meta.color })
  }
  return users
}

export class RealtimeBus {
  enabled = false
  private sb: SupabaseClient | null = null
  private ch: RealtimeChannel | null = null
  private boardId: string | null = null
  private me: RTUser | null = null
  private handlers: RealtimeHandlers | null = null
  /** events received before the initial snapshot was applied */
  private pending: RTEvent[] = []
  private ready = false

  connect(boardId: string, me: RTUser, handlers: RealtimeHandlers) {
    this.handlers = handlers
    this.boardId = boardId
    this.me = me
    this.ready = false
    this.pending = []

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      this.enabled = false
      // offline-friendly single player mode
      handlers.onStatus('online')
      handlers.onUsers([me])
      return
    }
    this.enabled = true

    if (!this.sb) {
      this.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 30 } },
      })
    }

    const ch = this.sb.channel(`board:${boardId}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: me.id } },
    })
    this.ch = ch

    ch.on('broadcast', { event: 'op' }, ({ payload }) => {
      const ev = payload as RTEvent
      if (!ev || typeof ev.event !== 'string') return
      if (!this.ready) {
        this.pending.push(ev)
        return
      }
      handlers.onEvent(ev)
    })

    ch.on('presence', { event: 'sync' }, () => {
      if (!this.ch) return
      handlers.onUsers(usersFromPresence(this.ch, this.me?.id ?? null))
    })

    ch.on('presence', { event: 'join' }, ({ newPresences }) => {
      for (const p of newPresences as Array<{ name?: string; color?: string }>) {
        if (this.me && p.name && p.id !== this.me.id && typeof p.name === 'string' && typeof p.color === 'string') {
          handlers.onUserJoined({ id: (p as { id?: string }).id ?? '', name: p.name, color: p.color })
        }
      }
    })

    ch.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      for (const p of leftPresences as Array<{ id?: string; name?: string; color?: string }>) {
        if (this.me && p.name && p.id !== this.me.id && typeof p.name === 'string' && typeof p.color === 'string') {
          handlers.onUserLeft({ id: (p as { id?: string }).id ?? '', name: p.name, color: p.color })
        }
      }
    })

    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        this.markReady()
        ch.track({ id: this.me?.id, name: this.me?.name, color: this.me?.color })
        handlers.onStatus('online')
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        handlers.onStatus('offline')
      }
    })
  }

  /** called by BoardView after the initial snapshot has been applied */
  markReady() {
    this.ready = true
    const buffered = this.pending
    this.pending = []
    const h = this.handlers
    if (h) for (const ev of buffered) h.onEvent(ev)
  }

  /** broadcast an op to other clients */
  send(ev: RTEvent) {
    if (!this.enabled || !this.ch) return
    // fire-and-forget; failures only affect live sync, persistence is REST-based
    void this.ch.send({ type: 'broadcast', event: 'op', payload: ev } as never).catch(() => {})
  }

  /** update own presence (after rename / color change) */
  updateMe(me: RTUser) {
    this.me = me
    if (this.enabled && this.ch) {
      try {
        this.ch.untrack()
        this.ch.track({ id: me.id, name: me.name, color: me.color })
      } catch {
        /* ignore */
      }
    }
  }

  disconnect() {
    const ch = this.ch
    this.ch = null
    this.ready = false
    this.pending = []
    this.handlers = null
    if (ch && this.sb) {
      try {
        void this.sb.removeChannel(ch)
      } catch {
        /* ignore */
      }
    }
  }
}
