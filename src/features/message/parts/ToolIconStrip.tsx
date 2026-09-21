import { memo } from 'react'
import { getToolIcon } from '../tools'
import { cn } from '../../../utils/cn'
import type { ToolPart } from '../../../types/message'

const MAX_VISIBLE = 6

interface ToolIconStripProps {
  parts: ToolPart[]
  className?: string
}

/**
 * 工具图标条 — 折叠态下用一串小图标概括本组工具调用。
 * 与描述型文字摘要并列，不替代文字（文字说明做了什么，图标说明用了哪些工具）。
 *
 * 状态即颜色：运行中/待命为 accent 色（task 图标同步旋转），失败为 danger 红，
 * 完成保持静默灰。用 `align-middle` 让图标条与文字行垂直居中对齐，
 * 调用方容器再按需补 `items-center`。
 */
export const ToolIconStrip = memo(function ToolIconStrip({ parts, className }: ToolIconStripProps) {
  if (parts.length === 0) return null
  const visible = parts.slice(0, MAX_VISIBLE)
  const overflow = parts.length - visible.length

  return (
    <span className={cn('inline-flex items-center align-middle', className)} aria-hidden="true">
      <span className="flex items-center gap-0.5">
        {visible.map(part => {
          const isError = part.state.status === 'error'
          const isActive = part.state.status === 'running' || part.state.status === 'pending'
          const isTask = part.tool.toLowerCase() === 'task'
          return (
            <span
              key={part.id}
              className={cn(
                'inline-flex items-center justify-center transition-colors duration-200',
                isActive
                  ? 'text-accent-main-100'
                  : isError
                    ? 'text-danger-100'
                    : 'text-text-500 opacity-70',
                isActive && isTask && 'animate-spin',
              )}
            >
              {getToolIcon(part.tool)}
            </span>
          )
        })}
        {overflow > 0 && <span className="text-[length:var(--fs-xxs)] tabular-nums text-text-500">+{overflow}</span>}
      </span>
    </span>
  )
})
