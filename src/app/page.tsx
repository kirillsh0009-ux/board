import HomeView from '@/components/board/HomeView'
import BoardView from '@/components/board/BoardView'

export const dynamic = 'force-dynamic'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ board?: string | string[] }>
}) {
  const params = await searchParams
  const raw = params.board
  const boardId = Array.isArray(raw) ? raw[0] : raw

  if (boardId && /^[a-zA-Z0-9_-]{4,32}$/.test(boardId)) {
    return <BoardView boardId={boardId} />
  }
  return <HomeView />
}
