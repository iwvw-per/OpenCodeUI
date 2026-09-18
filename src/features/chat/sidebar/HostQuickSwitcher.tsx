// ============================================
// HostQuickSwitcher - 侧栏对话区底部的主机快速切换条
//
// 只显示已启用主机的「简称」（server.name），点击即切换活动主机。
// 比「主机」tab 更轻：常驻在对话列表下方，无需切 tab。
//
// 切换不重载所有会话：
// - messageStore 按 serverId 分片，切服（server-switch）不失效任何消息缓存
// - 会话列表有 30s TTL 缓存兜底（切回最近访问过的主机秒出）
// ============================================

import { useCallback, useSyncExternalStore } from 'react'
import { useServerStore } from '../../../hooks/useServerStore'
import { subscribeToServerConnectionState, getServerConnectionInfo, type ConnectionState } from '../../../api/events'
import { cn } from '../../../utils/cn'
import { interactive } from '../../../utils/interaction'

function useServerConnectionState(serverId: string): ConnectionState {
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeToServerConnectionState(serverId, () => onStoreChange()),
    [serverId],
  )
  const getSnapshot = useCallback(
    () => getServerConnectionInfo(serverId).state,
    [serverId],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function statusDotClass(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return 'bg-success-100'
    case 'connecting':
      return 'bg-warning-100'
    case 'error':
      return 'bg-error-100'
    default:
      return 'bg-text-500/50'
  }
}

export function HostQuickSwitcher() {
  const { servers, activeServer, setActiveServer } = useServerStore()
  const activeId = activeServer?.id ?? null
  const visibleServers = servers.filter(server => server.enabled !== false)

  const handleSelect = useCallback(
    (id: string) => {
      if (id !== activeId) setActiveServer(id)
    },
    [activeId, setActiveServer],
  )

  if (visibleServers.length <= 1) return null

  return (
    <div className="shrink-0 px-2 py-1.5 border-t border-border-200/40">
      <div className="flex flex-wrap items-center gap-1">
        {visibleServers.map(server => (
          <HostQuickHostRow
            key={server.id}
            serverId={server.id}
            name={server.name}
            isActive={server.id === activeId}
            onSelect={handleSelect}
          />
        ))}
      </div>
    </div>
  )
}

function HostQuickHostRow({
  serverId,
  name,
  isActive,
  onSelect,
}: {
  serverId: string
  name: string
  isActive: boolean
  onSelect: (id: string) => void
}) {
  const state = useServerConnectionState(serverId)
  return (
    <button
      type="button"
      onClick={() => onSelect(serverId)}
      title={name}
      className={cn(
        'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[length:var(--fs-xxs)] transition-colors',
        isActive
          ? 'bg-accent-main-100/15 text-text-100 font-medium'
          : 'text-text-400 hover:text-text-200 hover:bg-bg-200',
        interactive.focusRingCompact,
      )}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(state)}`} />
      <span className="max-w-[12ch] truncate">{name}</span>
    </button>
  )
}
