// ============================================
// sessionListCache - 会话列表短 TTL 缓存
//
// 切服务器/切目录时列表会被清空重拉，网络往返造成「先空白再出现」的体感。
// 这里按 serverId + 查询参数缓存列表结果：命中则跳过网络请求，
// 让切回已访问过的服务器/目录即时出内容。
//
// 失效策略：
// - 会话增删改归档等本地写操作完成后按 serverId 前缀失效
// - 其它客户端产生的变更不在失效范围内，由 TTL（30s）兜底
// ============================================

import type { ApiSession, SessionListParams } from './types'
import { ttlCacheGet, ttlCacheSet, ttlCacheInvalidate } from '../utils/ttlCache'

/** 列表缓存 TTL：够短以避免明显陈旧，够长以覆盖来回切换 */
const SESSION_LIST_TTL_MS = 30_000
const SESSION_LIST_CACHE_PREFIX = 'session-list:'

type SessionListQuery = SessionListParams & {
  includeArchived?: boolean
  archivedOnly?: boolean
  /** 显式刷新时跳过读缓存（仍写入，供后续复用） */
  skipCache?: boolean
}

export function sessionListCacheKey(serverId: string, query: SessionListQuery): string {
  const archived = query.archivedOnly ? 'archived' : query.includeArchived ? 'all' : 'active'
  return [
    SESSION_LIST_CACHE_PREFIX,
    serverId,
    archived,
    query.directory ?? '',
    query.roots === undefined ? '' : String(query.roots),
    query.search ?? '',
    query.limit ?? '',
    query.start ?? '',
  ].join('|')
}

/** 搜索结果是瞬态的高基数查询，不缓存，避免污染与内存膨胀 */
function isCacheable(query: SessionListQuery): boolean {
  return !query.search
}

export function readSessionListCache(serverId: string, query: SessionListQuery): ApiSession[] | undefined {
  if (query.skipCache || !isCacheable(query)) return undefined
  return ttlCacheGet<ApiSession[]>(sessionListCacheKey(serverId, query), SESSION_LIST_TTL_MS)
}

export function writeSessionListCache(serverId: string, query: SessionListQuery, sessions: ApiSession[]): void {
  if (!isCacheable(query)) return
  ttlCacheSet(sessionListCacheKey(serverId, query), sessions, SESSION_LIST_TTL_MS)
}

/**
 * 按服务器失效列表缓存（缺省失效全部）。
 * session-list:${serverId}|... 的 key 结构保证前缀能精确匹配单台服务器。
 */
export function invalidateSessionListCache(serverId?: string): void {
  ttlCacheInvalidate(serverId ? `${SESSION_LIST_CACHE_PREFIX}${serverId}|` : SESSION_LIST_CACHE_PREFIX)
}
