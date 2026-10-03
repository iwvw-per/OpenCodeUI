// ============================================
// hostSwitchDirection — 主机切换的平移方向
// ============================================
//
// 侧栏项目列表与主聊天区在切换主机时按「目标主机相对当前主机在切换条中的方位」
// 平移：切到更靠右的主机 → 从右侧滑入；更靠左 → 从左侧滑入。
// 抽成纯函数 + 一个 hook，便于单测与复用，不依赖 DOM。

import { useEffect, useState } from 'react'

export type HostSlideDirection = 'from-right' | 'from-left'

/** 平移动画时长（ms），与 index.css 的 host-slide-* 保持一致 */
const HOST_SLIDE_MS = 200

/**
 * 根据主机在有序列表中的索引差决定平移方向。
 *
 * @param previousIndex 当前主机索引；未知时为 -1
 * @param nextIndex 目标主机索引；未知时为 -1
 * @returns 目标更靠右返回 'from-right'，否则 'from-left'（含索引未知的退化情形）
 */
export function hostSwitchDirection(previousIndex: number, nextIndex: number): HostSlideDirection {
  if (previousIndex < 0 || nextIndex < 0) return 'from-left'
  return nextIndex > previousIndex ? 'from-right' : 'from-left'
}

/** 对应的 CSS 动画类名 */
export function hostSlideClass(direction: HostSlideDirection): string {
  return direction === 'from-right' ? 'host-slide-from-right' : 'host-slide-from-left'
}

export interface HostSlideState {
  /** 本次切换应播放的平移动画类名；首次渲染为空串 */
  className: string
  /** 是否处于「刚刚切换主机」的短暂窗口内。用于抑制目标工作区自身
   *  （输入框停靠、欢迎层入场）的过渡，避免与平移动画打架。 */
  switching: boolean
}

/**
 * 观察当前活动主机索引变化，返回本次切换的平移动画类名与「正在切换」标志。
 *
 * 用「渲染期调整 state」记住上一次索引，只在索引真正变化时重算，避免无关重渲染
 * 把类名切来切去导致动画重播。首次渲染返回空串（不播放）。
 * switching 在切换后的 HOST_SLIDE_MS 内为 true，之后自动复位。
 */
export function useHostSlideState(serverIds: readonly string[], activeServerId: string): HostSlideState {
  const activeIndex = serverIds.indexOf(activeServerId)
  const [state, setState] = useState<{ index: number; className: string; switching: boolean }>({
    index: activeIndex,
    className: '',
    switching: false,
  })
  if (state.index !== activeIndex) {
    setState({
      index: activeIndex,
      className: hostSlideClass(hostSwitchDirection(state.index, activeIndex)),
      switching: true,
    })
  }

  useEffect(() => {
    if (!state.switching) return
    const timer = window.setTimeout(() => {
      setState(prev => (prev.switching ? { ...prev, switching: false } : prev))
    }, HOST_SLIDE_MS)
    return () => window.clearTimeout(timer)
  }, [state.switching])

  return { className: state.className, switching: state.switching }
}


