// ============================================
// useTokenRate - 最后一轮对话的生成速率（tok/s）
//
// 用最后一条「已完成」助手消息的精确数据计算：tokens.output / 生成时长
// （time.completed - time.created）。SSE 流没有逐 chunk token 计数，不做实时估算；
// 当前轮生成期间保持显示上一轮的值，完成后随 message.updated 自动刷新。
// ============================================

import { useEffect, useState } from 'react'
import { messageStore } from '../store'

export interface TokenRateState {
  tokensPerSec: number
  /** 是否存在可计算的已完成轮次 */
  hasData: boolean
}

export function useTokenRate(sessionId: string | null): TokenRateState {
  const [state, setState] = useState<TokenRateState>({ tokensPerSec: 0, hasData: false })

  useEffect(() => {
    if (!sessionId) {
      setState({ tokensPerSec: 0, hasData: false })
      return
    }

    const update = () => {
      const messages = messageStore.getVisibleMessages(sessionId)
      // 从最新往回找最后一条已完成（有结束时间与 token 计数）的助手消息；
      // 正在流式生成的那条还没有 completed，天然跳过，保持显示上一轮的值
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]
        if (message.info.role !== 'assistant') continue
        const info = message.info
        const created = info.time.created
        const completed = info.time.completed
        if (!created || !completed || completed <= created) continue
        const tokensPerSec = info.tokens.output > 0 ? info.tokens.output / ((completed - created) / 1000) : 0
        setState({ tokensPerSec, hasData: true })
        return
      }
      setState({ tokensPerSec: 0, hasData: false })
    }

    const unsubscribe = messageStore.subscribeSession(sessionId, update)
    update()
    return unsubscribe
  }, [sessionId])

  return state
}