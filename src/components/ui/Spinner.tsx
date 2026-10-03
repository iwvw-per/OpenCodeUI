import { forwardRef } from 'react'
import { LoaderCircle } from 'lucide-react'
import { cn } from '../../utils/cn'

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg'
export type SpinnerTone = 'muted' | 'accent' | 'current'
export type SpinnerVariant = 'ring' | 'pixel' | 'dots' | 'orbit' | 'grid-orbit' | 'drive'

const sizeMap: Record<SpinnerSize, number> = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 20,
}

/** 网格类变体的单格边长：随 size 档位放大，与消息流放大的工具图标视觉对齐。
 *  xs 保持 3px，避免侧栏搜索框内 14px 的小 spinner 溢出。 */
const gridCellBySize: Record<SpinnerSize, number> = {
  xs: 3,
  sm: 4,
  md: 4,
  lg: 5,
}

const toneStyles: Record<SpinnerTone, string> = {
  muted: 'text-text-400',
  accent: 'text-accent-main-100',
  current: '',
}

interface SpinnerProps extends Omit<React.SVGProps<SVGSVGElement>, 'children'> {
  size?: SpinnerSize
  tone?: SpinnerTone
  /** ring（默认圆环）/ pixel（网格对角波）/ dots（三点）/ orbit（轨道）/ grid-orbit（网格绕行）/ drive（网格右行波浪） */
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
        {variant === 'pixel' && <PixelGrid cell={gridCellBySize[size]} />}
        {variant === 'drive' && <PixelGrid cell={gridCellBySize[size]} variant="drive" />}
        {variant === 'dots' && <Dots cell={size === 'lg' ? 4 : 3} />}
        {variant === 'orbit' && <Orbit box={size === 'lg' ? 16 : 12} />}
        {variant === 'grid-orbit' && <GridOrbit cell={gridCellBySize[size]} />}
      </span>
    )
  },
)
Spinner.displayName = 'Spinner'

export interface PixelGridProps {
  /** 单个格子的边长（px）。 */
  cell: number
  /**
   * 是否逐个闪烁。false 时九格常亮，用于「已完成」这类静态状态，
   * 与闪烁变体共用同一套几何，视觉上能看出是同一个图标的不同阶段。
   */
  animated?: boolean
  /**
   * 动画形态：diagonal（默认，对角波）/ drive（Drive 右行波浪，每格延迟按
   * 「列 + 到中行的距离」递增，形成向左凸的箭头向右推进）。
   */
  variant?: 'diagonal' | 'drive'
  className?: string
}

/* Drive 波浪：列 + 到中行的距离 决定延迟，形成向左凸出的箭头，一道接一道向右推进。 */
const PIXEL_DRIVE_DELAY_MS = Array.from({ length: 9 }, (_, i) => {
  const row = Math.floor(i / 3)
  const col = i % 3
  return (col + Math.abs(row - 1)) * 90
})

export function PixelGrid({ cell, animated = true, variant = 'diagonal', className }: PixelGridProps) {
  const isDrive = variant === 'drive'
  const cellClass = isDrive ? 'loader-drive-cell' : 'loader-pixel-cell'
  return (
    <span className={cn('grid grid-cols-3', className)} style={{ gap: 1 }}>
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className={cn('rounded-[0.5px] bg-current', animated && cellClass)}
          style={{
            width: cell,
            height: cell,
            ...(animated
              ? {
                  animationDelay: isDrive
                    ? `${PIXEL_DRIVE_DELAY_MS[i]}ms`
                    : `${(i % 3) * 0.12 + Math.floor(i / 3) * 0.12}s`,
                }
              : null),
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

/**
 * 3x3 网格绕行：一颗光点沿网格外圈 8 格依次点亮（顺时针），
 * 中心格保持暗态，视觉上像彗星绕网格跑一圈。
 * 每格错开 110ms，动画周期 0.95s，共 8 格刚好首尾相接。
 */
const GRID_ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3]

function GridOrbit({ cell }: { cell: number }) {
  const delayByIndex = new Map<number, number>()
  GRID_ORBIT_ORDER.forEach((gridIndex, order) => delayByIndex.set(gridIndex, order * 110))

  return (
    <span className="grid grid-cols-3" style={{ gap: 1.5 }}>
      {Array.from({ length: 9 }, (_, i) => {
        const delay = delayByIndex.get(i)
        const isOrbitCell = delay !== undefined
        return (
          <span
            key={i}
            className={cn('rounded-[1px] bg-current', isOrbitCell && 'loader-grid-orbit-cell')}
            style={{
              width: cell,
              height: cell,
              opacity: isOrbitCell ? 0.12 : 0.07,
              ...(isOrbitCell ? { animationDelay: `${delay}ms` } : null),
            }}
          />
        )
      })}
    </span>
  )
}
