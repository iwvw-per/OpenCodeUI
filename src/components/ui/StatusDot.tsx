import { cn } from '../../utils/cn'

export type StatusTone = 'running' | 'completed' | 'failed' | 'pending' | 'cancelled'

const toneStyles: Record<StatusTone, string> = {
  running: 'bg-accent-main-100 animate-pulse',
  completed: 'bg-success-100',
  failed: 'bg-danger-100',
  pending: 'bg-text-500',
  cancelled: 'bg-text-600',
}

const sizeStyles = {
  xs: 'size-1',
  sm: 'size-1.5',
  md: 'size-2',
} as const

interface StatusDotProps {
  tone: StatusTone
  size?: keyof typeof sizeStyles
  className?: string
}

export function StatusDot({ tone, size = 'md', className }: StatusDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block shrink-0 rounded-full', sizeStyles[size], toneStyles[tone], className)}
    />
  )
}
