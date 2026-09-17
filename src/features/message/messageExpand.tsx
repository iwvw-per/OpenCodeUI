import type { CSSProperties, ReactNode, Ref } from 'react'
import { expandFadeGridClass, expandGridClass, MSG_EXPAND } from './messageExpandShared'

export type MessageExpandVariant = 'height' | 'fade'

export interface MessageExpandPanelProps {
  open: boolean
  children?: ReactNode
  /** height=纯高度；fade=高度+opacity（卡片） */
  variant?: MessageExpandVariant
  animate?: boolean
  /** compositor 桌面/Android 切换时的 panel class */
  panelClassName?: string
  contentRef?: Ref<HTMLDivElement | null>
  /** contentRef 所在的实际 body 节点 class；未提供时 ref 仍挂在 inner shell */
  contentClassName?: string
  /** 横向放行 clip，思考/过程壳用 */
  clip?: boolean
  className?: string
  innerClassName?: string
}

/**
 * 共享展开壳：grid 动画 + overflow 内层
 * 子节点是否挂载由调用方 useMessageExpandRender / compositor keepMounted 控制
 */
export function MessageExpandPanel({
  open,
  children,
  variant = 'height',
  animate = true,
  panelClassName = MSG_EXPAND.panel,
  contentRef,
  contentClassName,
  clip = false,
  className,
  innerClassName = 'min-h-0 min-w-0 overflow-hidden',
}: MessageExpandPanelProps) {
  const outerClass =
    variant === 'fade'
      ? expandFadeGridClass(open)
      : expandGridClass(open, animate, panelClassName)
  const style: CSSProperties | undefined = clip ? { clipPath: MSG_EXPAND.clipPath } : undefined

  return (
    <div className={className ? `${outerClass} ${className}` : outerClass}>
      <div ref={contentClassName ? undefined : contentRef} className={innerClassName} style={style}>
        {contentClassName ? (
          <div ref={contentRef} className={contentClassName}>
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
