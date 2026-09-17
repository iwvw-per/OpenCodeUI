import { forwardRef } from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '../../utils/cn'

/**
 * Tabs - 分段控件/标签切换
 *
 * 基于 Radix Tabs：键盘方向键切换、ARIA role 与焦点管理由原语负责，
 * 样式走项目设计令牌。三种视觉风格：
 *   - segmented（默认）：胶囊分段控件，浅底 + 主文字色
 *   - slider：胶囊分段 + 滑块位移动画（用于设置项等需要更强反馈的场景）
 *   - underline：下划线式，用于内容区顶部导航
 */
export type TabsVariant = 'segmented' | 'slider' | 'underline'
export type TabsSize = 'sm' | 'md'

const listBase: Record<TabsVariant, string> = {
  segmented: 'inline-flex items-center gap-0.5 rounded-lg border border-border-200/60 bg-bg-200/40 p-0.5',
  slider: 'relative isolate inline-flex items-center gap-0 border border-border-200/40 bg-bg-200/60 p-1',
  underline: 'flex items-center gap-1 border-b border-border-200',
}

const triggerBase = 'inline-flex items-center gap-1 whitespace-nowrap transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main-100/40 disabled:opacity-40 disabled:cursor-not-allowed'

const triggerVariant: Record<TabsVariant, { base: string; active: string; inactive: string }> = {
  segmented: {
    base: 'rounded-md font-semibold uppercase tracking-wider',
    // 浅底 + 主文字色：与 TaskRenderer / ProjectSelector 的既有写法一致，
    // 全主题下激活态对比度 >= 9.9:1（原 bg-accent-main-100 + 白字仅 2.1~6.2:1）。
    active: 'bg-accent-main-100/15 text-text-100',
    inactive: 'text-text-500 hover:text-text-300',
  },
  slider: {
    // 激活态由 TabsList 的滑动指示层呈现，trigger 自身只负责文字色。
    // 在 grid 布局下需要自己居中内容。
    base: 'relative z-10 justify-center rounded-md font-medium',
    active: 'text-text-100',
    inactive: 'text-text-400 hover:text-text-200',
  },
  underline: {
    base: 'border-b-2 -mb-px font-medium',
    active: 'border-accent-main-100 text-text-100',
    inactive: 'border-transparent text-text-500 hover:text-text-300',
  },
}

const triggerSize: Record<TabsSize, string> = {
  sm: 'px-2 py-1 text-[length:var(--fs-xxs)]',
  md: 'px-2.5 py-1.5 text-[length:var(--fs-xs)]',
}

interface TabsProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> {
  variant?: TabsVariant
  size?: TabsSize
}

export const Tabs = forwardRef<React.ElementRef<typeof TabsPrimitive.Root>, TabsProps>(
  ({ className, variant = 'segmented', size = 'sm', ...props }, ref) => (
    <TabsPrimitive.Root ref={ref} className={cn('flex flex-col', className)} data-variant={variant} data-size={size} {...props} />
  ),
)
Tabs.displayName = 'Tabs'

type TabsListProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
  variant?: TabsVariant
  /** slider 变体专用：激活项索引与总项数，用于定位滑动指示层。 */
  activeIndex?: number
  itemCount?: number
}

export const TabsList = forwardRef<React.ElementRef<typeof TabsPrimitive.List>, TabsListProps>(
  ({ className, variant = 'segmented', activeIndex, itemCount, children, style, ...props }, ref) => {
    const showSlider = variant === 'slider' && typeof activeIndex === 'number' && typeof itemCount === 'number' && itemCount > 0
    return (
      <TabsPrimitive.List
        ref={ref}
        className={cn(listBase[variant], showSlider && 'grid', className)}
        style={showSlider ? { gridTemplateColumns: `repeat(${itemCount}, minmax(0, 1fr))`, ...style } : style}
        {...props}
      >
        {showSlider && (
          <div
            aria-hidden
            className="absolute top-1 bottom-1 left-1 -z-10 rounded-md bg-bg-000 shadow-sm transition-transform duration-300 ease-out"
            style={{
              width: `calc((100% - 8px) / ${itemCount})`,
              transform: `translateX(${activeIndex * 100}%)`,
            }}
          />
        )}
        {children}
      </TabsPrimitive.List>
    )
  },
)
TabsList.displayName = 'TabsList'

type TabsTriggerProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
  variant?: TabsVariant
  size?: TabsSize
}

const triggerActive: Record<TabsVariant, string> = {
  segmented: 'data-[state=active]:bg-accent-main-100/15 data-[state=active]:text-text-100',
  slider: 'data-[state=active]:text-text-100',
  underline: 'data-[state=active]:border-accent-main-100 data-[state=active]:text-text-100',
}

export const TabsTrigger = forwardRef<React.ElementRef<typeof TabsPrimitive.Trigger>, TabsTriggerProps>(
  ({ className, variant = 'segmented', size = 'sm', ...props }, ref) => (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        triggerBase,
        triggerVariant[variant].base,
        triggerSize[size],
        triggerVariant[variant].inactive,
        // Radix 用 data-state 标记激活态，无需在调用方重复传递状态。
        triggerActive[variant],
        className,
      )}
      {...props}
    />
  ),
)
TabsTrigger.displayName = 'TabsTrigger'

export const TabsContent = forwardRef<React.ElementRef<typeof TabsPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(
  ({ className, ...props }, ref) => (
    <TabsPrimitive.Content ref={ref} className={cn('focus-visible:outline-none', className)} {...props} />
  ),
)
TabsContent.displayName = 'TabsContent'
