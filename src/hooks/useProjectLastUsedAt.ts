// ============================================
// useProjectLastUsedAt - 项目行「最后使用时间」
//
// git worktree 的会话按目录存储，不在全局会话列表（GET /session 无 directory）里。
// 对每个目录单独 getSessions({ directory }) 取最大 time.updated，作为该项目的最后使用时间。
// 结果按 serverId 缓存 60s，避免侧栏折叠/切换时重复打远程接口；单个目录失败自动跳过，
// 由上层（本地 recentProjects 记录）兜底。
//
// 实时性：订阅该服务器的 session.created/updated 事件，一旦某目录有会话活动就
// 就地抬高该目录的 lastUsed，无需等待缓存过期或刷新页面。
// ============================================

import { useEffect, useMemo, useState } from 'react'
import { getSessions } from '../api'
import { subscribeToServerEvents } from '../api/events'
import { normalizeToForwardSlash } from '../utils'

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { at: number; updated?: number }>()

function cacheKey(serverId: string, worktree: string): string {
  return `${serverId}\x00${normalizeToForwardSlash(worktree)}`
}

async function fetchDirectoryLastUsed(serverId: string, worktree: string): Promise<number | undefined> {
  const key = cacheKey(serverId, worktree)
  const cached = cache.get(key)
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
  cache.set(key, { at: Date.now(), updated })
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

  // 会话活动 → 就地抬高对应目录的最后使用时间，无需刷新页面。
  // 归档会话不计入（列表不显示，也不该影响项目排序）。
  useEffect(() => {
    if (!enabled || key === '') return

    const tracked = new Set(key.split('\x00'))

    const bump = (directory: string | undefined, updatedAt: number | undefined) => {
      if (!directory || !updatedAt) return
      const normalized = normalizeToForwardSlash(directory)
      if (!tracked.has(normalized)) return
      // 同步更新模块缓存，避免重挂后又被 60s 内的旧缓存盖回
      cache.set(cacheKey(serverId, normalized), { at: Date.now(), updated: updatedAt })
      setLastUsedMap(prev => {
        const current = prev[normalized] ?? 0
        if (updatedAt <= current) return prev
        return { ...prev, [normalized]: updatedAt }
      })
    }

    return subscribeToServerEvents(serverId, {
      onSessionCreated: session => {
        if (session.parentID || session.time?.archived) return
        bump(session.directory, session.time?.updated ?? session.time?.created)
      },
      onSessionUpdated: session => {
        if (session.parentID || session.time?.archived) return
        bump(session.directory, session.time?.updated ?? session.time?.created)
      },
    })
  }, [serverId, key, enabled])

  return lastUsedMap
}