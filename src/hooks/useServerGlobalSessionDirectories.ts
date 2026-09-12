// ============================================
// useServerGlobalSessionDirectories - 服务器「全局存储」会话按目录分组
//
// GET /session（不带 directory）只返回全局存储会话（projectID=global，directory
// 只是记录创建时所在路径，如 work 主机的 D:\AAADATA\OneDrive - moi\TEMP\HYY）。
// 把这些会话按 directory 分组，得到一组"项目目录"（非 git 项目、不在 /project 里），
// 供侧栏「项目」tab 自动展示远程主机上真正的会话主体。
// ============================================

import { useEffect, useState } from 'react'
import { getSessions } from '../api'
import { normalizeToForwardSlash } from '../utils'

export interface GlobalSessionGroup {
  directory: string
  count: number
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
    setIsLoading(true)
    getSessions({ roots: false, limit: 500 }, serverId)
      .then(list => {
        if (cancelled) return
        const map = new Map<string, number>()
        for (const session of list) {
          if (!session.directory) continue
          const directory = normalizeToForwardSlash(session.directory)
          if (!directory || directory === '/') continue
          map.set(directory, (map.get(directory) || 0) + 1)
        }
        // 会话多的目录排前面（主体项目优先展示）
        setGroups(Array.from(map.entries()).map(([directory, count]) => ({ directory, count })))
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