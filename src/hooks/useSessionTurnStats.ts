// ============================================
// useSessionTurnStats - 会话累计统计的 React 绑定
//
// 复用 useSessionStats 的订阅模式：直接订 messageStore，流式期间节流通知，
// 用 useSyncExternalStore 读取快照，并用相等性判断复用上一个对象，
// 避免统计面板与 footer 在每个 token 到达时重渲。
// ============================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { messageStore } from '../store/messageStore'
import {
  computeSessionTurnStats,
  isSameSessionTurnStats,
  EMPTY_SESSION_TURN_STATS,
  type SessionTurnStats,
} from './sessionTurnStats'

export type { SessionTurnStats } from './sessionTurnStats'

/** 流式期间最多每 200ms 重算一次；结束或非流式时立即更新 */
const STREAMING_STATS_INTERVAL_MS = 200

export function useSessionTurnStats(sessionId: string | null): SessionTurnStats {
  const cacheRef = useRef<SessionTurnStats | null>(null)
  const [stats, setStats] = useState<SessionTurnStats>(EMPTY_SESSION_TURN_STATS)

  const recompute = useCallback(() => {
    if (!sessionId) {
      cacheRef.current = null
      setStats(EMPTY_SESSION_TURN_STATS)
      return
    }

    const next = computeSessionTurnStats(messageStore.getVisibleMessages(sessionId))
    const prev = cacheRef.current
    if (prev && isSameSessionTurnStats(prev, next)) return
    cacheRef.current = next
    setStats(next)
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) {
      setStats(EMPTY_SESSION_TURN_STATS)
      return
    }

    let timer: ReturnType<typeof setTimeout> | null = null

    const schedule = () => {
      if (!messageStore.getIsStreaming(sessionId)) {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        recompute()
        return
      }
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        recompute()
      }, STREAMING_STATS_INTERVAL_MS)
    }

    const unsubscribe = messageStore.subscribeSession(sessionId, schedule)
    recompute()

    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [recompute, sessionId])

  return stats
}
