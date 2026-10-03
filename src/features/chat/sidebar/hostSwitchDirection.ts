// ============================================
// hostSwitchDirection — 主机切换的平移方向
// ============================================
//
// 侧栏项目列表在切换主机时按「目标主机相对当前主机在切换条中的方位」平移：
// 切到更靠右的主机 → 列表从右侧滑入；更靠左 → 从左侧滑入。
// 抽成纯函数便于单测，不依赖 DOM。

export type HostSlideDirection = 'from-right' | 'from-left'

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
