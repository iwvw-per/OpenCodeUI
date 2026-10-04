import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AttachmentDetailModal } from './AttachmentDetailModal'
import type { Attachment } from './types'
import { FullscreenProvider } from '../../contexts'

// CodePreview 懒加载依赖 CodeMirror，在假定时器下动态 import 不会解析；
// 用轻量替身让内容直接渲染，测试聚焦 modal 的挂载/关闭过渡行为。
vi.mock('../../components/CodePreview', () => ({
  CodePreview: ({ code }: { code: string }) => <pre>{code}</pre>,
}))

describe('AttachmentDetailModal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb =>
      window.setTimeout(() => cb(performance.now()), 0),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('stays mounted during close transition for text attachments', async () => {
    const attachment: Attachment = {
      id: 'attachment-1',
      type: 'file',
      displayName: 'notes.txt',
      mime: 'text/plain',
      content: 'hello world',
    }

    const { rerender } = render(
      <FullscreenProvider>
        <AttachmentDetailModal attachment={attachment} isOpen={true} onClose={vi.fn()} />
      </FullscreenProvider>,
    )

    // CodePreview 懒加载：先跑定时器，再 flush 动态 import 的微任务
    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(screen.getByText('notes.txt')).toBeInTheDocument()
    expect(screen.getByText('hello world')).toBeInTheDocument()

    rerender(
      <FullscreenProvider>
        <AttachmentDetailModal attachment={attachment} isOpen={false} onClose={vi.fn()} />
      </FullscreenProvider>,
    )

    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(screen.getByText('notes.txt')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument()
  })

  it('exposes zoom controls with accessible labels for image attachments', () => {
    const attachment: Attachment = {
      id: 'attachment-2',
      type: 'file',
      displayName: 'diagram.png',
      mime: 'image/png',
      url: 'https://example.com/diagram.png',
    }

    render(
      <FullscreenProvider>
        <AttachmentDetailModal attachment={attachment} isOpen={true} onClose={vi.fn()} />
      </FullscreenProvider>,
    )

    const image = screen.getByAltText('diagram.png')
    fireEvent.load(image)

    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset (double-click / double-tap)' })).toBeInTheDocument()
  })
})
