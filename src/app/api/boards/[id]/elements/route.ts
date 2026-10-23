import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_ELEMENTS_PER_REQUEST = 200
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
  // data — произвольный JSON-объект (не примитив, не null)
  if (typeof el.data !== 'object' || el.data === null) return false
  return true
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id: boardId } = await params

    const elements = await db.element.findMany({
      where: { boardId },
      select: { id: true, type: true, data: true },
    })

    return NextResponse.json({
      elements: elements.map((el) => ({
        id: el.id,
        type: el.type,
        data: safeParse(el.data),
      })),
    })
  } catch (error) {
    console.error('[GET /api/boards/:id/elements] error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

function safeParse(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { id: boardId } = await params

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }

    const rawElements = (body as { elements?: unknown } | null)?.elements
    if (!Array.isArray(rawElements) || rawElements.length === 0) {
      return NextResponse.json({ error: 'invalid_elements' }, { status: 400 })
    }
    if (rawElements.length > MAX_ELEMENTS_PER_REQUEST) {
      return NextResponse.json({ error: 'too_many_elements' }, { status: 400 })
    }

    const elements: IncomingElement[] = []
    for (const raw of rawElements) {
      if (!isValidElement(raw)) {
        return NextResponse.json({ error: 'invalid_element' }, { status: 400 })
      }
      elements.push(raw)
    }

    // Доска должна существовать
    const board = await db.board.findUnique({ where: { id: boardId }, select: { id: true } })
    if (!board) {
      return NextResponse.json({ error: 'not_found' }, { status: 400 })
    }

    await db.$transaction(
      elements.map((el) =>
        db.element.upsert({
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
      )
    )

    // Обновляем updatedAt доски (сигнал активности)
    await db.board.update({
      where: { id: boardId },
      data: { updatedAt: new Date() },
    })

    return NextResponse.json({ ok: true, count: elements.length })
  } catch (error) {
    console.error('[POST /api/boards/:id/elements] error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
