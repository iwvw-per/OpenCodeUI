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
import { AlertCircleIcon } from '../../../components/Icons'
import { PixelGrid, Spinner } from '../../../components/ui/Spinner'
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

/** 账号与开关状态：未登录或未启用时不展示。 */
export function useSyncIndicatorAvailable(): boolean {
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

/**
 * 图标本体：同步中用闪烁小方格，已同步用「全亮小方格」，失败用红色叹号。
 *
 * 成功态刻意复用同步中的九宫格几何（而非对号），让两个状态读起来是同一图标的
 * 两个阶段：格子从逐个点亮变为全部点亮，表示同步走完。
 */
function SyncStatusIconGlyph({ kind }: { kind: SyncIndicatorKind }) {
  if (kind === 'syncing') return <Spinner size="sm" tone="accent" variant="pixel" />
  if (kind === 'error') {
    return (
      <span className="flex size-4 items-center justify-center rounded-full bg-danger-100/15 text-danger-100">
        <AlertCircleIcon size={11} />
      </span>
    )
  }
  return (
    <span className="flex size-4 items-center justify-center text-success-100" aria-hidden="true">
      <PixelGrid cell={3} animated={false} />
    </span>
  )
}

/**
 * 同步状态图标（仅图标，悬停显示详情）。
 *
 * 挂在主机快速切换行右侧：同步是「多端之间」的状态，与主机选择同属一行更自然，
 * 也避免单独占一行。未登录或未启用同步时不渲染。
 */
export function SyncStatusIcon() {
  const state = useSyncState()
  const available = useSyncIndicatorAvailable()
  if (!available) return null

  const view = syncStatusView(state)
  return (
    <span
      className={cn(
        'flex size-5 items-center justify-center rounded-full',
        view.kind === 'syncing' ? 'text-accent-main-100' : undefined,
      )}
      title={view.title}
      aria-label={view.label}
      role="status"
    >
      <SyncStatusIconGlyph kind={view.kind} />
    </span>
  )
}

export default SyncStatusIcon
