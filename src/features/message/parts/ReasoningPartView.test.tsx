import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReasoningPartView } from './ReasoningPartView'
import type { ReasoningPart } from '../../../types/message'

let mockReasoningDisplayMode: 'italic' | 'markdown' | 'capsule' | 'ticker' | 'block' = 'italic'

vi.mock('../../../hooks', () => ({
  useDelayedRender: (show: boolean) => show,
  useDisclosureScrollLock: () => ({
    rootRef: () => undefined,
    headerRef: () => undefined,
    withScrollLock: (action: () => void) => action(),
  }),
}))

vi.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({ reasoningDisplayMode: mockReasoningDisplayMode }),
}))

vi.mock('../../../components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="markdown-content">{content}</div>,
}))

describe('ReasoningPartView', () => {
  beforeEach(() => {
    mockReasoningDisplayMode = 'italic'
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb =>
      window.setTimeout(() => cb(performance.now()), 16),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('auto-expands while streaming in italic mode', () => {
    const part = {
      id: 'reason-1',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: 'thinking through steps...',
      time: { start: 1 },
    } as unknown as ReasoningPart

    render(<ReasoningPartView part={part} isStreaming={true} />)

    act(() => {
      vi.advanceTimersByTime(32)
    })

    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument()
    const thinking = screen.getByText('Thinking...')
    expect(thinking).toBeInTheDocument()
    expect(thinking.className).toContain('reasoning-shimmer-text')
    expect(thinking.className).toContain('inline-block')
    expect(thinking.className).toContain('italic')
    expect(thinking.className).not.toContain('text-text-200')
    expect(screen.getAllByText('thinking through steps...').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('markdown-content')).not.toBeInTheDocument()
  })

  it('renders markdown content in markdown reasoning mode', () => {
    mockReasoningDisplayMode = 'markdown'

    const part = {
      id: 'reason-2',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: 'Use **bold** and `code` here',
      time: { start: 1, end: 100 },
    } as unknown as ReasoningPart

    render(<ReasoningPartView part={part} isStreaming={false} />)

    expect(screen.getByTestId('markdown-content')).toHaveTextContent('Use **bold** and `code` here')
  })

  it('renders collapsed markdown preview for multiline content', () => {
    mockReasoningDisplayMode = 'markdown'

    const part = {
      id: 'reason-2b',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: 'First line with **bold**\nSecond line with `code`',
      time: { start: 1, end: 100 },
    } as unknown as ReasoningPart

    render(<ReasoningPartView part={part} isStreaming={false} />)

    act(() => {
      vi.advanceTimersByTime(32)
    })

    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument()
    // 折叠时只渲染第一行 markdown，并走 Markdown 渲染
    expect(screen.getByTestId('markdown-content')).toHaveTextContent('First line with **bold**')
    expect(screen.getByTestId('markdown-content')).not.toHaveTextContent('Second line')
  })

  it('renders single-line content without toggle button', () => {
    const part = {
      id: 'reason-3',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: 'short',
      time: { start: 1, end: 100 },
    } as unknown as ReasoningPart

    render(<ReasoningPartView part={part} isStreaming={false} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getAllByText('short').length).toBeGreaterThan(0)
  })

  it('renders a single non-expandable line while streaming in ticker mode', () => {
    mockReasoningDisplayMode = 'ticker'

    const part = {
      id: 'reason-ticker-1',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: 'first line\nsecond line still streaming',
      time: { start: 1 },
    } as unknown as ReasoningPart

    render(<ReasoningPartView part={part} isStreaming={true} />)

    act(() => {
      vi.advanceTimersByTime(32)
    })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('markdown-content')).not.toBeInTheDocument()
    const lines = screen.getAllByText('first line second line still streaming')
    const line = lines.find(el => el.className.includes('whitespace-nowrap'))
    expect(line).toBeDefined()
    expect(line?.className).toContain('reasoning-shimmer-text')
  })

  it('shows the tail of long text while streaming in ticker mode', () => {
    mockReasoningDisplayMode = 'ticker'

    const tail = 'the newest reasoning tail'
    const part = {
      id: 'reason-ticker-2',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: `${'x'.repeat(400)}${tail}`,
      time: { start: 1 },
    } as unknown as ReasoningPart

    render(<ReasoningPartView part={part} isStreaming={true} />)

    act(() => {
      vi.advanceTimersByTime(32)
    })

    const lines = screen.getAllByText(/the newest reasoning tail$/)
    const line = lines.find(el => el.className.includes('whitespace-nowrap'))
    expect(line?.textContent?.endsWith(tail)).toBe(true)
    expect(line?.textContent?.length).toBe(220)
  })

  it('falls back to the expandable summary once ticker streaming ends', () => {
    mockReasoningDisplayMode = 'ticker'

    const part = {
      id: 'reason-ticker-3',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: 'First line with **bold**\nSecond line with `code`',
      time: { start: 1, end: 100 },
    } as unknown as ReasoningPart

    render(<ReasoningPartView part={part} isStreaming={false} />)

    act(() => {
      vi.advanceTimersByTime(32)
    })

    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument()
    expect(screen.getByTestId('markdown-content')).toHaveTextContent('First line with **bold**')
  })

  it('renders a fixed-height scrolling block while streaming in block mode', () => {
    mockReasoningDisplayMode = 'block'

    const part = {
      id: 'reason-block-1',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: 'line one\nline two\nline three',
      time: { start: 1 },
    } as unknown as ReasoningPart

    const { container } = render(<ReasoningPartView part={part} isStreaming={true} />)

    act(() => {
      vi.advanceTimersByTime(32)
    })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('markdown-content')).not.toBeInTheDocument()
    // 内容由 ref 直接写入 DOM：已完成整行冻结为独立块，最后一行留在活跃尾行
    const inner = container.querySelector('div.block')
    expect(inner).not.toBeNull()
    expect(inner?.textContent).toContain('line one')
    expect(inner?.textContent).toContain('line three')
  })

  it('falls back to the expandable summary once block streaming ends', () => {
    mockReasoningDisplayMode = 'block'

    const part = {
      id: 'reason-block-2',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: 'First line with **bold**\nSecond line with `code`',
      time: { start: 1, end: 100 },
    } as unknown as ReasoningPart

    render(<ReasoningPartView part={part} isStreaming={false} />)

    act(() => {
      vi.advanceTimersByTime(32)
    })

    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument()
    expect(screen.getByTestId('markdown-content')).toHaveTextContent('First line with **bold**')
  })

  it('keeps the block mounted during the collapse animation before showing the summary', () => {
    mockReasoningDisplayMode = 'block'

    const streamingPart = {
      id: 'reason-block-3',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: 'streaming line one\nstreaming line two',
      time: { start: 1 },
    } as unknown as ReasoningPart

    const { container, rerender } = render(<ReasoningPartView part={streamingPart} isStreaming={true} />)

    act(() => {
      vi.advanceTimersByTime(32)
    })
    expect(container.querySelector('div.block')).not.toBeNull()

    // 流式结束：进入收尾动画窗口，块仍挂载（带高度收拢 transition），尚未切到摘要
    const endedPart = { ...streamingPart, time: { start: 1, end: 100 } } as unknown as ReasoningPart
    rerender(<ReasoningPartView part={endedPart} isStreaming={false} />)

    const collapsing = container.querySelector('div.block')
    expect(collapsing).not.toBeNull()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    // 动画走完后切回可展开摘要
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument()
  })
})
