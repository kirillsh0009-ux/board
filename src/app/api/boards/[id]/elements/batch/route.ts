import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_ITEMS_PER_REQUEST = 200
const MAX_ELEMENT_ID_LENGTH = 64

interface RouteContext {
  params: Promise<{ id: string }>
}

interface IncomingElement {
  id: string
  type: string
  data: Record<string, unknown>
}

function isValidElement(raw: unknown): raw is IncomingElement {
  if (typeof raw !== 'object' || raw === null) return false
  const el = raw as { id?: unknown; type?: unknown; data?: unknown }
  if (typeof el.id !== 'string' || el.id.length === 0 || el.id.length >= MAX_ELEMENT_ID_LENGTH) return false
  if (typeof el.type !== 'string' || el.type.trim().length === 0) return false
  if (typeof el.data !== 'object' || el.data === null || Array.isArray(el.data)) return false
  return true
}

/**
 * Batched persistence used by the client-side queue:
 * body: { upserts: WireElement[], deletes: string[] }
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { id: boardId } = await params

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }

    const raw = (body ?? {}) as { upserts?: unknown; deletes?: unknown }
    const rawUpserts = Array.isArray(raw.upserts) ? raw.upserts : []
    const rawDeletes = Array.isArray(raw.deletes) ? raw.deletes : []

    if (rawUpserts.length === 0 && rawDeletes.length === 0) {
      return NextResponse.json({ ok: true, upserts: 0, deletes: 0 })
    }
    if (rawUpserts.length > MAX_ITEMS_PER_REQUEST || rawDeletes.length > MAX_ITEMS_PER_REQUEST) {
      return NextResponse.json({ error: 'too_many_items' }, { status: 400 })
    }

    const elements: IncomingElement[] = []
    for (const item of rawUpserts) {
      if (!isValidElement(item)) {
        return NextResponse.json({ error: 'invalid_element' }, { status: 400 })
      }
      elements.push(item)
    }

    const deleteIds: string[] = []
    for (const item of rawDeletes) {
      if (typeof item !== 'string' || item.length === 0 || item.length >= MAX_ELEMENT_ID_LENGTH) {
        return NextResponse.json({ error: 'invalid_delete_id' }, { status: 400 })
      }
      deleteIds.push(item)
    }

    // The board must exist (created by POST /api/boards when a client opens it)
    const board = await db.board.findUnique({ where: { id: boardId }, select: { id: true } })
    if (!board) {
      return NextResponse.json({ error: 'not_found' }, { status: 400 })
    }

    await db.$transaction(async (tx) => {
      for (const el of elements) {
        await tx.element.upsert({
          where: { id: el.id },
          update: {
            type: el.type,
            data: JSON.stringify(el.data),
            boardId,
          },
          create: {
            id: el.id,
            type: el.type,
            data: JSON.stringify(el.data),
            boardId,
          },
        })
      }
      if (deleteIds.length > 0) {
        await tx.element.deleteMany({
          where: { id: { in: deleteIds }, boardId },
        })
      }
      await tx.board.update({
        where: { id: boardId },
        data: { updatedAt: new Date() },
      })
    })

    return NextResponse.json({ ok: true, upserts: elements.length, deletes: deleteIds.length })
  } catch (error) {
    console.error('[POST /api/boards/:id/elements/batch] error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
