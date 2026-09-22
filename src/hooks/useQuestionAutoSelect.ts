// ============================================
// useQuestionAutoSelect - 提问倒计时自动提交
//
// 挂载后按设置里的时长倒计时，到点回调一次。用户操作不会取消倒计时，
// 只有「正在提交」或设置关闭时才暂停。
// ============================================

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { autoApproveStore } from '../store'

const TICK_MS = 250

export function useQuestionAutoSelect(
  requestId: string,
  onTimeout: () => void,
  enabled = true,
): number | null {
  const timeout = useSyncExternalStore(
    autoApproveStore.subscribe,
    () => autoApproveStore.questionAutoSelectTimeout,
  )
  const active = enabled && timeout > 0
  const [remaining, setRemaining] = useState<number>(timeout)
  const onTimeoutRef = useRef(onTimeout)

  useEffect(() => {
    onTimeoutRef.current = onTimeout
  })

  useEffect(() => {
    if (!active) return

    const deadline = Date.now() + timeout * 1000
    let fired = false

    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setRemaining(left)
      if (left <= 0 && !fired) {
        fired = true
        onTimeoutRef.current()
      }
    }

    const timer = window.setInterval(tick, TICK_MS)
    return () => window.clearInterval(timer)
  }, [active, requestId, timeout])

  return active ? remaining : null
}
