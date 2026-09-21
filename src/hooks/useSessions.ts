import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react'
import {
  getSessions,
  createSession,
  deleteSession,
  subscribeToEvents,
  subscribeToServerEvents,
  type ApiSession,
  type SessionListParams,
} from '../api'
import { serverStore } from '../store/serverStore'
import { pinnedSessionsStore } from '../store/pinnedSessionsStore'
import { layoutStore } from '../store/layoutStore'
import { autoDetectPathStyle, isSameDirectory, insertSessionSorted, sortSessions } from '../utils'

interface UseSessionsOptions {
  /** 每页数量 */
  pageSize?: number
  /** 初始搜索词 */
  initialSearch?: string
  /** 只加载根会话 */
  rootsOnly?: boolean
  /** 按目录过滤 */
  directory?: string
  /** 延迟启用，用于懒加载 */
  enabled?: boolean
  /** 指定服务器（缺省用活动服务器）。多服务器模式下每个服务器一个实例 */
  serverId?: string
}

interface UseSessionsResult {
  sessions: ApiSession[]
  isLoading: boolean
  isLoadingMore: boolean
  error: Error | null
  hasMore: boolean
  /** 搜索词 */
  search: string
  setSearch: (search: string) => void
  /** 加载更多 */
  loadMore: () => Promise<void>
  /** 收起：重置回初始分页并重新拉取 */
  collapse: () => Promise<void>
  /** 刷新列表 */
  refresh: () => Promise<void>
  /** 创建新会话 */
  create: (title?: string) => Promise<ApiSession>
  /** 删除会话 */
  remove: (sessionId: string) => Promise<void>
  /** 本地更新会话 */
  patchLocalSession: (sessionId: string, patch: Partial<ApiSession>) => void
  /** 本地移除会话 */
  removeLocalSession: (sessionId: string) => void
}

