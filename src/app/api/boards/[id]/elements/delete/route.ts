import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_IDS_PER_REQUEST = 500

interface RouteContext {
  params: Promise<{ id: string }>
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

    const ids = (body as { ids?: unknown } | null)?.ids
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > MAX_IDS_PER_REQUEST ||
      !ids.every((v) => typeof v === 'string' && v.length > 0)
    ) {
      return NextResponse.json({ error: 'invalid_ids' }, { status: 400 })
    }

    const result = await db.element.deleteMany({
      where: { id: { in: ids }, boardId },
    })

    return NextResponse.json({ ok: true, count: result.count })
  } catch (error) {
    console.error('[POST /api/boards/:id/elements/delete] error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
