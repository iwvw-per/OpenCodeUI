// ============================================
// useTurnOutline - 独立轮次大纲的 React 绑定
// ============================================
//
// 把 turnOutlineStore 暴露成可订阅的 hook，并把当前已加载消息里的轮次
// 增量合并进 store（持久化），使侧边轴在历史未加载完时也能显示完整轮次。

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { turnOutlineStore } from '../store/turnOutlineStore'
import { extractTurnOutlineEntries, type TurnOutlineEntry } from '../components/outlineIndexModel'
import type { Message } from '../types/message'

const EMPTY: TurnOutlineEntry[] = []

/** 订阅某会话的轮次大纲（自动懒加载持久化数据） */
export function useTurnOutlineEntries(serverId: string, sessionId: string | null): TurnOutlineEntry[] {
  const getSnapshot = useCallback(
    () => (sessionId ? turnOutlineStore.getSnapshot(serverId, sessionId) : EMPTY),
    [serverId, sessionId],
  )
  const subscribe = useCallback((onStoreChange: () => void) => turnOutlineStore.subscribe(onStoreChange), [])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * 把一批消息里的轮次合并进大纲 store。
 * 只在 messages 引用变化时执行；store 内部按 messageId 去重。
 */
export function useMergeTurnOutline(serverId: string, sessionId: string | null, messages: Message[]): void {
  useEffect(() => {
    if (!sessionId || messages.length === 0) return
    const entries = extractTurnOutlineEntries(messages)
    if (entries.length === 0) return
    turnOutlineStore.merge(serverId, sessionId, entries)
  }, [serverId, sessionId, messages])
}
