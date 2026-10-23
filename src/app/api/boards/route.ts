import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BOARD_ID_RE = /^[a-zA-Z0-9_-]{4,32}$/
const MAX_NAME_LENGTH = 100
const DEFAULT_NAME = 'Новая доска'

/** Cuid-подобный генератор id (когда клиент не передал свой) */
function generateId(): string {
  const time = Date.now().toString(36)
  const rand = randomUUID().replace(/-/g, '').slice(0, 16)
  return `c${time}${rand}`
}

function isValidId(id: string): boolean {
  return BOARD_ID_RE.test(id)
}

function sanitizeName(name: unknown): string {
  if (typeof name === 'string' && name.trim().length > 0) {
    return name.trim().slice(0, MAX_NAME_LENGTH)
  }
  return DEFAULT_NAME
}

export async function GET() {
  try {
    const boards = await db.board.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return NextResponse.json({ boards })
  } catch (error) {
    console.error('[GET /api/boards] error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }

    const { id, name } = (body ?? {}) as { id?: unknown; name?: unknown }

    // Явный id: upsert (если существует — вернуть как есть)
    if (id !== undefined && id !== null) {
      if (typeof id !== 'string' || !isValidId(id)) {
        return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
      }
      const existing = await db.board.findUnique({ where: { id } })
      if (existing) {
        return NextResponse.json({ board: existing }, { status: 200 })
      }
      const board = await db.board.create({
        data: { id, name: sanitizeName(name) },
      })
      return NextResponse.json({ board }, { status: 201 })
    }

    // Без id: создаём с генерированным id
    const board = await db.board.create({
      data: { id: generateId(), name: sanitizeName(name) },
    })
    return NextResponse.json({ board }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/boards] error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
