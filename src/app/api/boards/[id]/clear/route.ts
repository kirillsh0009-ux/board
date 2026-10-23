import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id: boardId } = await params

    const board = await db.board.findUnique({ where: { id: boardId }, select: { id: true } })
    if (!board) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    await db.element.deleteMany({ where: { boardId } })
    await db.board.update({
      where: { id: boardId },
      data: { updatedAt: new Date() },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[POST /api/boards/:id/clear] error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
