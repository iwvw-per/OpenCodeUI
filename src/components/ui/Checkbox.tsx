import { forwardRef } from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { cn } from '../../utils/cn'
import { CheckIcon, MinusIcon } from '../Icons'

/**
 * Checkbox - 复选框
 *
 * 基于 Radix Checkbox：支持 indeterminate（半选）与键盘操作。
 */
export const Checkbox = forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded border border-border-200 transition-colors',
        'hover:border-border-300',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-main-100/40',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'data-[state=checked]:bg-accent-main-100 data-[state=checked]:border-accent-main-100 data-[state=checked]:text-oncolor-100',
        'data-[state=indeterminate]:bg-accent-main-100 data-[state=indeterminate]:border-accent-main-100 data-[state=indeterminate]:text-oncolor-100',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        {props.checked === 'indeterminate' ? <MinusIcon size={12} /> : <CheckIcon size={12} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  ),
)
Checkbox.displayName = 'Checkbox'
