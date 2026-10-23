'use client'

import { useEffect, useState } from 'react'
import { Plus, StickyNote, LogIn, Trash2, ChevronRight, PenLine, Users, Download, Wifi } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getRecents, removeRecent, upsertRecent, parseBoardInput, formatDate, type RecentBoard } from '@/lib/board/utils'
import { useToast } from '@/hooks/use-toast'

export default function HomeView() {
  const [recents, setRecents] = useState<RecentBoard[]>([])
  const [joinValue, setJoinValue] = useState('')
  const [creating, setCreating] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    setRecents(getRecents())
  }, [])

  const createBoard = async () => {
    if (creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      upsertRecent(data.board.id, data.board.name)
      window.location.assign(`/?board=${data.board.id}`)
    } catch {
      toast({ title: 'Ошибка', description: 'Не удалось создать доску. Попробуйте ещё раз.' })
      setCreating(false)
    }
  }

  const joinBoard = () => {
    const id = parseBoardInput(joinValue)
    if (!id) {
      toast({ title: 'Неверный код', description: 'Введите код доски или ссылку-приглашение' })
      return
    }
    window.location.assign(`/?board=${id}`)
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-zinc-50">
      <header className="border-b border-zinc-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-900 text-white shadow-sm">
            <PenLine className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight text-zinc-900">Доска</span>
          <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500">
            совместная
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:py-14">
        <div className="grid gap-8 lg:grid-cols-[1fr_380px] lg:gap-12">
          <section className="order-2 lg:order-1">
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
              Белая доска для вашей{' '}
              <span className="relative inline-block">
                команды
                <span className="absolute inset-x-0 bottom-1 -z-10 h-3 rounded-sm bg-amber-200/80" aria-hidden />
              </span>
            </h1>
            <p className="mt-3 max-w-lg text-base leading-relaxed text-zinc-500">
              Рисуйте от руки, двигайте стикеры и наблюдайте курсоры друг друга в реальном времени.
              Достаточно открыть одну ссылку — без регистрации.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {[
                { icon: PenLine, title: 'Рисование и фигуры', text: 'Ручка с поддержкой Apple Pencil, маркер, фигуры, стрелки' },
                { icon: StickyNote, title: 'Стикеры и текст', text: 'Быстрые заметки разных цветов — как на настоящей доске' },
                { icon: Users, title: 'Живые курсоры', text: 'Видьте, где сейчас работают другие участники' },
                { icon: Wifi, title: 'Реальное время', text: 'Изменения появляются у всех мгновенно' },
              ].map((f) => (
                <div key={f.title} className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm">
                  <f.icon className="mb-2.5 h-5 w-5 text-zinc-700" />
                  <div className="text-sm font-semibold text-zinc-800">{f.title}</div>
                  <div className="mt-0.5 text-sm leading-snug text-zinc-500">{f.text}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="order-1 lg:order-2">
            <Card className="border-zinc-200/80 shadow-xl shadow-zinc-200/60">
              <CardContent className="p-5 sm:p-6">
                <Button
                  onClick={createBoard}
                  disabled={creating}
                  className="h-13 w-full rounded-xl bg-zinc-900 py-6 text-base font-semibold text-white shadow-lg shadow-zinc-300/60 transition-all hover:bg-zinc-700 active:scale-[0.98] disabled:opacity-60"
                >
                  <Plus className="h-5 w-5" />
                  {creating ? 'Создаём…' : 'Создать доску'}
                </Button>

                <div className="my-5 flex items-center gap-3 text-xs text-zinc-400">
                  <span className="h-px flex-1 bg-zinc-200" aria-hidden />
                  или присоединиться
                  <span className="h-px flex-1 bg-zinc-200" aria-hidden />
                </div>

                <div className="flex gap-2">
                  <Input
                    value={joinValue}
                    onChange={(e) => setJoinValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') joinBoard()
                    }}
                    placeholder="Код или ссылка"
                    aria-label="Код доски или ссылка"
                    className="h-12 flex-1 rounded-xl border-zinc-200 text-base"
                  />
                  <Button
                    onClick={joinBoard}
                    aria-label="Присоединиться"
                    className="h-12 w-12 rounded-xl bg-zinc-800 p-0 text-white hover:bg-zinc-700"
                  >
                    <LogIn className="h-5 w-5" />
                  </Button>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                  Попросите у друга код доски или вставьте ссылку-приглашение целиком.
                </p>

                {recents.length > 0 && (
                  <div className="mt-6 border-t border-zinc-100 pt-4">
                    <div className="mb-2 flex items-center justify-between px-1">
                      <span className="text-sm font-semibold text-zinc-700">Недавние доски</span>
                    </div>
                    <ScrollArea className="max-h-64 pr-2">
                      <ul className="space-y-1">
                        {recents.map((r) => (
                          <li
                            key={r.id}
                            className="group flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-zinc-100"
                          >
                            <a
                              href={`/?board=${r.id}`}
                              className="flex min-w-0 flex-1 items-center gap-2.5"
                              data-testid={`recent-${r.id}`}
                            >
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                                <StickyNote className="h-4 w-4" />
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-zinc-800">{r.name}</span>
                                <span className="block text-xs text-zinc-400">
                                  код {r.id} · {formatDate(r.ts)}
                                </span>
                              </span>
                            </a>
                            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300 group-hover:text-zinc-500" />
                            <button
                              type="button"
                              aria-label={`Удалить ${r.name} из списка`}
                              onClick={() => setRecents(removeRecent(r.id))}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-zinc-400">
              <Download className="h-3.5 w-3.5" />
              <span>Экспорт в PNG · Работа с iPad · Apple Pencil</span>
            </div>
          </section>
        </div>
      </main>

      <footer className="mt-auto border-t border-zinc-200/70 bg-white/80 py-5 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 text-center text-sm text-zinc-400">
          Оптимизировано для iPad · Синхронизация в реальном времени · Легко разворачивается на бесплатных серверах
        </div>
      </footer>
    </div>
  )
}
