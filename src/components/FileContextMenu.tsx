// ============================================
// FileContextMenu — 文件树节点右键 / 长按菜单
// ============================================
//
// 集中承载文件级操作：下载（仅文件）、在系统文件管理器中显示（仅本机桌面）、
// 复制相对路径、复制绝对路径。桌面端由右键触发，移动端由长按触发。
//
// 与预览区工具栏的下载按钮同源（downloadFileContent），但入口下沉到文件树，
// 不必先打开预览即可下载。触摸端没有 hover，长按是这些操作的唯一入口。

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContextMenu, ContextMenuItem } from './ui'
import { DownloadIcon, CopyIcon, FileIcon, ExternalLinkIcon } from './Icons'
import { copyTextToClipboard } from '../utils/clipboard'
import { uiErrorHandler } from '../utils/errorHandling'

export interface FileContextMenuTarget {
  /** 相对路径（服务器视角） */
  path: string
  /** 绝对路径（本机视角）；无法解析时为空 */
  absolute?: string
  name: string
  isDirectory: boolean
}

export interface FileContextMenuState extends FileContextMenuTarget {
  x: number
  y: number
}

interface FileContextMenuProps {
  state: FileContextMenuState
  onClose: () => void
  /** 下载文件（仅文件节点）；由父级负责读取内容与触发保存 */
  onDownload?: () => Promise<void>
  /** 在系统文件管理器中显示（仅本机桌面可用时传入） */
  onReveal?: () => void
  /** 平台相关的「在资源管理器中显示」文案 */
  revealLabel?: string
}

export function FileContextMenu({ state, onClose, onDownload, onReveal, revealLabel }: FileContextMenuProps) {
  const { t } = useTranslation(['components', 'common'])
  const [busy, setBusy] = useState(false)
  const { path, absolute, isDirectory } = state

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    onClose()
    try {
      await action()
    } catch (e) {
      uiErrorHandler('file context action', e)
    } finally {
      setBusy(false)
    }
  }

  const handleDownload = () => {
    if (!onDownload) return
    void run(onDownload)
  }

  const handleReveal = () => {
    onClose()
    onReveal?.()
  }

  const handleCopyRelative = () => {
    onClose()
    void copyTextToClipboard(path).catch(() => {})
  }

  const handleCopyAbsolute = () => {
    if (!absolute) return
    onClose()
    void copyTextToClipboard(absolute).catch(() => {})
  }

  return (
    <ContextMenu position={{ x: state.x, y: state.y }} onClose={onClose} aria-label={t('common:more', { defaultValue: 'More' })}>
      {onDownload && !isDirectory && (
        <ContextMenuItem icon={<DownloadIcon size={14} />} onClick={handleDownload} disabled={busy}>
          {t('common:download', { defaultValue: '下载' })}
        </ContextMenuItem>
      )}
      {onReveal && (
        <ContextMenuItem icon={<ExternalLinkIcon size={14} />} onClick={handleReveal} disabled={busy}>
          {revealLabel ?? t('fileExplorer.revealInExplorer', { defaultValue: '在资源管理器中显示' })}
        </ContextMenuItem>
      )}
      <ContextMenuItem icon={<FileIcon size={14} />} onClick={handleCopyRelative} disabled={busy}>
        {t('fileExplorer.copyRelativePath', { defaultValue: '复制相对路径' })}
      </ContextMenuItem>
      {absolute && (
        <ContextMenuItem icon={<CopyIcon size={14} />} onClick={handleCopyAbsolute} disabled={busy}>
          {t('fileExplorer.copyAbsolutePath', { defaultValue: '复制绝对路径' })}
        </ContextMenuItem>
      )}
    </ContextMenu>
  )
}
