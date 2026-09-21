import { forwardRef } from 'react'
import { LoaderCircle } from 'lucide-react'
import { cn } from '../../utils/cn'

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg'
export type SpinnerTone = 'muted' | 'accent' | 'current'
export type SpinnerVariant = 'ring' | 'pixel' | 'dots' | 'orbit'

const sizeMap: Record<SpinnerSize, number> = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 20,
}

const toneStyles: Record<SpinnerTone, string> = {
  muted: 'text-text-400',
  accent: 'text-accent-main-100',
  current: '',
}

interface SpinnerProps extends Omit<React.SVGProps<SVGSVGElement>, 'children'> {
  size?: SpinnerSize
  tone?: SpinnerTone
  /** ring（默认圆环）/ pixel（网格）/ dots（三点）/ orbit（轨道） */
  variant?: SpinnerVariant
  className?: string
}

export const Spinner = forwardRef<SVGSVGElement, SpinnerProps>(
  ({ size = 'md', tone = 'muted', variant = 'ring', className, ...props }, ref) => {
    if (variant === 'ring') {
      return (
        <LoaderCircle
          ref={ref}
          size={sizeMap[size]}
          aria-hidden="true"
          className={cn('animate-spin shrink-0', toneStyles[tone], className)}
          {...(props as React.ComponentProps<typeof LoaderCircle>)}
        />
      )
    }

    return (
      <span
        aria-hidden="true"
        data-loader-variant={variant}
        className={cn('inline-flex shrink-0 items-center justify-center', toneStyles[tone], className)}
      >
        {variant === 'pixel' && <PixelGrid cell={size === 'lg' ? 4 : 3} />}
        {variant === 'dots' && <Dots cell={size === 'lg' ? 4 : 3} />}
        {variant === 'orbit' && <Orbit box={size === 'lg' ? 16 : 12} />}
      </span>
    )
  },
)
Spinner.displayName = 'Spinner'

function PixelGrid({ cell }: { cell: number }) {
  return (
    <span className="grid grid-cols-3" style={{ gap: 1 }}>
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className="loader-pixel-cell rounded-[0.5px] bg-current"
          style={{
            width: cell,
            height: cell,
            animationDelay: `${(i % 3) * 0.12 + Math.floor(i / 3) * 0.12}s`,
          }}
        />
      ))}
    </span>
  )
}

function Dots({ cell }: { cell: number }) {
  return (
    <span className="flex items-end" style={{ gap: 3 }}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="loader-dot-cell rounded-full bg-current"
          style={{ width: cell, height: cell, animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  )
}

function Orbit({ box }: { box: number }) {
  const dot = Math.max(3, Math.round(box / 4))
  return (
    <span
      className="loader-orbit-ring relative block rounded-full border border-current/25"
      style={{ width: box, height: box }}
    >
      <span
        className="absolute left-1/2 -translate-x-1/2 rounded-full bg-current"
        style={{ top: -dot / 2, width: dot, height: dot }}
      />
    </span>
  )
}
