// ============================================
// useServerGlobalSessionDirectories - 服务器「全局存储」会话按目录分组
//
// GET /session（不带 directory）只返回全局存储会话（projectID=global，directory
// 只是记录创建时所在路径，如 work 主机的 D:\AAADATA\OneDrive - moi\TEMP\HYY）。
// 把这些会话按 directory 分组，得到一组"项目目录"（非 git 项目、不在 /project 里），
// 供侧栏「项目」tab 展示远程主机上真正的会话主体（折叠展示，按目录浏览会话）。
// ============================================

import { useEffect, useState } from 'react'
import { getSessions, type ApiSession } from '../api'
import { normalizeToForwardSlash } from '../utils'
import { ttlCacheGet, ttlCacheSet } from '../utils/ttlCache'

/** 结果按 serverId 缓存：切换主机回来直接复用，避免全量重拉（这是最重的一个发现请求） */
const CACHE_TTL_MS = 60_000
const cacheKey = (serverId: string) => `global-session-groups:${serverId}`

export interface GlobalSessionGroup {
  directory: string
  count: number
  /** 该目录下会话的最大更新时间（即项目最后使用时间，毫秒时间戳） */
  lastUsedAt?: number
}

function buildGroups(list: ApiSession[]): GlobalSessionGroup[] {
  const countMap = new Map<string, number>()
  const lastUsedMap = new Map<string, number>()
  for (const session of list) {
    if (!session.directory) continue
    const directory = normalizeToForwardSlash(session.directory)
    if (!directory || directory === '/') continue
    countMap.set(directory, (countMap.get(directory) || 0) + 1)
    const updated = session.time?.updated
    if (updated && updated > (lastUsedMap.get(directory) || 0)) {
      lastUsedMap.set(directory, updated)
    }
  }
  // 会话多的目录排前面（主体项目优先展示）
  return Array.from(countMap.entries()).map(([directory, count]) => ({
    directory,
    count,
    lastUsedAt: lastUsedMap.get(directory),
  }))
}

export function useServerGlobalSessionDirectories(
  serverId: string,
  enabled = true,
): { groups: GlobalSessionGroup[]; isLoading: boolean } {
  const [groups, setGroups] = useState<GlobalSessionGroup[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const cached = ttlCacheGet<GlobalSessionGroup[]>(cacheKey(serverId), CACHE_TTL_MS)
    if (cached) {
      setGroups(cached)
      return
    }

    setIsLoading(true)
    getSessions({ roots: false, limit: 500 }, serverId)
      .then(list => {
        if (cancelled) return
        const built = buildGroups(list)
        ttlCacheSet(cacheKey(serverId), built)
        setGroups(built)
      })
      .catch(() => {
        if (!cancelled) setGroups([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [serverId, enabled])

  return { groups, isLoading }
}