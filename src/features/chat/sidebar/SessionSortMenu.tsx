// ============================================
// SessionSortMenu — 侧栏会话排序菜单
// ============================================
//
// 只负责"排序字段 + 方向"两个偏好，与管理按钮（批量选择/删除）分开。
// 偏好存 layoutStore（localStorage 持久化），排序在 useSessions 拉取时应用。

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClockIcon, CalendarPlusIcon, SortIcon, SortDescIcon, CheckIcon } from '../../../components/Icons'
import { DropdownMenu, IconButton } from '../../../components/ui'
import { useLayoutStore, layoutStore } from '../../../store'
import type { SessionSortField } from '../../../utils'

export function SessionSortMenu() {
  const { t } = useTranslation('chat')
  const { sidebarSessionSortField, sidebarSessionSortDesc } = useLayoutStore()
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const apply = (field: SessionSortField, desc: boolean) => {
    layoutStore.setSidebarSessionSort(field, desc)
    setIsOpen(false)
  }

  // 点击外部关闭（DropdownMenu 是 portal，菜单节点在 trigger 之外，需要单独判断）
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // ESC 关闭
  useEffect(() => {
    if (!isOpen) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [isOpen])

  const fields: Array<{ field: SessionSortField; label: string; icon: React.ReactNode }> = [
    { field: 'updated', label: t('sidebar.sortByUpdated', { defaultValue: '更新时间' }), icon: <ClockIcon size={14} /> },
    {
      field: 'created',
      label: t('sidebar.sortByCreated', { defaultValue: '创建时间' }),
      icon: <CalendarPlusIcon size={14} />,
    },
  ]

  return (
    <>
      <IconButton
        ref={triggerRef}
        size="sm"
        onMouseDown={e => e.preventDefault()}
        onClick={() => setIsOpen(open => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={t('sidebar.sortSessions', { defaultValue: '排序' })}
        className={isOpen ? 'bg-bg-200 text-text-100' : undefined}
        title={t('sidebar.sortSessions', { defaultValue: '排序' })}
      >
        {sidebarSessionSortDesc ? <SortDescIcon size={14} /> : <SortIcon size={14} />}
      </IconButton>

      <DropdownMenu
        triggerRef={triggerRef}
        isOpen={isOpen}
        position="bottom"
        align="right"
        minWidth="180px"
        maxWidth="min(240px, calc(100vw - 24px))"
      >
        <div ref={menuRef} role="menu" aria-label={t('sidebar.sortSessions', { defaultValue: '排序' })} className="p-1">
          <div className="px-2 pt-1 pb-1.5 text-[length:var(--fs-xxs)] font-semibold uppercase tracking-wider text-text-400/60 select-none">
            {t('sidebar.sortBy', { defaultValue: '排序方式' })}
          </div>
          {/* 条目之间留 2px：item 是 rounded-lg + hover 底色，紧贴时相邻圆角会拼成一条凹槽。
             不用容器 gap，避免把分组标题和分隔线的间距也一起撑开。 */}
          <div className="flex flex-col gap-0.5">
            {fields.map(({ field, label, icon }) => (
              <button
                key={field}
                type="button"
                role="menuitemradio"
                aria-checked={sidebarSessionSortField === field}
                onClick={() => apply(field, sidebarSessionSortDesc)}
                className={`w-full px-2 py-2 rounded-lg flex items-center gap-2 text-left bg-transparent border-none cursor-pointer transition-colors duration-150 hover:bg-bg-200 ${
                  sidebarSessionSortField === field ? 'text-text-100' : 'text-text-300'
                }`}
              >
                <span className="w-4 h-4 flex items-center justify-center shrink-0 text-text-400">{icon}</span>
                <span className="flex-1 min-w-0 truncate text-[length:var(--fs-sm)]">{label}</span>
                {sidebarSessionSortField === field && (
                  <span className="w-4 flex items-center justify-center shrink-0 text-accent-main-100">
                    <CheckIcon size={14} />
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="mx-1 my-1 h-px bg-border-200/50" />

          <div className="px-2 pt-1 pb-1.5 text-[length:var(--fs-xxs)] font-semibold uppercase tracking-wider text-text-400/60 select-none">
            {t('sidebar.sortDirection', { defaultValue: '方向' })}
          </div>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={sidebarSessionSortDesc}
            onClick={() => apply(sidebarSessionSortField, true)}
            className={`w-full px-2 py-2 rounded-lg flex items-center gap-2 text-left bg-transparent border-none cursor-pointer transition-colors duration-150 hover:bg-bg-200 ${
              sidebarSessionSortDesc ? 'text-text-100' : 'text-text-300'
            }`}
          >
            <span className="w-4 h-4 flex items-center justify-center shrink-0 text-text-400">
              <SortDescIcon size={14} />
            </span>
            <span className="flex-1 min-w-0 truncate text-[length:var(--fs-sm)]">
              {t('sidebar.sortDesc', { defaultValue: '倒序（新 → 旧）' })}
            </span>
            {sidebarSessionSortDesc && (
              <span className="w-4 flex items-center justify-center shrink-0 text-accent-main-100">
                <CheckIcon size={14} />
              </span>
            )}
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!sidebarSessionSortDesc}
            onClick={() => apply(sidebarSessionSortField, false)}
            className={`w-full px-2 py-2 rounded-lg flex items-center gap-2 text-left bg-transparent border-none cursor-pointer transition-colors duration-150 hover:bg-bg-200 ${
              !sidebarSessionSortDesc ? 'text-text-100' : 'text-text-300'
            }`}
          >
            <span className="w-4 h-4 flex items-center justify-center shrink-0 text-text-400">
              <SortIcon size={14} />
            </span>
            <span className="flex-1 min-w-0 truncate text-[length:var(--fs-sm)]">
              {t('sidebar.sortAsc', { defaultValue: '正序（旧 → 新）' })}
            </span>
            {!sidebarSessionSortDesc && (
              <span className="w-4 flex items-center justify-center shrink-0 text-accent-main-100">
                <CheckIcon size={14} />
              </span>
            )}
          </button>
        </div>
      </DropdownMenu>
    </>
  )
}
