// ============================================
// useArchivedSessions - 已归档会话的查看与恢复
//
// 归档会话被 getSessions 默认过滤掉，侧栏完全不展示。这里用 server 的
// archived 查询参数把归档会话单独取回（服务端语义：archived=true 表示
// "也包含归档"，客户端再收窄到 time.archived 为真），并按归档时间倒序，
// 供「已归档对话」面板展示与恢复。
//
// 列表数据存在 sessionListIndexStore 的 archived 视图桶里：
//   - 重开面板首帧即有内容，不转圈
//   - 归档/恢复/删除由 useGlobalEvents 的 SSE 增量维护
// ============================================

import { useState, useEffect, useCallback, useRef, useMemo, useSyncExternalStore } from 'react'
import {
  getArchivedSessions,
  restoreSession,
  deleteSession,
  subscribeToEvents,
  subscribeToServerEvents,
  type ApiSession,
} from '../api'
import {
  sessionListIndexStore,
  type SessionListBucketKey,
} from '../store/sessionListIndexStore'
import { pinnedSessionsStore } from '../store/pinnedSessionsStore'
import { serverStore } from '../store/serverStore'
import { resolveSessionTarget, splitSessionKey } from '../utils/sessionKey'
import i18n from '../i18n'

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
  /** 永久删除多会话（用于批量删除/一键清空），返回删除失败的会话 key */
  removeMany: (sessionIds: string[]) => Promise<string[]>
}

const EMPTY_SESSIONS: ApiSession[] = []

function sortArchived(sessions: ApiSession[]): ApiSession[] {
  return [...sessions].sort((a, b) => (b.time?.archived ?? 0) - (a.time?.archived ?? 0))
}

export function useArchivedSessions(options: UseArchivedSessionsOptions = {}): UseArchivedSessionsResult {
  const { enabled = true, serverId, limit = 200 } = options

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const requestIdRef = useRef(0)
  const isFetchingRef = useRef(false)

  const resolvedServerId = serverId ?? serverStore.getActiveServerId()
  // 归档面板是全局列表（不带目录）
  const bucket: SessionListBucketKey = { serverId: resolvedServerId, directory: undefined, view: 'archived' }
  const bucketIdKey = `${resolvedServerId}\u0000archived`

  const indexSessions = useSyncExternalStore(
    cb => sessionListIndexStore.subscribe(cb),
    () => (enabled ? sessionListIndexStore.getSnapshot(bucket) : EMPTY_SESSIONS),
    () => (enabled ? sessionListIndexStore.getSnapshot(bucket) : EMPTY_SESSIONS),
  )

  const fetchArchived = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!enabled) return
      const requestId = ++requestIdRef.current
      isFetchingRef.current = true
      // silent：回前台/重连时的后台刷新，不转圈、不清空已有列表
      if (!options.silent) {
        setIsLoading(true)
        setError(null)
      }
      try {
        const expectedMembership = sessionListIndexStore.getMembershipRevision(bucket)
        const data = await getArchivedSessions({ roots: false, limit }, serverId)
        if (requestId !== requestIdRef.current) return
        sessionListIndexStore.replace(bucket, data, {
          limit: data.length,
          hasMore: data.length >= limit,
          expectedMembershipRevision: expectedMembership,
        })
      } catch (e) {
        if (requestId !== requestIdRef.current) return
        setError(e instanceof Error ? e : new Error(i18n.t('chat:errors.fetchArchivedSessions')))
        if (!options.silent) sessionListIndexStore.replace(bucket, [], { limit: 0, hasMore: false })
      } finally {
        if (requestId === requestIdRef.current) {
          isFetchingRef.current = false
          setIsLoading(false)
        }
      }
    },
    // bucket 每帧新建，用稳定 id 代替
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, serverId, limit, bucketIdKey],
  )

  useEffect(() => {
    if (!enabled) return
    // 索引有内容：先上屏，陈旧才后台刷新
    if (sessionListIndexStore.has(bucket)) {
      const age = Date.now() - sessionListIndexStore.getFetchedAt(bucket)
      if (age > ARCHIVED_TTL_MS) void fetchArchived({ silent: true })
      return
    }
    void fetchArchived()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fetchArchived, bucketIdKey])

  useEffect(() => {
    if (!enabled) return

    const subscribe = serverId
      ? (cb: Parameters<typeof subscribeToServerEvents>[1]) => subscribeToServerEvents(serverId, cb)
      : subscribeToEvents

    return subscribe({
      // 归档态变化与删除由 useGlobalEvents 写入索引，这里只负责重连后的静默补拉
      onReconnected: reason => {
        if (reason === 'server-switch') return
        if (isFetchingRef.current) return
        // 静默刷新：保留已有归档列表，不转圈、不清空
        void fetchArchived({ silent: true })
      },
    })
  }, [enabled, serverId, fetchArchived])

  const refresh = useCallback(async () => {
    await fetchArchived()
  }, [fetchArchived])

  const restore = useCallback(
    async (sessionId: string) => {
      const session = indexSessions.find(item => item.id === sessionId)
      await restoreSession(sessionId, session?.directory, serverId)
      sessionListIndexStore.remove(bucket, sessionId)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [indexSessions, serverId, bucketIdKey],
  )

  const remove = useCallback(
    async (sessionId: string) => {
      const session = indexSessions.find(item => item.id === sessionId)
      await deleteSession(sessionId, session?.directory, serverId)
      pinnedSessionsStore.unpin(sessionId)
      sessionListIndexStore.remove(bucket, sessionId)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [indexSessions, serverId, bucketIdKey],
  )

  const removeMany = useCallback(
    async (sessionIds: string[]) => {
      if (sessionIds.length === 0) return []
      // 列表可能混有多个 server 的会话，按 server + directory 分组，保证每条
      // 请求都带上正确的 directory，否则服务端可能定位不到会话。
      const groups = new Map<string, { serverId: string; directory?: string; ids: string[] }>()
      for (const sessionKey of sessionIds) {
        const session = indexSessions.find(item => item.id === sessionKey)
        const target = resolveSessionTarget(sessionKey, serverId)
        if (!target.sessionId) continue
        const groupKey = `${target.serverId}\u0000${session?.directory ?? ''}`
        const group = groups.get(groupKey)
        if (group) {
          group.ids.push(target.sessionId)
        } else {
          groups.set(groupKey, { serverId: target.serverId, directory: session?.directory, ids: [target.sessionId] })
        }
      }

      const failed: string[] = []
      await Promise.all(
        Array.from(groups.values()).map(async group => {
          const results = await Promise.allSettled(
            group.ids.map(id => deleteSession(id, group.directory, group.serverId)),
          )
          results.forEach((result, index) => {
            if (result.status !== 'fulfilled') failed.push(group.ids[index])
          })
        }),
      )

      const failedRawIds = new Set(failed)
      for (const sessionKey of sessionIds) {
        const { sessionId: rawId } = splitSessionKey(sessionKey)
        if (failedRawIds.has(rawId)) continue
        sessionListIndexStore.remove(bucket, sessionKey)
        pinnedSessionsStore.unpin(sessionKey)
      }
      return failed
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [indexSessions, serverId, bucketIdKey],
  )

  const sessions = useMemo(() => sortArchived(indexSessions), [indexSessions])

  return { sessions, isLoading, error, refresh, restore, remove, removeMany }
}

/** 归档索引 TTL：超过此时长重开会触发一次后台静默刷新 */
const ARCHIVED_TTL_MS = 30_000
