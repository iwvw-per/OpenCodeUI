import { forwardRef } from 'react'
import { cn } from '../../utils/cn'

interface ProgressBarProps {
  /** 0 ~ 1 */
  progress: number
  /** 完成后整条转为完成色 */
  done?: boolean
  size?: 'xs' | 'sm'
  /** 纯装饰（嵌在已有文字计数的 header 里时用），不暴露 progressbar 语义 */
  decorative?: boolean
  className?: string
}

const sizeStyles = {
  xs: 'h-0.5',
  sm: 'h-1',
} as const

/**
 * ProgressBar — 细进度条。
 *
 * 与 CircularProgress 分工：环形用于需要强调的独立指标（如输入框待办面板），
 * 条形用于行内嵌在文字/header 里的紧凑场景。
 */
export const ProgressBar = forwardRef<HTMLDivElement, ProgressBarProps>(
  ({ progress, done = false, size = 'xs', decorative = false, className }, ref) => {
    const clamped = Math.max(0, Math.min(1, progress))
    return (
      <div
        ref={ref}
        role={decorative ? undefined : 'progressbar'}
        aria-hidden={decorative || undefined}
        aria-valuemin={decorative ? undefined : 0}
        aria-valuemax={decorative ? undefined : 100}
        aria-valuenow={decorative ? undefined : Math.round(clamped * 100)}
        className={cn('w-full overflow-hidden rounded-full bg-border-200/50', sizeStyles[size], className)}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500 ease-out',
            done ? 'bg-success-100' : 'bg-accent-main-100',
          )}
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
    )
  },
)
ProgressBar.displayName = 'ProgressBar'
