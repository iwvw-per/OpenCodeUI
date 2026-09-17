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
  ghost: 'bg-transparent text-text-400 hover:bg-bg-200/60 hover:text-text-100',
  solid: 'bg-accent-main-000 text-oncolor-100 hover:bg-accent-main-200',
  danger: 'bg-transparent text-text-400 hover:bg-danger-100/10 hover:text-danger-100',
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = 'md', variant = 'ghost', className, children, disabled, type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        className={cn(
          'inline-flex shrink-0 items-center justify-center transition-colors duration-150',
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
