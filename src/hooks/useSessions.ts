import { useState, useEffect, useCallback, useRef, useMemo, useSyncExternalStore } from 'react'
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
import {
  sessionListIndexStore,
  isIndexableQuery,
  type SessionListBucketKey,
} from '../store/sessionListIndexStore'
import { autoDetectPathStyle, sortSessions } from '../utils'

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

/** 搜索态的结果保存在组件内：搜索是瞬态高基数查询，不入索引 */
type SearchState = {
  sessions: ApiSession[]
  isLoading: boolean
  error: Error | null
}

const EMPTY_SESSIONS: ApiSession[] = []

export function useSessions(options: UseSessionsOptions = {}): UseSessionsResult {
  const { pageSize = 20, initialSearch = '', rootsOnly = true, directory, enabled = true, serverId } = options

  // 标准化 directory 路径 (移除末尾斜杠，统一正斜杠)
  const normalizedDirectory = directory ? directory.replace(/\\/g, '/').replace(/\/$/, '') : undefined

  const [search, setSearch] = useState(initialSearch)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [searchState, setSearchState] = useState<SearchState>({ sessions: EMPTY_SESSIONS, isLoading: false, error: null })
  // 非搜索态（索引桶）的加载失败：重试耗尽后置位，供列表区展示错误态
  const [listError, setListError] = useState<Error | null>(null)

  // 缺省跟随活动服务器时要响应切换：用订阅而非一次性读取
  const activeServerId = useSyncExternalStore(
    cb => serverStore.subscribe(cb),
    () => serverStore.getActiveServerId(),
    () => serverStore.getActiveServerId(),
  )
  const resolvedServerId = serverId ?? activeServerId
  const searching = search !== ''
  // 搜索态不进索引：索引用「无 search」的桶
  const indexable = enabled && !searching && isIndexableQuery({ search })

  /** 索引桶：服务器 + 目录 + 活跃视图（本 hook 只查活跃列表）。
   *  scope 固定 'sidebar'：侧栏列表按 pageSize 分页，与上下条导航（30 条）分开存，
   *  否则两者会互相覆盖 loadedLimit。 */
  const bucket: SessionListBucketKey = {
    serverId: resolvedServerId,
    directory: normalizedDirectory,
    view: 'active',
    scope: 'sidebar',
  }
  const bucketIdKey = `${resolvedServerId}\u0000${normalizedDirectory ?? ''}`

  // 直接读当前偏好（不要在 effect 里同步到 ref：effect 在渲染后才跑，
  // 偏好变化那一帧会用到旧值，表现为「改了排序但列表没动」）
  const getSortPreference = useCallback(
    () => ({
      field: layoutStore.getState().sidebarSessionSortField,
      desc: layoutStore.getState().sidebarSessionSortDesc,
    }),
    [],
  )

  // 索引快照（同步、引用稳定）：这是「切回旧主机首帧即有内容」的关键。
  // 搜索态返回空，由 searchState 接管。
  const indexSessions = useSyncExternalStore(
    cb => sessionListIndexStore.subscribe(cb),
    () => (indexable ? sessionListIndexStore.getSnapshot(bucket) : EMPTY_SESSIONS),
    () => (indexable ? sessionListIndexStore.getSnapshot(bucket) : EMPTY_SESSIONS),
  )

  const loadedLimit = indexable ? sessionListIndexStore.getLoadedLimit(bucket) : 0
  const hasIndexContent = indexable && sessionListIndexStore.has(bucket)

  const [isLoading, setIsLoading] = useState(enabled && !hasIndexContent)

  // 用于跟踪最后一次请求，避免竞态条件
  const requestIdRef = useRef(0)
  const searchTimerRef = useRef<number | null>(null)
  const currentLimitRef = useRef(pageSize)
  const searchRef = useRef(search)
  // 防止 onReconnected 密集触发时重复请求
  const isFetchingRef = useRef(false)
  const queuedReconnectRefreshRef = useRef(false)
  const retryTimerRef = useRef<number | null>(null)

  useEffect(() => {
    searchRef.current = search
  }, [search])

  const fetchSessionsRef = useRef<
    (
      params?: SessionListParams & { append?: boolean; retryAttempt?: number; skipCache?: boolean; silent?: boolean },
    ) => Promise<void>
  >(() => Promise.resolve())

  // 获取会话列表
  // append 仅用于控制 loading 状态：true 时用 isLoadingMore，false 时用 isLoading
  // 数据始终全量替换（递增 limit 策略）
  const fetchSessions = useCallback(
    async (
      params: SessionListParams & { append?: boolean; retryAttempt?: number; skipCache?: boolean; silent?: boolean } = {},
    ) => {
      if (!enabled) return

      const { append = false, retryAttempt = 0, silent = false, ...queryParams } = params
      const requestId = ++requestIdRef.current
      isFetchingRef.current = true

      const isSearch = Boolean(queryParams.search ?? searchRef.current)
      // 搜索态的结果落在组件 state；常规列表落索引。
      // 静默刷新（回前台/重连）不动 loading，也不清已有内容。
      if (append) {
        setIsLoadingMore(true)
      } else if (!silent && (!isSearch || !hasIndexContent)) {
        if (isSearch) setSearchState(prev => ({ ...prev, isLoading: true, error: null }))
        else if (!hasIndexContent) setIsLoading(true)
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
            // 按服务器记录路径风格（多服务器连接不同操作系统时互不干扰）
            autoDetectPathStyle(data[0].directory, serverId)
          }

          if (isSearch) {
            setSearchState({ sessions: sortSessions(data.slice(0, requestedLimit), getSortPreference()), isLoading: false, error: null })
          } else {
            // 索引存全量页数据（含多取的那条），由读取侧按 loadedLimit 切片
            sessionListIndexStore.replace(bucket, data, {
              limit: requestedLimit,
              hasMore: data.length > requestedLimit,
            })
            // 拉取成功：清掉失败态（列表有内容后错误不再展示）
            setListError(null)
          }
        } catch (e) {
          if (requestId !== requestIdRef.current) return
          const error = e instanceof Error ? e : new Error('Failed to fetch sessions')
          if (!append) {
            if (retryAttempt < 3) {
              if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
              retryTimerRef.current = window.setTimeout(() => {
                if (requestId !== requestIdRef.current) return
                void fetchSessions({ ...queryParams, silent, retryAttempt: retryAttempt + 1 })
              }, [500, 1500, 3000][retryAttempt])
            } else if (isSearch) {
              setSearchState({ sessions: EMPTY_SESSIONS, isLoading: false, error })
            } else if (!silent) {
              // 非静默且索引为空才留下空列表；索引有内容时保留旧数据
              sessionListIndexStore.replace(bucket, [], { limit: 0, hasMore: false })
              setListError(error)
            }
          }
        } finally {
        if (requestId === requestIdRef.current) {
          isFetchingRef.current = false
          setIsLoading(false)
          setIsLoadingMore(false)
          setSearchState(prev => (prev.isLoading ? { ...prev, isLoading: false } : prev))
          if (queuedReconnectRefreshRef.current) {
            queuedReconnectRefreshRef.current = false
            void fetchSessionsRef.current({ search: searchRef.current || undefined, skipCache: true, silent: true })
          }
        }
      }
    },
    // bucket 是每帧新建对象，用它做依赖会无限重跑；用稳定的 id 字符串代替。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rootsOnly, normalizedDirectory, enabled, serverId, bucketIdKey, hasIndexContent],
  )

  fetchSessionsRef.current = fetchSessions

  // 初始加载和搜索变化时重新加载。
  // 关键差异：索引已有内容时首帧不显示 loading（同步读到旧数据），
  // 只在过旧（超过 TTL）时才后台静默刷新。
  useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      setIsLoadingMore(false)
      return
    }

    // 搜索或 enabled 变化时重置 limit
    currentLimitRef.current = pageSize

    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current)
    }

    const run = () => {
      if (searching) {
        void fetchSessionsRef.current({ search: search || undefined })
        return
      }
      // 索引有内容：先上屏，再按需后台刷新（陈旧才拉）
      if (sessionListIndexStore.has(bucket)) {
        const age = Date.now() - sessionListIndexStore.getFetchedAt(bucket)
        setIsLoading(false)
        if (age > SESSION_LIST_TTL_MS) {
          void fetchSessionsRef.current({ search: undefined, skipCache: true, silent: true })
        }
        return
      }
      void fetchSessionsRef.current({ search: undefined })
    }

    searchTimerRef.current = window.setTimeout(run, searching ? 300 : 0) // 有搜索词时延迟 300ms

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, searching, fetchSessions, enabled, pageSize, bucketIdKey])

  // 订阅 SSE 事件，实时更新列表。
  // 非搜索态：索引由 useGlobalEvents 统一增量维护，这里不再自维护一份，
  // 避免同一事件两处写入产生分歧。搜索态仍在此就地过滤。
  useEffect(() => {
    if (!enabled) return

    const subscribe = serverId
      ? (cb: Parameters<typeof subscribeToServerEvents>[1]) => subscribeToServerEvents(serverId, cb)
      : subscribeToEvents

    const unsubscribe = subscribe({
      onSessionCreated: session => {
        if (session.parentID) return
        if (!searchRef.current) return // 索引路径由 useGlobalEvents 维护
        if (!matchesDirectory(session, normalizedDirectory)) return
        void fetchSessionsRef.current({ search: searchRef.current || undefined })
      },
      onSessionUpdated: session => {
        if (session.parentID) return
        if (!searchRef.current) return
        if (session.time?.archived) {
          setSearchState(prev => ({ ...prev, sessions: prev.sessions.filter(item => item.id !== session.id) }))
          return
        }
        if (matchesDirectory(session, normalizedDirectory)) {
          void fetchSessionsRef.current({ search: searchRef.current || undefined })
        } else {
          setSearchState(prev => ({ ...prev, sessions: prev.sessions.filter(item => item.id !== session.id) }))
        }
      },
      onSessionDeleted: sessionId => {
        if (!searchRef.current) return
        setSearchState(prev => ({ ...prev, sessions: prev.sessions.filter(item => item.id !== sessionId) }))
      },
      onReconnected: reason => {
        if (reason === 'server-switch') return
        if (isFetchingRef.current) {
          queuedReconnectRefreshRef.current = true
          return
        }
        // 网络重连/回前台：保留屏上旧列表，静默拉最新覆盖（stale-while-revalidate）
        void fetchSessionsRef.current({ search: searchRef.current || undefined, skipCache: true, silent: true })
      },
    })

    return unsubscribe
  }, [enabled, normalizedDirectory, pageSize, serverId])

  // 切服务器：不在此清索引。索引按 serverId 分桶，新服务器的桶要么有内容
  // （切回旧主机即时出）要么为空（走上面的初始加载）。旧服务器的桶保留复用。

  // 读取侧：按 loadedLimit 切片。排序由 index store 负责（就地更新语义，
  // 避免流式期间并行会话交替更新导致列表来回跳）。
  const sessions = useMemo(() => {
    if (searching) return searchState.sessions
    if (!indexable) return EMPTY_SESSIONS
    const limit = loadedLimit || pageSize
    return indexSessions.slice(0, limit)
  }, [searching, searchState.sessions, indexable, indexSessions, loadedLimit, pageSize])

  const hasMore = searching
    ? searchState.sessions.length >= currentLimitRef.current
    : sessionListIndexStore.getHasMore(bucket)

  // 加载更多：递增 limit 重新拉取完整列表
  const loadMore = useCallback(async () => {
    if (!enabled || isLoadingMore || !hasMore || sessions.length === 0) return

    currentLimitRef.current += pageSize
    await fetchSessions({ search: search || undefined, append: true })
  }, [enabled, isLoadingMore, hasMore, sessions.length, pageSize, search, fetchSessions])

  // 收起：把 limit 重置回初始 pageSize，重新拉取（对应「展开更多会话」的收起入口）
  const collapse = useCallback(async () => {
    if (!enabled || isLoadingMore || currentLimitRef.current <= pageSize) return

    currentLimitRef.current = pageSize
    await fetchSessions({ search: search || undefined, append: true })
  }, [enabled, isLoadingMore, pageSize, search, fetchSessions])

  // 刷新：显式下拉/重新拉取时绕过列表缓存，保证拿到最新数据
  const refresh = useCallback(async () => {
    if (!enabled) return
    await fetchSessions({ search: search || undefined, skipCache: true })
  }, [search, fetchSessions, enabled])

  // 创建新会话
  const create = useCallback(
    async (title?: string) => {
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
        sessionListIndexStore.upsert(bucket, newSession)
      }

      return newSession
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [normalizedDirectory, serverId, bucketIdKey],
  )

  // 删除会话
  const remove = useCallback(
    async (sessionId: string) => {
      await deleteSession(sessionId, normalizedDirectory, serverId)
      pinnedSessionsStore.unpin(sessionId)
      if (searchRef.current) {
        setSearchState(prev => ({ ...prev, sessions: prev.sessions.filter(s => s.id !== sessionId) }))
      } else {
        sessionListIndexStore.remove(bucket, sessionId)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [normalizedDirectory, serverId, bucketIdKey],
  )

  const patchLocalSession = useCallback(
    (sessionId: string, patch: Partial<ApiSession>) => {
      if (searchRef.current) {
        setSearchState(prev => ({
          ...prev,
          sessions: prev.sessions.map(session => (session.id === sessionId ? { ...session, ...patch } : session)),
        }))
        return
      }
      sessionListIndexStore.patch(bucket, sessionId, patch)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bucketIdKey],
  )

  const removeLocalSession = useCallback(
    (sessionId: string) => {
      if (searchRef.current) {
        setSearchState(prev => ({ ...prev, sessions: prev.sessions.filter(session => session.id !== sessionId) }))
        return
      }
      sessionListIndexStore.remove(bucket, sessionId)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bucketIdKey],
  )

  return {
    sessions,
    isLoading: searching ? searchState.isLoading : isLoading,
    isLoadingMore,
    error: searching ? searchState.error : listError,
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

/** 索引 TTL：超过此时长再次挂载会触发一次后台静默刷新 */
const SESSION_LIST_TTL_MS = 30_000

/** 目录匹配（与索引分桶语义一致：正斜杠 + 去尾斜杠 + 小写） */
function matchesDirectory(session: ApiSession, directory: string | undefined): boolean {
  if (!directory) return true
  const normalize = (value: string | undefined) => (value ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return normalize(session.directory) === normalize(directory)
}
