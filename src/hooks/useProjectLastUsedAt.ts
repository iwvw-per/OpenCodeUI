// ============================================
// useProjectLastUsedAt - 项目行「最后使用时间」
//
// git worktree 的会话按目录存储，不在全局会话列表（GET /session 无 directory）里。
// 对每个目录单独 getSessions({ directory }) 取最大 time.updated，作为该项目的最后使用时间。
// 结果按 serverId 缓存 60s，避免侧栏折叠/切换时重复打远程接口；单个目录失败自动跳过，
// 由上层（本地 recentProjects 记录）兜底。
// ============================================

import { useEffect, useMemo, useState } from 'react'
import { getSessions } from '../api'
import { normalizeToForwardSlash } from '../utils'

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { at: number; updated?: number }>()

async function fetchDirectoryLastUsed(serverId: string, worktree: string): Promise<number | undefined> {
  const cacheKey = `${serverId}\x00${normalizeToForwardSlash(worktree)}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.updated

  let updated: number | undefined
  try {
    const sessions = await getSessions({ directory: worktree, limit: 50 }, serverId)
    let max = 0
    for (const session of sessions) {
      const time = session.time?.updated
      if (time && time > max) max = time
    }
    updated = max || undefined
  } catch {
    updated = undefined
  }
  cache.set(cacheKey, { at: Date.now(), updated })
  return updated
}

/**
 * 请求给定目录列表各自会话的最大更新时间，返回 worktree → 时间戳 映射。
 */
export function useProjectLastUsedAt(
  serverId: string,
  worktrees: string[],
  enabled = true,
): Record<string, number> {
  // 依赖 string 化的稳定 key，避免每次渲染的数组新引用触发重拉
  const key = useMemo(
    () => [...new Set(worktrees.map(worktree => normalizeToForwardSlash(worktree)))].sort().join('\x00'),
    [worktrees],
  )
  const [lastUsedMap, setLastUsedMap] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!enabled || key === '') {
      setLastUsedMap({})
      return
    }
    let cancelled = false
    const directories = key.split('\x00')
    Promise.all(
      directories.map(async worktree => {
        const updated = await fetchDirectoryLastUsed(serverId, worktree)
        return [worktree, updated] as const
      }),
    ).then(results => {
      if (cancelled) return
      const next: Record<string, number> = {}
      for (const [worktree, updated] of results) {
        if (updated !== undefined) next[worktree] = updated
      }
      setLastUsedMap(next)
    })
    return () => {
      cancelled = true
    }
  }, [serverId, key, enabled])

  return lastUsedMap
}