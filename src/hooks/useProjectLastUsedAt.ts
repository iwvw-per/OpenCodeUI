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

/**
 * 并发上限：项目多时逐个目录 getSessions 会同时打满浏览器同源连接额度
 * （约 6 条），把正在切换的会话消息请求挤到队列后面。限制为 3 条并发，
 * 让出连接给更关键的会话加载；每目录有 60s 缓存，慢一点不影响体验。
 */
const MAX_CONCURRENT_FETCHES = 3

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}

function cacheKey(serverId: string, worktree: string): string {
  return `${serverId}\x00${normalizeToForwardSlash(worktree)}`
}

/** 目录最后使用时间查询结果：区分「查到了（可能为空）」与「查询失败」 */
type LastUsedResult = { ok: true; updated?: number } | { ok: false }

async function fetchDirectoryLastUsed(serverId: string, worktree: string): Promise<LastUsedResult> {
  const key = cacheKey(serverId, worktree)
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return { ok: true, updated: cached.updated }

  try {
    const sessions = await getSessions({ directory: worktree, limit: 50 }, serverId)
    let max = 0
    for (const session of sessions) {
      const time = session.time?.updated
      if (time && time > max) max = time
    }
    const updated = max || undefined
    cache.set(key, { at: Date.now(), updated })
    return { ok: true, updated }
  } catch {
    // 失败不写缓存：否则会被当成「该目录没有会话」，在 TTL（60s）内一直不显示
    // 时间戳，且没有任何重试入口（移动端冷启动/弱网时表现为部分项目时间戳丢失）。
    return { ok: false }
  }
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
  // 重连补拉触发器：onReconnected 时递增，作为加载 effect 的依赖。
  const [reconnectNonce, setReconnectNonce] = useState(0)

  useEffect(() => {
    if (!enabled || key === '') {
      setLastUsedMap({})
      return
    }
    let cancelled = false
    const directories = key.split('\x00')
    let retryTimer: number | null = null
    let retryAttempt = 0
    // 重试上限：单次 effect 内最多补拉 3 次（间隔递增），避免某目录长期失败
    // 时无限轮询。超过上限后交给下次 key/服务器变化或用户刷新。
    const MAX_RETRIES = 3

    const load = async () => {
      const results: Array<readonly [string, LastUsedResult]> = []
      await runWithConcurrency(directories, MAX_CONCURRENT_FETCHES, async worktree => {
        const result = await fetchDirectoryLastUsed(serverId, worktree)
        results.push([worktree, result] as const)
      })
      if (cancelled) return

      // 与已有值合并，而不是整表替换：某目录本次查询失败（弱网/网关抖动）时，
      // 保留上次已知的时间戳，避免项目行时间戳突然消失、排序跳变。
      // 只抬高不降低，与 sessionActivityStore 的单调锚点语义一致。
      setLastUsedMap(prev => {
        const next: Record<string, number> = { ...prev }
        for (const [worktree, result] of results) {
          if (!result.ok) continue // 失败：保留旧值
          if (result.updated !== undefined) {
            if (result.updated > (next[worktree] ?? 0)) next[worktree] = result.updated
          } else {
            delete next[worktree] // 查到确实无会话：清掉
          }
        }
        return next
      })

      // 有目录查询失败则退避重试（失败不写缓存，重试成本可控），
      // 否则弱网下会一直缺时间戳直到用户手动刷新。
      if (!cancelled && retryAttempt < MAX_RETRIES && results.some(([, result]) => !result.ok)) {
        retryAttempt += 1
        const delay = 3000 * retryAttempt
        retryTimer = window.setTimeout(() => {
          if (!cancelled) void load()
        }, delay)
      }
    }

    void load()

    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
    }
  }, [serverId, key, enabled, reconnectNonce])

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
      // 网络重连/回前台：若此前有目录查询失败（弱网），借这次重连补拉，
      // 不必等用户手动刷新。server-switch 由 key 变化自然触发，这里跳过。
      onReconnected: reason => {
        if (reason !== 'server-switch') setReconnectNonce(n => n + 1)
      },
    })
  }, [serverId, key, enabled])

  return lastUsedMap
}