export function useSessions(options: UseSessionsOptions = {}): UseSessionsResult {
  const { pageSize = 20, initialSearch = '', rootsOnly = true, directory, enabled = true, serverId } = options

  // 标准化 directory 路径 (移除末尾斜杠，统一正斜杠)
  const normalizedDirectory = directory ? directory.replace(/\\/g, '/').replace(/\/$/, '') : undefined

  const [sessions, setSessions] = useState<ApiSession[]>([])
  const [isLoading, setIsLoading] = useState(enabled)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [search, setSearch] = useState(initialSearch)

  // 用于跟踪最后一次请求，避免竞态条件
  const requestIdRef = useRef(0)
  // 防抖 timer
  const searchTimerRef = useRef<number | null>(null)
  // 当前 limit，loadMore 时递增（与 SessionContext 保持一致）
  const currentLimitRef = useRef(pageSize)
  const searchRef = useRef(search)
  // 防止 onReconnected 密集触发时重复请求
  const isFetchingRef = useRef(false)
  const queuedReconnectRefreshRef = useRef(false)
  const retryTimerRef = useRef<number | null>(null)
  const fetchSessionsRef = useRef<
    (params?: SessionListParams & { append?: boolean; retryAttempt?: number; skipCache?: boolean }) => Promise<void>
  >(() => Promise.resolve())

  useEffect(() => {
    searchRef.current = search
  }, [search])

  const matchesDirectory = useCallback(
    (session: ApiSession) => !normalizedDirectory || isSameDirectory(normalizedDirectory, session.directory),
    [normalizedDirectory],
  )

  // 排序偏好：订阅 store，改偏好时立即重排（不必等下次拉取）
  const sortPreference = useSyncExternalStore(
    cb => layoutStore.subscribe(cb),
    () => layoutStore.getState().sidebarSessionSortField,
    () => layoutStore.getState().sidebarSessionSortField,
  )
  const sortDesc = useSyncExternalStore(
    cb => layoutStore.subscribe(cb),
    () => layoutStore.getState().sidebarSessionSortDesc,
    () => layoutStore.getState().sidebarSessionSortDesc,
  )
  const sortRef = useRef({ field: sortPreference, desc: sortDesc })
  useEffect(() => {
    sortRef.current = { field: sortPreference, desc: sortDesc }
    // 偏好变化：就地重排已有列表
    setSessions(prev => (prev.length > 0 ? sortSessions(prev, { field: sortPreference, desc: sortDesc }) : prev))
  }, [sortPreference, sortDesc])

  // 获取会话列表
  // append 仅用于控制 loading 状态：true 时用 isLoadingMore，false 时用 isLoading
  // 数据始终全量替换（递增 limit 策略）
  const fetchSessions = useCallback(
    async (params: SessionListParams & { append?: boolean; retryAttempt?: number; skipCache?: boolean } = {}) => {
      if (!enabled) return

      const { append = false, retryAttempt = 0, ...queryParams } = params
      const requestId = ++requestIdRef.current
      isFetchingRef.current = true

      if (append) {
        setIsLoadingMore(true)
      } else {
        setIsLoading(true)
        setError(null)
      }

      try {
        // 多取一条用于判断是否还有更多：仅凭 data.length >= limit 无法区分
        // 「刚好这么多」和「还有更多」——会话数正好等于 pageSize 时会多出一个
        // 点了没反应的「展开更多会话」按钮（取回同样条数后 hasMore 立刻变 false）。
        const requestedLimit = currentLimitRef.current
        const data = await getSessions(
          {
            roots: rootsOnly,
            limit: requestedLimit + 1,
            directory: normalizedDirectory,
            ...queryParams,
          },
          serverId,
        )

        // 检查是否是最新的请求
        if (requestId !== requestIdRef.current) return

        if (data.length > 0 && data[0].directory) {
          // 按服务器记录路径风格（多服务器连不同操作系统时互不干扰）
          autoDetectPathStyle(data[0].directory, serverId)
        }

        setSessions(sortSessions(data.slice(0, requestedLimit), sortRef.current))
        setHasMore(data.length > requestedLimit)
      } catch (e) {
        if (requestId !== requestIdRef.current) return
        setError(e instanceof Error ? e : new Error('Failed to fetch sessions'))
        if (!append) {
          if (retryAttempt < 3) {
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
            retryTimerRef.current = window.setTimeout(() => {
              if (requestId !== requestIdRef.current) return
              void fetchSessions({ ...queryParams, retryAttempt: retryAttempt + 1 })
            }, [500, 1500, 3000][retryAttempt])
          } else {
            setSessions([])
            setHasMore(false)
          }
        }
      } finally {
        if (requestId === requestIdRef.current) {
          isFetchingRef.current = false
          setIsLoading(false)
          setIsLoadingMore(false)
          if (queuedReconnectRefreshRef.current) {
            queuedReconnectRefreshRef.current = false
            setSessions([])
            void fetchSessionsRef.current({ search: searchRef.current || undefined })
          }
        }
      }
    },
    [rootsOnly, normalizedDirectory, enabled, serverId],
  )

  fetchSessionsRef.current = fetchSessions

  // 初始加载和搜索变化时重新加载
  useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      setIsLoadingMore(false)
      return
    }

    // 搜索或 enabled 变化时重置 limit
    currentLimitRef.current = pageSize

    // 防抖处理搜索
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current)
    }

    searchTimerRef.current = window.setTimeout(
      () => {
        fetchSessions({ search: search || undefined })
      },
      search ? 300 : 0,
    ) // 有搜索词时延迟 300ms，无搜索词时立即执行

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current)
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
      }
    }
  }, [search, fetchSessions, enabled, pageSize])

  useEffect(() => {
    if (!enabled) return

    const subscribe = serverId
      ? (cb: Parameters<typeof subscribeToServerEvents>[1]) => subscribeToServerEvents(serverId, cb)
      : subscribeToEvents

    const unsubscribe = subscribe({
      onSessionCreated: session => {
        if (session.parentID) return
        if (!matchesDirectory(session)) return

        if (searchRef.current) {
          void fetchSessionsRef.current({ search: searchRef.current || undefined })
          return
        }

        setSessions(prev => {
          if (prev.some(item => item.id === session.id)) return prev
          // 列表始终按偏好有序，新会话插到对应位置（正序时在末尾），不是无脑置顶
          return insertSessionSorted(prev, session, sortRef.current)
        })
      },
      onSessionUpdated: session => {
        if (session.parentID) return

        // 归档会话直接从列表移除：getSessions 的 archived 过滤只覆盖全量拉取，
        // 若不处理，session.updated 会把刚归档的会话重新插回列表（归档后"没刷新"的根因）
        if (session.time?.archived) {
          setSessions(prev => prev.filter(item => item.id !== session.id))
          return
        }

        if (searchRef.current) {
          if (matchesDirectory(session)) {
            void fetchSessionsRef.current({ search: searchRef.current || undefined })
          } else {
            setSessions(prev => prev.filter(item => item.id !== session.id))
          }
          return
        }

        setSessions(prev => {
          const index = prev.findIndex(item => item.id === session.id)

          if (!matchesDirectory(session)) {
            return index === -1 ? prev : prev.filter(item => item.id !== session.id)
          }

          if (index === -1) {
            return insertSessionSorted(prev, session, sortRef.current)
          }

          // 就地替换：更新不改变位置。并行会话的 session.updated 会交替到达
          // （实测两个流式会话是 A A B B A B 这样交替），若每次置顶，
          // 列表里这两项就会来回跳。
          const next = prev.slice()
          next[index] = session
          return next
        })
      },
      onSessionDeleted: sessionId => {
        setSessions(prev => prev.filter(item => item.id !== sessionId))
      },
      onReconnected: reason => {
        if (reason === 'server-switch') return
        if (isFetchingRef.current) {
          queuedReconnectRefreshRef.current = true
          return
        }
        setSessions([])
        void fetchSessionsRef.current({ search: searchRef.current || undefined })
      },
    })

    return unsubscribe
  }, [enabled, matchesDirectory, pageSize, serverId])

  useEffect(() => {
    if (!enabled) return

    // 固定服务器订阅（多服务器模式）：不随 active server 切换刷新
    if (serverId) return

    return serverStore.onServerChange(() => {
      currentLimitRef.current = pageSize
      setSessions([])
      void fetchSessionsRef.current({ search: searchRef.current || undefined })
    })
  }, [enabled, pageSize, serverId])

  // 加载更多：递增 limit 重新拉取完整列表（与 SessionContext 一致）
  const loadMore = useCallback(async () => {
    if (!enabled || isLoadingMore || !hasMore || sessions.length === 0) return

    currentLimitRef.current += pageSize
    await fetchSessions({
      search: search || undefined,
      append: true,
    })
  }, [sessions, search, hasMore, isLoadingMore, fetchSessions, enabled, pageSize])

  // 收起：把 limit 重置回初始 pageSize，重新拉取（对应「展开更多会话」的收起入口）
  const collapse = useCallback(async () => {
    if (!enabled || isLoadingMore || currentLimitRef.current <= pageSize) return

    currentLimitRef.current = pageSize
    await fetchSessions({
      search: search || undefined,
      append: true,
    })
  }, [enabled, isLoadingMore, pageSize, search, fetchSessions])

  // 刷新：显式下拉/重新拉取时绕过列表缓存，保证拿到最新数据
  const refresh = useCallback(async () => {
    if (!enabled) return
    await fetchSessions({ search: search || undefined, skipCache: true })
  }, [search, fetchSessions, enabled])

  // 创建新会话
  const create = useCallback(
    async (title?: string) => {
      // 创建时也要传 directory
      const newSession = await createSession(
        {
          title,
          directory: normalizedDirectory,
        },
        serverId,
      )

      if (searchRef.current) {
        void fetchSessionsRef.current({ search: searchRef.current || undefined })
      } else {
        setSessions(prev => {
          if (prev.some(session => session.id === newSession.id)) return prev
          return insertSessionSorted(prev, newSession, sortRef.current)
        })
      }

      return newSession
    },
    [normalizedDirectory, serverId],
  )

  // 删除会话
  const remove = useCallback(
    async (sessionId: string) => {
      await deleteSession(sessionId, normalizedDirectory, serverId)
      pinnedSessionsStore.unpin(sessionId)
      setSessions(prev => prev.filter(s => s.id !== sessionId))
    },
    [normalizedDirectory, serverId],
  )

  const patchLocalSession = useCallback((sessionId: string, patch: Partial<ApiSession>) => {
    setSessions(prev => prev.map(session => (session.id === sessionId ? { ...session, ...patch } : session)))
  }, [])

  const removeLocalSession = useCallback((sessionId: string) => {
    setSessions(prev => prev.filter(session => session.id !== sessionId))
  }, [])

  return {
    sessions,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    search,
    setSearch,
    loadMore,
    collapse,
    refresh,
    create,
    remove,
    patchLocalSession,
    removeLocalSession,
  }
}
