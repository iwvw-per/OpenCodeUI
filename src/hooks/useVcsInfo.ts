// ============================================
// useVcsInfo - VCS 信息 Hook
// 轮询获取当前项目的 Git 分支信息
// ============================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { getVcsInfo } from '../api/vcs'
import { serverStore } from '../store/serverStore'
import type { VcsInfo } from '../types/api/vcs'

const POLL_INTERVAL = 15000 // 15s 轮询

export interface UseVcsInfoResult {
  vcsInfo: VcsInfo | null
  isLoading: boolean
  error: string | null
  refresh: () => void
}

export function useVcsInfo(directory?: string, serverId?: string): UseVcsInfoResult {
  const [vcsInfo, setVcsInfo] = useState<VcsInfo | null>(null)
  const [isLoading, setIsLoading] = useState(Boolean(directory))
  const [error, setError] = useState<string | null>(null)
  // 序号校验替代 mountedRef：每次目录/服务器变化自增，只有最新序号的请求结果才会落地。
  // 旧序号请求（切换目录/服务器前发出的）天然被丢弃，且不会误伤当前请求。
  const requestIdRef = useRef(0)

  const fetchVcs = useCallback(async () => {
    const requestId = ++requestIdRef.current

    if (!directory) {
      if (requestId === requestIdRef.current) {
        setVcsInfo(null)
        setError(null)
        setIsLoading(false)
      }
      return
    }

    setIsLoading(true)
    try {
      const info = await getVcsInfo(directory, serverId)
      if (requestId === requestIdRef.current) {
        setVcsInfo(info)
        setError(null)
      }
    } catch (e) {
      if (requestId === requestIdRef.current) {
        setError(e instanceof Error ? e.message : 'Failed to fetch VCS info')
        setVcsInfo(null)
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false)
      }
    }
  }, [directory, serverId])

  // 初始加载 + 目录/服务器变化时重新获取
  useEffect(() => {
    // 递增序号，使上一次 effect 周期发出的在途请求立即失效
    requestIdRef.current += 1
    setVcsInfo(null)
    setError(null)
    setIsLoading(Boolean(directory))
    void fetchVcs()

    // 卸载时同样递增，让在途请求的结果失效，避免在已卸载组件上 setState
    return () => {
      requestIdRef.current += 1
    }
  }, [directory, serverId, fetchVcs])

  // 轮询
  useEffect(() => {
    if (!directory) return

    const timer = setInterval(fetchVcs, POLL_INTERVAL)
    return () => clearInterval(timer)
  }, [directory, serverId, fetchVcs])

  useEffect(() => {
    if (!directory) return

    return serverStore.onServerChange(() => {
      setVcsInfo(null)
      setError(null)
      void fetchVcs()
    })
  }, [directory, serverId, fetchVcs])

  return { vcsInfo, isLoading, error, refresh: fetchVcs }
}
