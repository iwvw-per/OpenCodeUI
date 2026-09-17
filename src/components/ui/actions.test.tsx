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
    // 浅色主题下几乎不可见。现统一为全不透明的 bg-bg-200。
    expect(button.className).toContain('hover:bg-bg-200')
    // 不用 border：border 占布局空间，hover 进出会推动相邻元素
    expect(button.className).not.toContain('hover:border')
    // 也不用 ring：ring 在本项目里是「键盘焦点」的专用表达（focus-visible:ring-*），
    // 若 hover 也加 ring，鼠标悬停与键盘聚焦将无法区分。
    expect(button.className).not.toContain('hover:ring')
  })

  it('never changes geometry on press', () => {
    render(
      <IconButton aria-label="刷新" onClick={() => {}}>
        <span>icon</span>
      </IconButton>,
    )
    const button = screen.getByRole('button', { name: '刷新' })
    // 按下反馈只用颜色：scale/translate/rotate 会让元素在按下瞬间改变视觉边界，
    // 在密集列表里表现为相邻元素抖动。
    expect(button.className).not.toMatch(/active:(scale|translate|rotate|skew)/)
  })
})
