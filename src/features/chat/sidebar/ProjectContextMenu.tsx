// ============================================
// ProjectContextMenu — 项目行右键 / 长按菜单
// ============================================
//
// 集中承载项目级操作：新建对话、打开项目目录、复制路径、移除项目。
// 桌面端由右键触发，移动端由长按触发（位置取触点坐标）。
//
// 与 hover 揭示的图标按钮同一套能力，但触摸端没有 hover，长按是唯一的
// 操作入口；同时把「打开目录」「移除」这类低频且有破坏性的操作从行内挪走，
// 避免误触。移除仍保留二次确认（见 FolderRecentList 的 removeArmed 逻辑）。

import { useTranslation } from 'react-i18next'
import { ContextMenu, ContextMenuItem } from '../../../components/ui'
import { PlusIcon, ExternalLinkIcon, CopyIcon, TrashIcon } from '../../../components/Icons'
import { copyTextToClipboard } from '../../../utils/clipboard'

interface ProjectContextMenuProps {
  position: { x: number; y: number }
  onClose: () => void
  /** 项目目录；缺省（无目录的项目）时不显示依赖路径的项 */
  directory?: string
  /** 在该项目目录下新建会话 */
  onNewSession?: () => void
  /** 打开项目目录（仅桌面端可用时传入） */
  onOpenDirectory?: () => void
  /** 从侧栏移除项目 */
  onRemove?: () => void
}

export function ProjectContextMenu({
  position,
  onClose,
  directory,
  onNewSession,
  onOpenDirectory,
  onRemove,
}: ProjectContextMenuProps) {
  const { t } = useTranslation(['chat', 'common'])

  const handleNewSession = () => {
    onClose()
    onNewSession?.()
  }

  const handleOpenDirectory = () => {
    onClose()
    onOpenDirectory?.()
  }

  const handleCopyPath = () => {
    onClose()
    if (directory) void copyTextToClipboard(directory).catch(() => {})
  }

  const handleRemove = () => {
    onClose()
    onRemove?.()
  }

  const hasDirectory = !!directory

  return (
    <ContextMenu position={position} onClose={onClose} aria-label={t('common:more', { defaultValue: 'More' })}>
      {onNewSession && hasDirectory && (
        <ContextMenuItem icon={<PlusIcon size={14} />} onClick={handleNewSession}>
          {t('sidebar.newTaskInDirectory', { defaultValue: '在此新建对话' })}
        </ContextMenuItem>
      )}
      {onOpenDirectory && hasDirectory && (
        <ContextMenuItem icon={<ExternalLinkIcon size={14} />} onClick={handleOpenDirectory}>
          {t('header.openProjectDirectory', { defaultValue: '打开项目目录' })}
        </ContextMenuItem>
      )}
      {hasDirectory && (
        <ContextMenuItem icon={<CopyIcon size={14} />} onClick={handleCopyPath}>
          {t('sidebar.copyProjectPath', { defaultValue: '复制路径' })}
        </ContextMenuItem>
      )}
      {onRemove && hasDirectory && (
        <ContextMenuItem icon={<TrashIcon size={14} />} tone="danger" onClick={handleRemove}>
          {t('sidebar.removeProject', { defaultValue: '移除项目' })}
        </ContextMenuItem>
      )}
    </ContextMenu>
  )
}
