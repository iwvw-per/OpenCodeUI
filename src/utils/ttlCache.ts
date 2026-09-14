// ============================================
// ttlCache - 进程内短 TTL 缓存
//
// 用于跨主机切换复用的「服务器侧发现数据」（项目列表/全局会话分组/git 目录等）。
// 切换主机时这些数据不需要每次全量重拉；短 TTL（默认 60s）保证不会长期显示陈旧数据。
// 有明确变更信号（如 worktree 事件）时用 ttlCacheInvalidate 按前缀失效。
// ============================================

interface CacheEntry {
  at: number
  value: unknown
}

const store = new Map<string, CacheEntry>()

export function ttlCacheGet<T>(key: string, ttlMs: number): T | undefined {
  const entry = store.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.at > ttlMs) {
    store.delete(key)
    return undefined
  }
  return entry.value as T
}

export function ttlCacheSet<T>(key: string, value: T): void {
  store.set(key, { at: Date.now(), value })
}

/** 按 key 前缀失效（如某服务器的所有缓存） */
export function ttlCacheInvalidate(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}
