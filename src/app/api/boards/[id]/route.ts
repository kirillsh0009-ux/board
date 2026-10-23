import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_NAME_LENGTH = 100

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const board = await db.board.findUnique({
      where: { id },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    })
    if (!board) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const rows = await db.element.findMany({
      where: { boardId: id },
      orderBy: { createdAt: 'asc' },
    })

    const elements = rows.map((el) => {
      let data: unknown = {}
      try {
        data = JSON.parse(el.data)
      } catch {
        data = {}
      }
      return { id: el.id, type: el.type, data }
    })

    return NextResponse.json({ board, elements })
  } catch (error) {
    console.error('[GET /api/boards/:id] error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }

    const name = (body as { name?: unknown } | null)?.name
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > MAX_NAME_LENGTH) {
      return NextResponse.json({ error: 'invalid_name' }, { status: 400 })
    }

    const existing = await db.board.findUnique({ where: { id }, select: { id: true } })
    if (!existing) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const board = await db.board.update({
      where: { id },
      data: { name: name.trim() },
    })
    return NextResponse.json({ board })
  } catch (error) {
    console.error('[PUT /api/boards/:id] error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const existing = await db.board.findUnique({ where: { id }, select: { id: true } })
    if (!existing) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    // Элементы удаляются каскадом (onDelete: Cascade)
    await db.board.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[DELETE /api/boards/:id] error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
