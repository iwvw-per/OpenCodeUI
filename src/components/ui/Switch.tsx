import { forwardRef } from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '../../utils/cn'

/**
 * Switch - 开关
 *
 * 基于 Radix Switch：自带 role="switch"、aria-checked 与键盘操作。
 * 视觉沿用 settings Toggle 的规格（36×20，滑块 16）。
 */
export const Switch = forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'group/switch relative inline-flex shrink-0 select-none items-center rounded-full transition-colors',
        'ring-[0.5px] ring-border-200 hover:ring-[1px]',
        'focus-visible:outline focus-visible:outline-[1px] focus-visible:outline-accent-main-100 focus-visible:outline-offset-2',
        'disabled:opacity-45 disabled:cursor-not-allowed',
        'data-[state=checked]:bg-accent-main-100 data-[state=checked]:ring-0 data-[state=checked]:hover:ring-1 data-[state=checked]:hover:ring-accent-main-100/60',
        'data-[state=unchecked]:bg-bg-300',
        className,
      )}
      style={{ width: 36, height: 20, ...props.style }}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-4 rounded-full bg-bg-000 ring-[0.5px] ring-inset ring-border-200',
          'transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-[2px]',
          'data-[state=checked]:ring-0',
        )}
      />
    </SwitchPrimitive.Root>
  ),
)
Switch.displayName = 'Switch'
