// ============================================
// useTokenRate - 最后一轮对话的生成速率（tok/s）
//
// 取最后一条「已完成」助手消息，按单个请求的实际生成速度计算：
//   (tokens.output + tokens.reasoning) / 合并后的文本+推理时间窗口
// 分母排除工具调用与排队等待（按整条消息时长算会把多步任务的 TPS 摊薄）。
// part 缺少时间窗口时退回整条消息时长。SSE 流没有逐 chunk token 计数，
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

        // 速率分母只算实际生成时间：合并文本/推理 part 各自的时间窗口，
        // 排除工具调用与排队等待——按整条消息时长算会把多步任务的 TPS 摊薄
        const tokens = info.tokens.output + info.tokens.reasoning
        const intervals: { start: number; end: number }[] = []
        for (const part of message.parts) {
          if (part.type !== 'text' && part.type !== 'reasoning') continue
          const start = part.time?.start
          const end = part.time?.end
          if (!start || !end || end <= start) continue
          intervals.push({ start, end })
        }

        let tokensPerSec = 0
        if (intervals.length > 0) {
          intervals.sort((a, b) => a.start - b.start)
          let totalMs = 0
          let segmentStart = intervals[0].start
          let segmentEnd = intervals[0].end
          for (let j = 1; j < intervals.length; j++) {
            const interval = intervals[j]
            if (interval.start <= segmentEnd) {
              segmentEnd = Math.max(segmentEnd, interval.end)
            } else {
              totalMs += segmentEnd - segmentStart
              segmentStart = interval.start
              segmentEnd = interval.end
            }
          }
          totalMs += segmentEnd - segmentStart
          if (totalMs > 0) tokensPerSec = tokens / (totalMs / 1000)
        } else {
          // part 缺少时间窗口时的兜底：整条消息时长
          tokensPerSec = tokens / ((completed - created) / 1000)
        }

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