import { forwardRef } from 'react'
import { cn } from '../../utils/cn'
import { interactive } from '../../utils/interaction'
import { SpinnerIcon } from '../Icons'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  isLoading?: boolean
  children: React.ReactNode
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-accent-main-000 hover:bg-accent-main-200 text-oncolor-100',
  secondary: 'bg-bg-200 hover:bg-bg-300 text-text-200 hover:text-text-100',
  ghost: 'bg-transparent hover:bg-bg-200 text-text-300 hover:text-text-100',
  danger: 'bg-danger-100 hover:bg-danger-200 text-oncolor-100',
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-7 px-2 rounded-md text-[length:var(--fs-btn-sm)]',
  md: 'h-8 px-3 rounded-lg text-[length:var(--fs-btn-md)]',
  lg: 'h-10 px-4 rounded-lg text-[length:var(--fs-btn-lg)]',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = 'primary', size = 'md', isLoading = false, className, children, disabled, type = 'button', ...props },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || isLoading}
        className={cn(
          'inline-flex items-center justify-center gap-2 font-medium',
          'transition-[color,background-color,transform] duration-150',
          // 按下时轻微收缩，松手即恢复；禁用态不收缩，避免"还能点"的错觉
          'active:scale-95 disabled:active:scale-100',
          interactive.focusRingCompact,
          interactive.disabled,
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        {...props}
      >
        {isLoading && <SpinnerIcon size={14} className="animate-spin" />}
        {children}
      </button>
    )
  },
)

Button.displayName = 'Button'
