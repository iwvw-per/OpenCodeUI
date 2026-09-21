import { useEffect, useRef, useState } from 'react'

/** 忙碌态最长保持时间，超过即认为上游卡住，不再维持动画 */
const MAX_BUSY_DURATION_MS = 5 * 60 * 1000

/**
 * 让「进行中」状态至少保持 `minDurationMs`。
 *
 * 用途：工具跑得很快时，扫光/脉冲只闪一帧就消失，看起来像界面在抖。
 * 与其让它闪，不如让它多留一会儿 —— 短暂但完整的一次过渡，比残缺的一次更不刺眼。
 *
 * 与 useDelayedRender 同款结构：`active` 为真时靠返回值短路立即生效，
 * state 只负责把 true 多保持一会儿。effect 体内那次同步 setState 与该 hook
 * 属同一模式（订阅状态变化后立即反映），是已知且被接受的写法。
 *
 * 两个边界：
 * - 超过 MAX_BUSY_DURATION_MS 强制结束，避免上游没回结束事件时永远在转。
 * - 卸载时清理定时器。
 */
export function useMinDurationActive(active: boolean, minDurationMs = 300): boolean {
  const startedAtRef = useRef<number | null>(null)
  const [holding, setHolding] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (active) {
      if (startedAtRef.current === null) startedAtRef.current = Date.now()
      return
    }

    const startedAt = startedAtRef.current
    if (startedAt === null) return

    const elapsed = Date.now() - startedAt
    const remaining = Math.max(0, Math.min(minDurationMs - elapsed, MAX_BUSY_DURATION_MS - elapsed))
    if (remaining === 0) {
      startedAtRef.current = null
      return
    }

    // 进入保持期：active 已为 false，但视觉还要留 remaining 毫秒
    setHolding(true)
    timerRef.current = setTimeout(() => {
      startedAtRef.current = null
      setHolding(false)
      timerRef.current = null
    }, remaining)

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [active, minDurationMs])

  // active 为真时立即生效，不等待 effect
  return active || holding
}
