// ============================================
// ttlCache - 进程内短 TTL 缓存
//
// 用于跨主机切换复用的「服务器侧发现数据」（项目列表/全局会话分组/git 目录等）。
// 切换主机时这些数据不需要每次全量重拉；短 TTL（默认 60s）保证不会长期显示陈旧数据。
// 有明确变更信号（如 worktree 事件）时用 ttlCacheInvalidate 按前缀失效。
// ============================================

interface CacheEntry {
  at: number
  /** 写入时已知的 TTL；未知则视为无过期（仅靠显式失效或再次读取时判定） */
  ttlMs: number | null
  value: unknown
}

const store = new Map<string, CacheEntry>()

/** 惰性清理：entry 只在读取命中时删除，长期不读的 key 会累积；写入时顺带扫一遍过期项 */
function pruneExpired(): void {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (entry.ttlMs !== null && now - entry.at > entry.ttlMs) store.delete(key)
  }
}

export function ttlCacheGet<T>(key: string, ttlMs: number): T | undefined {
  const entry = store.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.at > ttlMs) {
    store.delete(key)
    return undefined
  }
  return entry.value as T
}

export function ttlCacheSet<T>(key: string, value: T, ttlMs?: number): void {
  if (store.size > 0) pruneExpired()
  store.set(key, { at: Date.now(), ttlMs: ttlMs ?? null, value })
}

/** 按 key 前缀失效（如某服务器的所有缓存） */
export function ttlCacheInvalidate(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}
