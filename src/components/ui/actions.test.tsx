import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IconButton } from './IconButton'
import { ContextMenuItem } from './ContextMenuItem'

describe('IconButton', () => {
  it('requires an accessible label and renders as a button', () => {
    render(
      <IconButton aria-label="刷新" onClick={() => {}}>
        <span>icon</span>
      </IconButton>,
    )
    const button = screen.getByRole('button', { name: '刷新' })
    expect(button).toHaveAttribute('type', 'button')
  })

  it('emits click and respects disabled', () => {
    const onClick = vi.fn()
    render(
      <IconButton aria-label="删除" disabled onClick={onClick}>
        <span>icon</span>
      </IconButton>,
    )
    const button = screen.getByRole('button', { name: '删除' })
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
    expect(button).toBeDisabled()
  })

  it('supports size and tone variants without losing className overrides', () => {
    render(
      <IconButton aria-label="删除" size="sm" variant="danger" className="size-9">
        <span>icon</span>
      </IconButton>,
    )
    const button = screen.getByRole('button', { name: '删除' })
    // 调用方的 size-9 应覆盖默认尺寸，而不是并存
    expect(button.className).toContain('size-9')
    expect(button.className).not.toContain('size-6')
    expect(button.className).toContain('hover:text-danger-100')
  })
})

describe('ContextMenuItem', () => {
  it('renders label, icon and hint', () => {
    render(
      <ContextMenuItem icon={<span data-testid="icon" />} hint="Ctrl+K">
        新建终端
      </ContextMenuItem>,
    )
    expect(screen.getByRole('button')).toHaveTextContent('新建终端')
    expect(screen.getByText('Ctrl+K')).toBeInTheDocument()
    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('applies danger tone and forwards click', () => {
    const onClick = vi.fn()
    render(
      <ContextMenuItem tone="danger" onClick={onClick}>
        删除
      </ContextMenuItem>,
    )
    const button = screen.getByRole('button')
    expect(button.className).toContain('text-danger-100')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalled()
  })
  it('gives ghost buttons a visible hover affordance', () => {
    render(
      <IconButton aria-label="刷新" onClick={() => {}}>
        <span>icon</span>
      </IconButton>,
    )
    const button = screen.getByRole('button', { name: '刷新' })
    // 回归保护：此前 hover 仅用 bg-bg-200/60，叠在 bg-bg-100 上约 1.8% 亮度差，
    // 浅色主题下几乎不可见。现在同时加深背景并加 ring 边框。
    expect(button.className).toContain('hover:bg-bg-200')
    expect(button.className).toContain('hover:ring-1')
    // 用 ring 而非 border，避免占布局空间导致 hover 时元素位移
    expect(button.className).not.toContain('hover:border')
  })
})
