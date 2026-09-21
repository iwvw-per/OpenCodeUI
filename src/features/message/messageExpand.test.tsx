import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { EXPAND_MOTION } from '../../constants/expandMotion'
import { MessageExpandPanel } from './messageExpand'
import { chevronClass, expandFadeGridClass, expandGridClass, MSG_EXPAND } from './messageExpandShared'

describe('messageExpand', () => {
  it('keeps panel transition aligned with global expand motion', () => {
    expect(MSG_EXPAND.panel).toBe(EXPAND_MOTION.gridTransition)
    expect(MSG_EXPAND.unmountDelayMs).toBe(EXPAND_MOTION.unmountDelayMs)
  })

  it('builds open and closed grid classes', () => {
    expect(expandGridClass(true)).toBe(`grid ${MSG_EXPAND.panel} grid-rows-[1fr]`)
    expect(expandGridClass(false)).toBe(`grid ${MSG_EXPAND.panel} grid-rows-[0fr]`)
    expect(expandGridClass(true, false)).toBe('grid grid-rows-[1fr]')
    expect(expandGridClass(true, true, 'custom-panel')).toBe('grid custom-panel grid-rows-[1fr]')
  })

  it('builds fade grid and chevron classes', () => {
    expect(expandFadeGridClass(true)).toContain('opacity-100')
    expect(expandFadeGridClass(false)).toContain('opacity-0')
    expect(chevronClass(true)).not.toContain('-rotate-90')
    expect(chevronClass(false)).toContain('-rotate-90')
    expect(chevronClass(false, 'sm')).toContain('h-5')
    expect(chevronClass(false, 'md')).toContain('w-4')
  })

  it('renders shared expand panel shell', () => {
    render(
      <MessageExpandPanel open clip>
        <span>body</span>
      </MessageExpandPanel>,
    )
    expect(screen.getByText('body')).toBeInTheDocument()
    const outer = screen.getByText('body').parentElement?.parentElement
    expect(outer?.className).toContain('grid-rows-[1fr]')
  })

  it('keeps compositor refs on the actual body node when requested', () => {
    const contentRef = createRef<HTMLDivElement>()
    render(
      <MessageExpandPanel open contentRef={contentRef} contentClassName="body-padding" innerClassName="overflow-hidden">
        <span>body</span>
      </MessageExpandPanel>,
    )

    expect(contentRef.current?.className).toBe('body-padding')
    expect(contentRef.current?.parentElement?.className).toBe('overflow-hidden')
  })

  it('marks the collapsed body inert so its controls stay out of tab order', () => {
    // 回归保护：收起后内容仍留在 DOM（unmount 有延迟，keepMounted 场景常驻），
    // 不加 inert 时键盘用户会 Tab 进高度为 0 的隐藏内容。
    const { container, rerender } = render(
      <MessageExpandPanel open={false}>
        <button type="button">hidden action</button>
      </MessageExpandPanel>,
    )

    const body = container.querySelector('.overflow-hidden') as HTMLElement | null
    expect(body).not.toBeNull()
    expect(body?.hasAttribute('inert')).toBe(true)

    rerender(
      <MessageExpandPanel open>
        <button type="button">hidden action</button>
      </MessageExpandPanel>,
    )
    expect((container.querySelector('.overflow-hidden') as HTMLElement).hasAttribute('inert')).toBe(false)
  })
})
