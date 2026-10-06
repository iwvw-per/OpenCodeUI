// ============================================
// OpenDirectoryButton - 「打开项目目录」拆分按钮
// ============================================
//
// 主按钮用上次选定的方式打开；右侧 chevron 展开菜单切换方式：
// 文件资源管理器 / VS Code / 终端。选择持久化在 localStorage（本机专属，
// 不参与跨端同步——不同机器装的工具不同）。
//
// 只有「本机真实存在的目录」才有这些本机能力：远程主机上的目录在本机不存在，
// 此时整个按钮退化为「打开应用内文件树」（onOpenInApp），不显示下拉。

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon, FolderIcon, FileManagerIcon, VscodeIcon, TerminalAppIcon } from '../../components/Icons'
import { DropdownMenu, IconButton, MenuItem } from '../../components/ui'
import { cn } from '../../utils/cn'
import { interactive } from '../../utils/interaction'
import { canOpenDirectoryNatively, openDirectoryWith, type OpenDirectoryTarget } from '../../utils/nativeFileIntegration'

const STORAGE_KEY = 'opencode-open-directory-target'

/** 每种打开方式对应的应用图标（菜单项与主按钮共用，保证二者一致）。 */
function targetIcon(target: OpenDirectoryTarget, size: number): React.ReactNode {
  switch (target) {
    case 'vscode':
      return <VscodeIcon size={size} />
    case 'terminal':
      return <TerminalAppIcon size={size} />
    default:
      return <FileManagerIcon size={size} />
  }
}

/** 上次选定的打开方式；非法/缺失时回退到资源管理器。 */
function readTarget(): OpenDirectoryTarget {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'vscode' || raw === 'terminal' || raw === 'file_manager') return raw
  } catch {
    // ignore
  }
  return 'file_manager'
}

function writeTarget(target: OpenDirectoryTarget): void {
  try {
    localStorage.setItem(STORAGE_KEY, target)
  } catch {
    // ignore
  }
}

interface OpenDirectoryButtonProps {
  directory: string
  serverId: string
  /** 非本机目录（远程主机）时改为打开应用内文件树 */
  onOpenInApp: () => void
  className?: string
}

export function OpenDirectoryButton({ directory, serverId, onOpenInApp, className }: OpenDirectoryButtonProps) {
  const { t } = useTranslation('chat')
  const [target, setTarget] = useState<OpenDirectoryTarget>(() => readTarget())
  // null = 尚未探测；仅在此为 true 时显示下拉（本机目录才有其它打开方式）。
  const [nativelyOpenable, setNativelyOpenable] = useState<boolean | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setNativelyOpenable(null)
    void canOpenDirectoryNatively(serverId, directory).then(ok => {
      if (!cancelled) setNativelyOpenable(ok)
    })
    return () => {
      cancelled = true
    }
  }, [serverId, directory])

  // 点击外部 / ESC 关闭菜单。DropdownMenu 是 portal 渲染到 body，不在本组件
  // 子树内，因此需同时排除触发按钮与菜单节点本身。
  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [menuOpen])

  const open = useCallback(
    async (next: OpenDirectoryTarget) => {
      try {
        await openDirectoryWith(directory, next)
      } catch (error) {
        const { notificationStore } = await import('../../store')
        const message = error instanceof Error ? error.message : String(error)
        notificationStore.push('error', t('header.openProjectDirectory'), message, '')
      }
    },
    [directory, t],
  )

  const handlePrimary = useCallback(async () => {
    if (!directory) return
    const native = nativelyOpenable ?? (await canOpenDirectoryNatively(serverId, directory))
    if (!native) {
      onOpenInApp()
      return
    }
    await open(target)
  }, [directory, serverId, nativelyOpenable, onOpenInApp, open, target])

  const handleSelect = useCallback(
    (next: OpenDirectoryTarget) => {
      setTarget(next)
      writeTarget(next)
      setMenuOpen(false)
      void open(next)
    },
    [open],
  )

  const options: Array<{ target: OpenDirectoryTarget; label: string }> = [
    { target: 'file_manager', label: t('header.openInFileManager') },
    { target: 'vscode', label: t('header.openInVscode') },
    { target: 'terminal', label: t('header.openInTerminal') },
  ]

  const showDropdown = nativelyOpenable === true

  return (
    <div
      className={cn(
        'inline-flex h-8 shrink-0 items-center overflow-hidden rounded-md border border-transparent',
        showDropdown && 'border-border-200/70',
        className,
      )}
    >
      <IconButton
        size="md"
        aria-label={t('header.openProjectDirectory')}
        title={t('header.openProjectDirectory')}
        onClick={() => void handlePrimary()}
        className={cn(
          'rounded-none text-text-300 hover:text-text-100',
          showDropdown ? 'border-r border-border-200/70' : 'border border-transparent',
          interactive.subtle,
        )}
      >
        {/* 主按钮图标跟随选定的默认打开方式：资源管理器 / VS Code / 终端。
            本机不可用时退化为应用内文件树，用 FolderIcon。 */}
        {nativelyOpenable === false ? <FolderIcon size={16} /> : targetIcon(target, 16)}
      </IconButton>

      {showDropdown && (
        <>
          <IconButton
            ref={triggerRef}
            size="md"
            aria-label={t('header.chooseOpenMethod')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={t('header.chooseOpenMethod')}
            onClick={() => setMenuOpen(openState => !openState)}
            className={cn('rounded-none text-text-300 hover:text-text-100', interactive.subtle)}
          >
            {/* 箭头随开合旋转 180°，与全站浮层开合动效一致 */}
            <ChevronDownIcon
              size={14}
              className={cn('transition-transform duration-200', menuOpen && 'rotate-180')}
            />
          </IconButton>
          <DropdownMenu
            triggerRef={triggerRef}
            menuRef={menuRef}
            isOpen={menuOpen}
            position="bottom"
            align="right"
            minWidth="180px"
          >
            <div role="menu" aria-label={t('header.openProjectDirectory')} className="p-1">
              {options.map(({ target: optionTarget, label }) => (
                <MenuItem
                  key={optionTarget}
                  icon={targetIcon(optionTarget, 16)}
                  label={label}
                  selected={target === optionTarget}
                  selectionRole="menuitemradio"
                  onClick={() => handleSelect(optionTarget)}
                />
              ))}
            </div>
          </DropdownMenu>
        </>
      )}
    </div>
  )
}
