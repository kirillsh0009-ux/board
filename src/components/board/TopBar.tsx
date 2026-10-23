'use client'

import { useEffect, useState } from 'react'
import {
  ChevronLeft,
  Link2,
  MoreHorizontal,
  Trash2,
  Download,
  Users,
} from 'lucide-react'
import { useBoardStore } from '@/lib/board/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { USER_COLORS } from '@/lib/board/utils'
import { useToast } from '@/hooks/use-toast'

interface TopBarProps {
  onBack: () => void
  onRename: (name: string) => void
  onExport: () => void
  onClear: () => void
  onUpdateUser: (name: string, color: string) => void
}

export default function TopBar({ onBack, onRename, onExport, onClear, onUpdateUser }: TopBarProps) {
  const boardName = useBoardStore((s) => s.boardName)
  const setBoardName = useBoardStore((s) => s.setBoardName)
  const users = useBoardStore((s) => s.users)
  const me = useBoardStore((s) => s.me)
  const status = useBoardStore((s) => s.status)
  const { toast } = useToast()

  const [nameDraft, setNameDraft] = useState(boardName)
  const [myName, setMyName] = useState(me.name)

  useEffect(() => {
    setNameDraft(boardName)
  }, [boardName])

  const commitName = () => {
    const trimmed = nameDraft.trim()
    if (trimmed && trimmed !== boardName) {
      setBoardName(trimmed)
      onRename(trimmed)
    } else {
      setNameDraft(boardName)
    }
  }

  const share = async () => {
    const url = window.location.href
    try {
      if (navigator.share && /iPad|iPhone|Android/.test(navigator.userAgent)) {
        await navigator.share({ title: boardName, url })
        return
      }
      await navigator.clipboard.writeText(url)
      toast({ title: 'Ссылка скопирована', description: 'Отправьте её другим участникам' })
    } catch {
      toast({ title: 'Ссылка для приглашения', description: url })
    }
  }

  const statusInfo =
    status === 'online'
      ? { dot: 'bg-emerald-500', text: `Онлайн: ${users.length}` }
      : status === 'connecting'
        ? { dot: 'bg-amber-400 animate-pulse', text: 'Подключение…' }
        : { dot: 'bg-red-500', text: 'Нет связи' }

  const updateMe = (name: string, color: string) => {
    onUpdateUser(name, color)
  }

  return (
    <header
      className="pointer-events-none absolute left-0 right-0 top-0 z-30 flex items-start justify-between gap-2 p-3"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
    >
      <div className="pointer-events-auto flex min-w-0 items-center gap-1.5 rounded-2xl border border-zinc-200/80 bg-white/95 p-1.5 shadow-lg backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="На главную"
          className="h-9 w-9 shrink-0 rounded-xl text-zinc-600 hover:bg-zinc-100"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="mx-1 h-6 w-px shrink-0 bg-zinc-200" aria-hidden />
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          aria-label="Название доски"
          className="min-w-0 max-w-[38vw] flex-shrink rounded-lg bg-transparent px-2 py-1.5 text-sm font-medium text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 hover:bg-zinc-100 focus:bg-zinc-100 sm:max-w-56"
          placeholder="Название доски"
          maxLength={80}
        />
      </div>

      <div className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-zinc-200/80 bg-white/95 p-1.5 shadow-lg backdrop-blur">
        <div className="hidden items-center gap-1.5 px-1.5 sm:flex" aria-live="polite">
          <span className={`h-2 w-2 rounded-full ${statusInfo.dot}`} aria-hidden />
          <span className="text-xs font-medium text-zinc-500">{statusInfo.text}</span>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Участники: ${users.length}`}
              className="flex h-9 items-center gap-1.5 rounded-xl px-2 hover:bg-zinc-100"
            >
              <div className="flex -space-x-2">
                {users.slice(0, 4).map((u) => (
                  <span
                    key={u.id}
                    title={u.name}
                    className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white shadow-sm"
                    style={{ backgroundColor: u.color }}
                  >
                    {u.name.slice(0, 1).toUpperCase()}
                  </span>
                ))}
                {users.length > 4 && (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-zinc-400 text-[10px] font-bold text-white shadow-sm">
                    +{users.length - 4}
                  </span>
                )}
                {users.length === 0 && (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-zinc-200 text-zinc-500">
                    <Users className="h-3.5 w-3.5" />
                  </span>
                )}
              </div>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-4">
            <div className="mb-3 text-sm font-semibold">Участники ({users.length})</div>
            <div className="mb-4 max-h-40 space-y-2 overflow-y-auto">
              {users.map((u) => (
                <div key={u.id} className="flex items-center gap-2.5">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: u.color }}
                  >
                    {u.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="truncate text-sm">
                    {u.name}
                    {u.id === me.id && <span className="text-zinc-400"> (вы)</span>}
                  </span>
                </div>
              ))}
            </div>
            <div className="space-y-2 border-t pt-3">
              <div className="text-xs font-medium text-zinc-500">Ваш профиль</div>
              <Input value={myName} onChange={(e) => setMyName(e.target.value)} maxLength={24} placeholder="Ваше имя" />
              <div className="flex flex-wrap gap-1.5">
                {USER_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Цвет ${c}`}
                    onClick={() => updateMe(myName.trim() || me.name, c)}
                    className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 ${
                      me.color === c ? 'border-zinc-900 ring-2 ring-zinc-900 ring-offset-1' : 'border-zinc-200'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <Button
                size="sm"
                className="w-full"
                onClick={() => {
                  const name = myName.trim()
                  if (name) updateMe(name, me.color)
                  toast({ title: 'Профиль обновлён' })
                }}
              >
                Сохранить
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <Button
          onClick={share}
          className="h-9 rounded-xl bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-700"
        >
          <Link2 className="h-4 w-4" />
          <span className="hidden sm:inline">Пригласить</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Меню"
              className="h-9 w-9 rounded-xl text-zinc-600 hover:bg-zinc-100"
            >
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={onExport}>
              <Download className="h-4 w-4" /> Экспорт в PNG
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-red-600 focus:text-red-600">
                  <Trash2 className="h-4 w-4" /> Очистить доску
                </DropdownMenuItem>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Очистить доску?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Все элементы будут удалены для всех участников. Это действие можно отменить кнопкой «Отменить».
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onClear}
                    className="bg-red-600 text-white hover:bg-red-700"
                  >
                    Очистить
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
