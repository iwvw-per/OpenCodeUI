// ============================================
// useArchivedSessions - 已归档会话的查看与恢复
//
// 归档会话被 getSessions 默认过滤掉，侧栏完全不展示。这里用 server 的
// archived 查询参数把归档会话单独取回（服务端语义：archived=true 表示
// "也包含归档"，客户端再收窄到 time.archived 为真），并按归档时间倒序，
// 供「已归档对话」面板展示与恢复。
// ============================================

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getArchivedSessions,
  restoreSession,
  deleteSession,
  subscribeToEvents,
  subscribeToServerEvents,
  type ApiSession,
} from '../api'
import { pinnedSessionsStore } from '../store/pinnedSessionsStore'
import { serverStore } from '../store/serverStore'

interface UseArchivedSessionsOptions {
  /** 延迟启用，用于懒加载 */
  enabled?: boolean
  /** 指定服务器（缺省用活动服务器） */
  serverId?: string
  /** 单次拉取上限 */
  limit?: number
}

interface UseArchivedSessionsResult {
  sessions: ApiSession[]
  isLoading: boolean
  error: Error | null
  refresh: () => Promise<void>
  /** 恢复会话（清除 time.archived），成功后从列表移除 */
  restore: (sessionId: string) => Promise<void>
  /** 永久删除会话，成功后从列表移除 */
  remove: (sessionId: string) => Promise<void>
}

export function useArchivedSessions(options: UseArchivedSessionsOptions = {}): UseArchivedSessionsResult {
  const { enabled = true, serverId, limit = 200 } = options

  const [sessions, setSessions] = useState<ApiSession[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const requestIdRef = useRef(0)
  const isFetchingRef = useRef(false)

  const fetchArchived = useCallback(async () => {
    if (!enabled) return
    const requestId = ++requestIdRef.current
    isFetchingRef.current = true
    setIsLoading(true)
    setError(null)
    try {
      const data = await getArchivedSessions({ roots: false, limit }, serverId)
      if (requestId !== requestIdRef.current) return
      setSessions(data)
    } catch (e) {
      if (requestId !== requestIdRef.current) return
      setError(e instanceof Error ? e : new Error('Failed to fetch archived sessions'))
      setSessions([])
    } finally {
      if (requestId === requestIdRef.current) {
        isFetchingRef.current = false
        setIsLoading(false)
      }
    }
  }, [enabled, serverId, limit])

  useEffect(() => {
    if (!enabled) {
      setSessions([])
      setIsLoading(false)
      return
    }
    void fetchArchived()
  }, [enabled, fetchArchived])

  useEffect(() => {
    if (!enabled) return

    const subscribe = serverId
      ? (cb: Parameters<typeof subscribeToServerEvents>[1]) => subscribeToServerEvents(serverId, cb)
      : subscribeToEvents

    return subscribe({
      onSessionUpdated: session => {
        const isArchived = Boolean(session.time?.archived)
        setSessions(prev => {
          const exists = prev.some(item => item.id === session.id)
          if (isArchived) {
            if (!exists) return [session, ...prev]
            return prev.map(item => (item.id === session.id ? session : item))
          }
          return exists ? prev.filter(item => item.id !== session.id) : prev
        })
      },
      onSessionDeleted: sessionId => {
        setSessions(prev => prev.filter(item => item.id !== sessionId))
      },
      onReconnected: reason => {
        if (reason === 'server-switch') return
        if (isFetchingRef.current) return
        setSessions([])
        void fetchArchived()
      },
    })
  }, [enabled, serverId, fetchArchived])

  useEffect(() => {
    if (!enabled || serverId) return
    return serverStore.onServerChange(() => {
      setSessions([])
      void fetchArchived()
    })
  }, [enabled, serverId, fetchArchived])

  const refresh = useCallback(async () => {
    await fetchArchived()
  }, [fetchArchived])

  const restore = useCallback(
    async (sessionId: string) => {
      const session = sessions.find(item => item.id === sessionId)
      await restoreSession(sessionId, session?.directory, serverId)
      setSessions(prev => prev.filter(item => item.id !== sessionId))
    },
    [sessions, serverId],
  )

  const remove = useCallback(
    async (sessionId: string) => {
      const session = sessions.find(item => item.id === sessionId)
      await deleteSession(sessionId, session?.directory, serverId)
      pinnedSessionsStore.unpin(sessionId)
      setSessions(prev => prev.filter(item => item.id !== sessionId))
    },
    [sessions, serverId],
  )

  return { sessions, isLoading, error, refresh, restore, remove }
}
