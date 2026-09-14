// ============================================
// useServerProjects - 服务器「已激活项目」列表（GET /project）
//
// 返回服务器侧的 git 项目（排除 global/根项目——用户不要「全局」文件夹）。
// 用于侧栏「项目」tab 自动展示远程主机上真实存在的项目
// （如 work 主机的 D:\Code\API-Monitor 等），与已保存工作区去重合并。
// 结果按 serverId 缓存 60s：切换主机回来时直接复用，避免整列表重拉。
// ============================================

import { useEffect, useState } from 'react'
import { getProjects, type ApiProject } from '../api'
import { normalizeToForwardSlash } from '../utils'
import { ttlCacheGet, ttlCacheSet } from '../utils/ttlCache'

const CACHE_TTL_MS = 60_000
const cacheKey = (serverId: string) => `server-projects:${serverId}`

function normalizeProjects(list: ApiProject[]): ApiProject[] {
  return list.filter(project => !!project.worktree && normalizeToForwardSlash(project.worktree) !== '')
}

export function useServerProjects(
  serverId: string,
  enabled = true,
): { projects: ApiProject[]; isLoading: boolean } {
  const [projects, setProjects] = useState<ApiProject[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const cached = ttlCacheGet<ApiProject[]>(cacheKey(serverId), CACHE_TTL_MS)
    if (cached) {
      setProjects(cached)
      return
    }

    setIsLoading(true)
    getProjects(undefined, serverId)
      .then(list => {
        if (cancelled) return
        const normalized = normalizeProjects(list)
        ttlCacheSet(cacheKey(serverId), normalized)
        setProjects(normalized)
      })
      .catch(() => {
        if (!cancelled) setProjects([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [serverId, enabled])

  return { projects, isLoading }
}