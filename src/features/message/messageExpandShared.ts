// ============================================
// 消息流折叠展开 - 常量与纯逻辑
//
// 与 messageExpand.tsx 分离：该文件只导出组件，本文件放常量、类名工具与
// 渲染 hook。分开放置是为了让含组件的文件只导出组件（Fast Refresh 要求），
// 同时保持调用方的导入路径集中。
// ============================================

import { EXPAND_MOTION } from '../../constants/expandMotion'
import { useDelayedRender } from '../../hooks/useDelayedRender'

/**
 * 消息流折叠展开动画契约
 * - grid 与全局 EXPAND_MOTION 同源
 * - delayed unmount 略长于动画，避免收起中途卸 DOM
 * - clip 横向放行，防止流光 / 阴影被竖向裁切
 */
export const MSG_EXPAND = {
  durationMs: EXPAND_MOTION.durationMs,
  unmountDelayMs: EXPAND_MOTION.unmountDelayMs,
  panel: EXPAND_MOTION.gridTransition,
  panelFade: EXPAND_MOTION.gridFadeTransition,
  chevron: EXPAND_MOTION.chevronTransition,
  clipPath: EXPAND_MOTION.clipPath,
} as const

export function expandGridClass(
  open: boolean,
  animate = true,
  panelClassName: string = MSG_EXPAND.panel,
): string {
  const rows = open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
  if (!animate) return `grid ${rows}`
  return `grid ${panelClassName} ${rows}`
}

export function expandFadeGridClass(open: boolean): string {
  return `grid ${MSG_EXPAND.panelFade} ${
    open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
  }`
}

const CHEVRON_SIZE = {
  sm: 'inline-flex h-5 w-3 shrink-0 items-center justify-center text-text-500',
  md: 'w-4 h-4 text-text-400',
} as const

export type ChevronSize = keyof typeof CHEVRON_SIZE

/** size=sm 给思考/小行；md 给卡片默认 chevron */
export function chevronClass(open: boolean, size: ChevronSize = 'md', extra = ''): string {
  return [CHEVRON_SIZE[size], MSG_EXPAND.chevron, open ? '' : '-rotate-90', extra]
    .filter(Boolean)
    .join(' ')
}

/** 消息流统一 unmount 延迟，与 MSG_EXPAND.unmountDelayMs 同源 */
export function useMessageExpandRender(show: boolean): boolean {
  return useDelayedRender(show, MSG_EXPAND.unmountDelayMs)
}
