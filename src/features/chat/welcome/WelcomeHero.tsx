import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon, CheckIcon, CloseIcon, FolderIcon, GlobeIcon, PlusIcon, SearchIcon } from '../../../components/Icons'
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui'
import { useDelayedRender } from '../../../hooks'
import { useDirectory } from '../../../contexts/useDirectory'
import type { SavedDirectory } from '../../../contexts/DirectoryContext.shared'
import { getDirectoryName, isSameDirectory } from '../../../utils/directoryUtils'
import { cn } from '../../../utils/cn'
import { interactive } from '../../../utils/interaction'
import { greetingSlotForHour, pickGreeting } from './welcomeGreetings'

interface WelcomeHeroProps {
  active: boolean
  /** 切换主机等场景下临时关闭自身过渡，避免与工作区平移动画打架 */
  disableTransition?: boolean
}

// 退场动画 300ms，延迟卸载多留 60ms 余量，避免淡出未完成就被移除。
const EXIT_DURATION_MS = 360

/**
 * 欢迎问候语：绝对定位在输入框上方，随输入框容器一起移动。
 * 项目角标不在这里——它作为 InputBox 的 topAccessory 与输入框同一 DOM 子树渲染，
 * 保证两者视觉上是一个整体、层级也一致。
 */
export function WelcomeHero({ active, disableTransition = false }: WelcomeHeroProps) {
  const { t } = useTranslation('chat')
  const shouldRender = useDelayedRender(active, EXIT_DURATION_MS)

  const slot = greetingSlotForHour(new Date().getHours())
  const greeting = useMemo(() => {
    const raw = t(`emptyState.greetings.${slot}`, { returnObjects: true })
    return pickGreeting(Array.isArray(raw) ? (raw as string[]) : [])
    // t 的标识随语言切换而变化，足以驱动重新抽取问候语
  }, [t, slot])

  if (!shouldRender) return null

  return (
    <div
      data-welcome-layer
      className={`absolute bottom-full left-0 right-0 z-40 pb-10 pointer-events-none ${
        disableTransition ? '' : 'transition-[opacity,transform] duration-300 ease-out'
      }`}
      style={{
        opacity: active ? 1 : 0,
        transform: active ? 'translateY(0)' : 'translateY(-20px)',
      }}
      aria-hidden={!active}
    >
      <h1
        className="px-4 text-center text-[26px] font-semibold leading-snug text-balance bg-gradient-to-r from-text-100 to-accent-main-100 bg-clip-text text-transparent sm:text-[32px]"
        style={{ filter: 'drop-shadow(0 0 22px hsl(var(--accent-main-100) / 0.18))' }}
      >
        {greeting}
      </h1>
    </div>
  )
}

interface WelcomeProjectPillProps {
  active: boolean
  directory: string
  onSelectProject: (path: string) => void
  onClearProject: () => void
  onAddProject: () => void
}

const PILL_EXIT_MS = 200

/**
 * 项目选择角标：挂在输入框顶边（由调用方定位），与输入框同一个渲染子树。
 * active 翻 false 后延迟卸载，做淡出收尾。
 */
export function WelcomeProjectPill({
  active,
  directory,
  onSelectProject,
  onClearProject,
  onAddProject,
}: WelcomeProjectPillProps) {
  const { t } = useTranslation('chat')
  const { savedDirectories } = useDirectory()
  const shouldRender = useDelayedRender(active, PILL_EXIT_MS)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  // 退场时强制收起弹窗，无需 effect：open 直接与 active 相与。
  const effectiveOpen = open && active

  const current = useMemo(() => {
    if (!directory) return null
    return savedDirectories.find(project => isSameDirectory(project.path, directory)) ?? null
  }, [directory, savedDirectories])

  const displayName = current?.name || (directory ? getDirectoryName(directory) : '') || t('emptyState.noProject')

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return savedDirectories
    return savedDirectories.filter(project => {
      const name = project.name || getDirectoryName(project.path)
      return name.toLowerCase().includes(keyword)
    })
  }, [savedDirectories, query])

  if (!shouldRender) return null

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  return (
    <Popover open={effectiveOpen} onOpenChange={next => (next ? setOpen(true) : close())}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-expanded={effectiveOpen}
          aria-label={t('emptyState.switchProject')}
          className={cn(
            'pointer-events-auto inline-flex max-w-full items-center gap-1.5 rounded-full border border-border-200 bg-bg-100 px-2.5 py-1 text-[length:var(--fs-xs)] text-text-300 shadow-sm transition-opacity duration-200 hover:border-accent-main-100/50 hover:text-text-100',
            interactive.focusRingCompact,
            !active && 'opacity-0 pointer-events-none',
          )}
        >
          <FolderIcon className="size-3 shrink-0" />
          <span className="max-w-[180px] truncate">{displayName}</span>
          <ChevronDownIcon className={cn('size-3 shrink-0 opacity-70 transition-transform', effectiveOpen && 'rotate-180')} />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" side="top" className="w-64 p-0">
        <div className="flex items-center gap-2 border-b border-border-200 px-2.5 py-1.5">
          <SearchIcon className="size-3.5 shrink-0 text-text-400" />
          <input
            autoFocus
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t('emptyState.searchProjects')}
            className="min-w-0 flex-1 bg-transparent text-[length:var(--fs-sm)] text-text-200 outline-none placeholder:text-text-400"
          />
          {query && (
            <button
              type="button"
              aria-label={t('sidebar.clearSearch')}
              onClick={() => setQuery('')}
              className={cn('shrink-0 text-text-400 hover:text-text-100', interactive.focusRingCompact)}
            >
              <CloseIcon className="size-3.5" />
            </button>
          )}
        </div>

        <div className="max-h-52 overflow-y-auto custom-scrollbar p-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-5 text-center text-[length:var(--fs-sm)] text-text-400">
              {t('emptyState.noMatchingProjects')}
            </div>
          ) : (
            filtered.map((project: SavedDirectory) => {
              const isCurrent = isSameDirectory(project.path, directory)
              return (
                <button
                  key={project.path}
                  type="button"
                  onClick={() => {
                    onSelectProject(project.path)
                    close()
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left',
                    interactive.row,
                  )}
                >
                  <FolderIcon className={cn('size-3.5 shrink-0', isCurrent ? 'text-accent-main-100' : 'text-text-400')} />
                  <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] text-text-200">
                    {project.name || getDirectoryName(project.path)}
                  </span>
                  {isCurrent && <CheckIcon className="size-3.5 shrink-0 text-success-100" />}
                </button>
              )
            })
          )}
        </div>

        <div className="border-t border-border-200 p-1">
          <button
            type="button"
            onClick={() => {
              onAddProject()
              close()
            }}
            className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text-300', interactive.row)}
          >
            <PlusIcon className="size-3.5 shrink-0" />
            <span className="text-[length:var(--fs-sm)]">{t('emptyState.newProject')}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onClearProject()
              close()
            }}
            className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text-300', interactive.row)}
          >
            <GlobeIcon className="size-3.5 shrink-0" />
            <span className="text-[length:var(--fs-sm)]">{t('emptyState.workOutsideProject')}</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
