import { forwardRef } from 'react'
import { cn } from '../../utils/cn'

type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg'
type IconButtonVariant = 'ghost' | 'solid' | 'danger'

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize
  variant?: IconButtonVariant
  'aria-label': string
  children: React.ReactNode
}

const sizeStyles: Record<IconButtonSize, string> = {
  xs: 'size-5 rounded',
  sm: 'size-6 rounded-md',
  md: 'size-8 rounded-lg',
  lg: 'size-10 rounded-lg',
}

const variantStyles: Record<IconButtonVariant, string> = {
  // hover 用 ring 而非 border：ring 是 box-shadow，不占布局空间，
  // 不会在 hover 进出时改变尺寸或推动相邻元素。同时加深背景以强化反馈
  // （原先 bg-bg-200/60 叠在 bg-bg-100 上仅约 1.8% 亮度差，浅色主题下几乎不可见）。
  ghost: 'bg-transparent text-text-400 hover:bg-bg-200 hover:text-text-100 hover:ring-1 hover:ring-border-200/70',
  solid: 'bg-accent-main-000 text-oncolor-100 hover:bg-accent-main-200',
  danger: 'bg-transparent text-text-400 hover:bg-danger-100/10 hover:text-danger-100 hover:ring-1 hover:ring-danger-100/30',
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = 'md', variant = 'ghost', className, children, disabled, type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        className={cn(
          // transition-colors 不覆盖 box-shadow，需显式加入以免 ring 突现
          'inline-flex shrink-0 items-center justify-center transition-[color,background-color,box-shadow] duration-150',
          'active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100',
          sizeStyles[size],
          variantStyles[variant],
          className,
        )}
        {...props}
      >
        {children}
      </button>
    )
  },
)

IconButton.displayName = 'IconButton'
