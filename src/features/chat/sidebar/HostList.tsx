// ============================================
// HostList - 侧栏「主机」tab：主机切换器
//
// 列出所有已配置服务器，点击行切换活动主机（setActiveServer）。
// 每行：连接状态点 + 名称（含版本）+ 地址；底部「服务器设置」入口。
// 只负责切换主机，不展示会话/项目（会话与项目统一看「项目」tab）。
// ============================================

import { memo, useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useServerStore } from '../../../hooks/useServerStore'
import { subscribeToServerConnectionState, getServerConnectionInfo, type ConnectionInfo } from '../../../api/events'
import { CogIcon } from '../../../components/Icons'
import { cn } from '../../../utils/cn'
import { interactive } from '../../../utils/interaction'

function useServerConnectionState(serverId: string): ConnectionInfo {
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      serverId ? subscribeToServerConnectionState(serverId, onStoreChange) : () => {},
    [serverId],
  )
  const getSnapshot = useCallback(() => getServerConnectionInfo(serverId), [serverId])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function statusDotClass(state: ConnectionInfo['state']): string {
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

const HostRow = memo(function HostRow({
  serverId,
  name,
  url,
  version,
  isActive,
  onSelect,
}: {
  serverId: string
  name: string
  url: string
  version?: string
  isActive: boolean
  onSelect: (serverId: string) => void
}) {
  const connectionState = useServerConnectionState(serverId)
  return (
    <button
      type="button"
      onClick={() => onSelect(serverId)}
      className={cn(
        'group flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left',
        interactive.row,
        isActive && interactive.rowSelected,
      )}
      title={url}
    >
      <span className="relative size-5 shrink-0 flex items-center justify-center">
        <span className={`h-2 w-2 rounded-full ${statusDotClass(connectionState.state)}`} />
        {connectionState.state === 'connected' && (
          <span
            className={`absolute h-2 w-2 rounded-full ${statusDotClass(connectionState.state)} animate-ping opacity-50`}
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[length:var(--fs-sm)] font-medium ${
            isActive ? 'text-text-100' : 'text-text-300'
          }`}
        >
          {name}
          {version ? ` · v${version}` : ''}
        </span>
        <span className="block truncate text-[length:var(--fs-xxs)] text-text-500">{url}</span>
      </span>
    </button>
  )
})

export function HostList({
  onActivate,
  onOpenSettings,
}: {
  /** 切换主机成功后回调（侧栏切到「项目」tab） */
  onActivate?: (serverId: string) => void
  onOpenSettings?: () => void
}) {
  const { t } = useTranslation(['chat', 'common'])
  const { servers, activeServer, getHealth, setActiveServer } = useServerStore()
  const activeId = activeServer?.id ?? null
  // 停用的主机不出现在侧栏：开关语义是「这台主机要不要用」，
  // 停用后不建连接也不该出现在切换列表里（配置仍保留在设置页）。
  const visibleServers = servers.filter(server => server.enabled !== false)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-1.5 py-1 space-y-0.5">
        {visibleServers.map(server => {
          const health = getHealth(server.id)
          return (
            <HostRow
              key={server.id}
              serverId={server.id}
              name={server.name}
              url={server.url}
              version={health?.status === 'online' ? health.version : undefined}
              isActive={server.id === activeId}
              onSelect={id => {
                setActiveServer(id)
                onActivate?.(id)
              }}
            />
          )
        })}

        {/* 全部主机都停用时给出说明，避免只剩一个空白列表 */}
        {visibleServers.length === 0 && (
          <div className="px-2 py-6 text-center text-[length:var(--fs-xs)] text-text-400">
            {t('sidebar.noEnabledHosts', { defaultValue: 'No hosts enabled' })}
          </div>
        )}
      </div>
      <div className="shrink-0 px-2 py-1.5 border-t border-border-200/40">
        <button
          type="button"
          onClick={onOpenSettings}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[length:var(--fs-sm)] text-text-400 hover:text-text-200',
            interactive.subtle,
          )}
        >
          <CogIcon size={14} />
          <span className="truncate">{t('sidebar.openServerSettings', { defaultValue: 'Open Server Settings' })}</span>
        </button>
      </div>
    </div>
  )
}
