// ============================================
// useGlobalHaptics — 移动端全局触觉反馈
// ============================================
//
// 用一处 document 级监听覆盖全站可交互元素，避免在每个 onClick 里手写震动。
// 触发时机选 click（而非 pointerdown）：click 只在真正的点按后触发，
// 手指按下后拖动滚动不会误震；且能自然对应「一次操作完成」。
//
// 分级由目标的 data-haptic 决定：
//   data-haptic="light|medium|strong" 显式指定
//   data-haptic="none"                不震动（已有自定义触觉的元素用）
//   未标注的可交互元素                 默认 light
//
// 仅在触摸优先设备（preferTouchUi）挂载；带 hover 的桌面/混合设备不震。
// 总开关由 hapticStore 控制，hapticTap 内部会再判一次。

import { useEffect } from 'react'
import { hapticTap, type HapticStrength } from '../utils/haptics'

const INTERACTIVE_SELECTOR = [
  'button',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  'a[href]',
  'label[for]',
  'summary',
].join(',')

const EXPLICIT_STRENGTHS: readonly string[] = ['light', 'medium', 'strong']

export function useGlobalHaptics(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return

    const onClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return

      // 最近一个带 data-haptic 的祖先决定语义；none 直接跳过。
      const hapticEl = target.closest('[data-haptic]')
      const declared = hapticEl?.getAttribute('data-haptic')
      if (declared === 'none') return
      if (declared && EXPLICIT_STRENGTHS.includes(declared)) {
        hapticTap(declared as HapticStrength)
        return
      }

      const interactive = target.closest(INTERACTIVE_SELECTOR)
      if (!interactive) return
      if (interactive instanceof HTMLButtonElement && interactive.disabled) return
      if (interactive.getAttribute('aria-disabled') === 'true') return

      hapticTap('light')
    }

    // capture：在业务 onClick 的 stopPropagation 之前捕获，确保不漏。
    document.addEventListener('click', onClick, { capture: true })
    return () => document.removeEventListener('click', onClick, { capture: true })
  }, [enabled])
}
