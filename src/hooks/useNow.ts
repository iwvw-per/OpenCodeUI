import { useEffect, useState } from 'react'

type Subscriber = (now: number) => void

interface TickerChannel {
  subscribers: Set<Subscriber>
  timerId: number | null
}

/**
 * 按 interval 分组的共享时钟。
 *
 * 此前 `useNow` 每个调用点各起一个 `setInterval`：一条消息里若同时有 5 个
 * 运行中的工具行，就有 5 个定时器各自唤醒、各自触发重渲染。分组后同一 interval
 * 的订阅者共用一个定时器和一个 `now`，N 个活跃行只付一份成本。
 */
const tickerChannels = new Map<number, TickerChannel>()

function getTickerChannel(intervalMs: number): TickerChannel {
  const existing = tickerChannels.get(intervalMs)
  if (existing) return existing
  const created: TickerChannel = { subscribers: new Set(), timerId: null }
  tickerChannels.set(intervalMs, created)
  return created
}

function subscribeToTicker(intervalMs: number, subscriber: Subscriber): () => void {
  const channel = getTickerChannel(intervalMs)
  channel.subscribers.add(subscriber)

  // 订阅后先补一帧当前时间：首帧 state 可能来自挂载时刻，
  // 而 enabled 从 false 翻到 true 时中间可能已过了很久。
  // 用 rAF 而非同步调用，避免在 effect 内同步 setState。
  const frameId = typeof window !== 'undefined' ? window.requestAnimationFrame(() => subscriber(Date.now())) : null

  if (channel.timerId === null && typeof window !== 'undefined') {
    channel.timerId = window.setInterval(() => {
      const now = Date.now()
      channel.subscribers.forEach(listener => listener(now))
    }, intervalMs)
  }

  return () => {
    if (frameId !== null && typeof window !== 'undefined') window.cancelAnimationFrame(frameId)

    const tracked = tickerChannels.get(intervalMs)
    if (!tracked) return
    tracked.subscribers.delete(subscriber)
    if (tracked.subscribers.size > 0) return
    if (tracked.timerId !== null && typeof window !== 'undefined') {
      window.clearInterval(tracked.timerId)
    }
    tickerChannels.delete(intervalMs)
  }
}

/**
 * 返回当前时间戳，按 `intervalMs` 刷新；`enabled` 为 false 时停止订阅。
 *
 * 订阅时会立刻收到一次当前时间，因此挂载首帧的读数不会是初始 state 的旧值。
 */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) return
    return subscribeToTicker(intervalMs, setNow)
  }, [enabled, intervalMs])

  return now
}
