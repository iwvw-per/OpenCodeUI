import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 空 Working 壳挂载闸门。
 *
 * - 用户入场生长完成后，再等 extraDelayMs 才 armed
 * - 有 assistant 时 timeline 不查这个闸门（立刻挂壳）
 * - session idle 时清空，避免中断空回合在下次发送时被 streaming 抢先重开
 */
export function useEmptyWorkingShellGate(isStreaming: boolean, extraDelayMs: number) {
  const readyRef = useRef(new Set<string>())
  const timersRef = useRef(new Map<string, number>())
  const streamingRef = useRef(isStreaming)
  // eslint-disable-next-line react-hooks/refs -- 保持最新 streaming 值，供回调读取
  streamingRef.current = isStreaming
  const [version, setVersion] = useState(0)

  const clear = useCallback(() => {
    for (const timer of timersRef.current.values()) window.clearTimeout(timer)
    timersRef.current.clear()
    if (readyRef.current.size === 0) return
    readyRef.current.clear()
    setVersion(v => v + 1)
  }, [])

  const isReady = useCallback((id: string) => readyRef.current.has(id), [])

  const onEntryGrowComplete = useCallback(
    (messageId: string) => {
      // 只在 session 仍 busy 时武装；idle 后的回调（历史 remount）忽略
      if (!streamingRef.current) return
      // 已 armed：不 bump version，避免多余 re-render
      if (readyRef.current.has(messageId)) return
      if (timersRef.current.has(messageId)) return

      const timer = window.setTimeout(() => {
        timersRef.current.delete(messageId)
        if (!streamingRef.current) return
        if (readyRef.current.has(messageId)) return
        readyRef.current.add(messageId)
        setVersion(v => v + 1)
      }, extraDelayMs)
      timersRef.current.set(messageId, timer)
    },
    [extraDelayMs],
  )

  useEffect(() => {
    if (!isStreaming) clear()
  }, [isStreaming, clear])

  useEffect(() => {
    // 把 ref 在 effect 内取出来：cleanup 里再读 timersRef.current 会被 lint 判定
    // 「那一刻 ref 可能已指向别的对象」。这里固定住同一个 Map，语义更明确。
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer)
      timers.clear()
    }
  }, [])

  return {
    /** 闸门版本：ready 集合变化时递增，用于重算 timeline */
    version,
    isReady,
    onEntryGrowComplete,
  }
}
