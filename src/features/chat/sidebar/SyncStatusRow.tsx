// ============================================
// SyncStatusRow - 侧栏底部的偏好同步状态行
//
// 常驻显示多端同步的实时状态，位置在主机快速切换条上方：
//   - 同步中：动态小方格加载图标（与全站 Spinner 的 pixel 变体同款）
//   - 已同步：绿色圆形对号
//   - 失败：红色圆形叹号，悬停显示原因
//   - 未启用/未登录：不显示（避免占据无意义的一行）
//
// 状态来源是 preferencesSyncEngine 的内存状态，通过 subscribeSyncState 订阅，
// 因此每次同步开始/结束都会立即重渲染，不需要轮询。
// ============================================

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckIcon, AlertCircleIcon } from '../../../components/Icons'
import { Spinner } from '../../../components/ui/Spinner'
import { getSyncState, subscribeSyncState, type SyncState } from '../../../api/preferencesSyncEngine'
import { isSyncEnabled } from '../../../api/preferencesSync'
import { readAccount } from '../../../api/aiagent'
import { cn } from '../../../utils/cn'

/** 已同步状态短暂展示后回到静态文案，避免「刚刚」一直停留造成误解。 */
export function formatSyncedAt(timestamp: number, now = Date.now()): string {
  if (!timestamp) return ''
  const diff = now - timestamp
  if (diff < 60_000) return '刚刚'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return new Date(timestamp).toLocaleDateString()
}

export type SyncIndicatorKind = 'syncing' | 'error' | 'synced'

export interface SyncStatusView {
  kind: SyncIndicatorKind
  /** 展示文案（已含相对时间，如「已同步 · 刚刚」）。 */
  label: string
  /** 悬停提示：失败时附上原因，便于排查而不必打开设置页。 */
  title: string
}

/**
 * 把引擎状态映射成展示模型。抽成纯函数便于覆盖全部状态分支：
 * 组件本身依赖 useSyncExternalStore 订阅，状态难以在测试里直接驱动。
 */
export function syncStatusView(state: SyncState, now = Date.now()): SyncStatusView {
  switch (state.status) {
    case 'syncing':
      return { kind: 'syncing', label: '正在同步…', title: '正在同步…' }
    case 'error': {
      const reason = state.error || '未知错误'
      return { kind: 'error', label: '同步失败', title: `同步失败: ${reason}` }
    }
    case 'disabled':
      return { kind: 'synced', label: '未启用', title: '未启用同步' }
    default: {
      const at = formatSyncedAt(state.lastSyncedAt, now)
      return at
        ? { kind: 'synced', label: `已同步 · ${at}`, title: `已同步 · ${at}` }
        : { kind: 'synced', label: '待同步', title: '待同步' }
    }
  }
}

/** 订阅同步引擎状态（useSyncExternalStore 保证并发渲染下一致）。 */
function useSyncState(): SyncState {
  return useSyncExternalStore(subscribeSyncState, getSyncState, getSyncState)
}

/** 账号与开关状态：未登录或未启用时不展示该行。 */
function useSyncAvailable(): boolean {
  const [available, setAvailable] = useState(() => isSyncEnabled() && !!readAccount())
  useEffect(() => {
    // 登录/登出会改变可用性；低频轮询即可，无需事件通道。
    const timer = setInterval(() => {
      const next = isSyncEnabled() && !!readAccount()
      setAvailable((prev: boolean) => (prev === next ? prev : next))
    }, 5_000)
    return () => clearInterval(timer)
  }, [])
  return available
}

export interface SyncStatusRowProps {
  /** 收起侧栏时隐藏文案，仅保留图标。 */
  showLabels: boolean
}

export function SyncStatusRow({ showLabels }: SyncStatusRowProps) {
  const { t } = useTranslation(['chat', 'common'])
  const state = useSyncState()
  const available = useSyncAvailable()

  if (!available) return null

  const view = syncStatusView(state)
  const syncing = view.kind === 'syncing'
  const failed = view.kind === 'error'
  const label = t(`sidebar.sync_${view.kind}`, { defaultValue: view.label })

  return (
    <div className="shrink-0 px-2 pt-1.5">
      <div
        className={cn('h-7 flex items-center rounded-lg', showLabels ? 'px-1.5' : 'justify-center')}
        title={view.title}
      >
        {/* 图标：同步中用动态小方格，成功用绿色对号，失败用红色叹号 */}
        <span className="size-5 flex items-center justify-center shrink-0">
          {syncing ? (
            <Spinner size="sm" tone="accent" variant="pixel" />
          ) : failed ? (
            <span className="flex size-4 items-center justify-center rounded-full bg-danger-100/15 text-danger-100">
              <AlertCircleIcon size={11} />
            </span>
          ) : (
            <span className="flex size-4 items-center justify-center rounded-full bg-success-100/15 text-success-100">
              <CheckIcon size={11} />
            </span>
          )}
        </span>

        <span
          className={cn(
            'ml-2 flex-1 truncate text-[length:var(--fs-sm)] transition-opacity duration-300',
            syncing ? 'text-accent-main-100' : failed ? 'text-danger-100' : 'text-text-400',
          )}
          style={{ opacity: showLabels ? 1 : 0 }}
        >
          {label}
        </span>
      </div>
    </div>
  )
}

export default SyncStatusRow
