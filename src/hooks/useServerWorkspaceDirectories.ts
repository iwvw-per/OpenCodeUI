// ============================================
// useServerWorkspaceDirectories - 服务器工作区目录解析
//
// 优先返回服务器已保存的工作区（per-server saved-directories）。
// 无已保存工作区时（典型：新连接的远程主机），自动从服务器自身数据推导：
//   1. 拉取服务器全局会话列表（session.list，不带 directory）
//   2. 取各会话的 directory 字段作为候选目录
//   3. 逐目录再拉会话，合并出最终目录集合与会话全集
// 推导结果仅内存使用、不写存储；用户显式添加工作区后自动让位。
// ============================================

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { getSessions, type ApiSession } from '../api'
import { readServerWorkspaces } from '../utils/serverWorkspaces'
import { subscribePerServerStorageVersion, getStorageVersion } from '../utils/perServerStorage'
import { normalizeToForwardSlash } from '../utils'

export interface ServerWorkspaceDirectoriesResult {
  /** 已保存的工作区目录（用户显式添加） */
  savedDirectories: string[]
  /** 生效目录：已保存非空时 = 已保存；为空时 = 从服务器会话推导 */
  directories: string[]
  /** 推导阶段拉取的全部会话（仅无已保存工作区时非空；含全局会话 + 各目录会话） */
  discoveredSessions: ApiSession[]
  /** 是否有已保存工作区 */
  hasSavedWorkspaces: boolean
  /** 推导进行中（无已保存工作区时） */
  isLoading: boolean
}

export function useServerWorkspaceDirectories(
  serverId: string,
  enabled = true,
): ServerWorkspaceDirectoriesResult {
  const storageVersion = useSyncExternalStore(
    subscribePerServerStorageVersion,
    getStorageVersion,
    getStorageVersion,
  )
  const savedDirectories = useMemo(() => {
    void storageVersion
    return readServerWorkspaces(serverId)
  }, [serverId, storageVersion])
  const hasSavedWorkspaces = savedDirectories.length > 0

  const [derived, setDerived] = useState<{ directories: string[]; sessions: ApiSession[] }>({
    directories: [],
    sessions: [],
  })
  const [isLoading, setIsLoading] = useState(() => enabled && savedDirectories.length === 0)

  useEffect(() => {
    if (!enabled || hasSavedWorkspaces) {
      setDerived({ directories: [], sessions: [] })
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    void (async () => {
      try {
        const directorySet = new Set<string>()
        const sessionMap = new Map<string, ApiSession>()
        const collect = (list: ApiSession[]) => {
          for (const session of list) {
            sessionMap.set(session.id, session)
            if (session.directory) directorySet.add(normalizeToForwardSlash(session.directory))
          }
        }

        // 1. 全局会话（不带 directory）：服务器根/全局存储中的会话
        collect(await getSessions({ roots: false, limit: 200 }, serverId))
        if (cancelled) return

        // 2. 逐目录拉会话：补全各项目目录（git 工作区）里的会话
        const results = await Promise.all(
          Array.from(directorySet).map(directory =>
            getSessions({ directory, roots: false, limit: 100 }, serverId).catch(() => [] as ApiSession[]),
          ),
        )
        if (cancelled) return
        for (const list of results) collect(list)

        setDerived({ directories: Array.from(directorySet), sessions: Array.from(sessionMap.values()) })
      } catch {
        if (!cancelled) setDerived({ directories: [], sessions: [] })
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, hasSavedWorkspaces, serverId])

  return {
    savedDirectories,
    directories: hasSavedWorkspaces ? savedDirectories : derived.directories,
    discoveredSessions: hasSavedWorkspaces ? [] : derived.sessions,
    hasSavedWorkspaces,
    isLoading,
  }
}
