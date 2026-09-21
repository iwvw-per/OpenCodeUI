// ============================================
// useWorkStatusVisibility — 面板是否可以占位
// ============================================
//
// 宽度判断测的是「对话区」（对话列 + 上下文面板的整体），而不是对话列本身。
// 对话列的宽度是这一判断的输出：隐藏面板会让它变宽，从而重新满足「对话列够宽」
// 的条件、又显示出面板，无限振荡。对话区的宽度与面板无关，是唯一稳定的输入。

import { useCallback, useEffect, useState } from 'react'
import { WORK_STATUS_REQUIRED_ROW_WIDTH } from './WorkStatusPanel'

interface Options {
  /** 移动端 / 覆盖式布局下不占位 */
  disabled?: boolean
  /** 用户开关 */
  enabled: boolean
}

export function useWorkStatusVisibility({ disabled = false, enabled }: Options) {
  const [rowNode, setRowNode] = useState<HTMLDivElement | null>(null)
  const [rowWidth, setRowWidth] = useState<number | null>(null)
  // 用回调 ref 而非对象 ref：对象 ref 在节点挂载时没有信号，
  // 读取 .current 的测量 effect 会在行节点晚于 effect 挂载时静默观察不到任何东西
  const rowRef = useCallback((node: HTMLDivElement | null) => {
    setRowNode(node)
  }, [])

  useEffect(() => {
    if (!rowNode || typeof ResizeObserver === 'undefined') return undefined

    // 优先测带 data-chat-area 的祖先：它的宽度不受本面板影响
    const measured = rowNode.closest<HTMLElement>('[data-chat-area]') ?? rowNode
    // 不用手动读一次初值：ResizeObserver 在 observe 时会立即回调一次
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      setRowWidth(entry.contentRect.width)
    })
    observer.observe(measured)
    return () => observer.disconnect()
  }, [rowNode])

  const fits = !disabled && rowWidth !== null && rowWidth >= WORK_STATUS_REQUIRED_ROW_WIDTH
  return { rowRef, fits, visible: enabled && fits }
}
