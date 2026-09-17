// ============================================
// useServerStore - Server Store React Hook
// ============================================

import { useSyncExternalStore, useCallback } from 'react'
import { serverStore, type ServerConfig, type ServerHealth } from '../store/serverStore'
export type { ServerConfig, ServerHealth }

/**
 * 订阅 serverStore 的 React hook
 */
export function useServerStore() {
  const servers = useSyncExternalStore(
    serverStore.subscribe.bind(serverStore),
    () => serverStore.getServers(),
    () => serverStore.getServers(),
  )

  const activeServer = useSyncExternalStore(
    serverStore.subscribe.bind(serverStore),
    () => serverStore.getActiveServer(),
    () => serverStore.getActiveServer(),
  )

  const healthMap = useSyncExternalStore(
    serverStore.subscribe.bind(serverStore),
    () => serverStore.getAllHealth(),
    () => serverStore.getAllHealth(),
  )

  const addServer = useCallback((config: Omit<ServerConfig, 'id'>) => {
    return serverStore.addServer(config)
  }, [])

  const updateServer = useCallback((id: string, updates: Partial<Omit<ServerConfig, 'id'>>) => {
    return serverStore.updateServer(id, updates)
  }, [])

  const removeServer = useCallback((id: string) => {
    return serverStore.removeServer(id)
  }, [])

  const setActiveServer = useCallback((id: string) => {
    return serverStore.setActiveServer(id)
  }, [])

  /** 启用/停用服务器；停用当前活动服务器时由 store 负责自动切换 */
  const setServerEnabled = useCallback((id: string, enabled: boolean) => {
    return serverStore.setServerEnabled(id, enabled)
  }, [])

  const checkHealth = useCallback((serverId: string) => {
    return serverStore.checkHealth(serverId)
  }, [])

  const checkAllHealth = useCallback(() => {
    return serverStore.checkAllHealth()
  }, [])

  const getHealth = useCallback(
    (serverId: string): ServerHealth | null => {
      return healthMap.get(serverId) ?? null
    },
    [healthMap],
  )

  return {
    servers,
    activeServer,
    healthMap,
    addServer,
    updateServer,
    removeServer,
    setActiveServer,
    setServerEnabled,
    checkHealth,
    checkAllHealth,
    getHealth,
  }
}
