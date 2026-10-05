import { useEffect, useState } from 'react'
import type { SyncState } from '../../../api/preferencesSyncEngine'
import { isSyncEnabled } from '../../../api/preferencesSync'
import { readAccount } from '../../../api/aiagent'

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
