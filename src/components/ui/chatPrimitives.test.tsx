import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DisclosureRow } from './DisclosureRow'
import { Spinner } from './Spinner'
import { StatusDot } from './StatusDot'
import { Chip } from './Chip'
import { LoadingState } from './LoadingState'
import { ProgressBar } from './ProgressBar'

describe('DisclosureRow', () => {
  it('exposes expanded state and toggles on click', () => {
    const onClick = vi.fn()
    render(<DisclosureRow expanded={false} onClick={onClick} label="步骤" />)

    const row = screen.getByRole('button', { name: '步骤' })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(row).toHaveClass('rounded-md')

    fireEvent.click(row)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('rotates the chevron with expanded state', () => {
    const { rerender } = render(<DisclosureRow expanded label="步骤" />)
    const chevron = screen.getByRole('button', { name: '步骤' }).querySelector('span[aria-hidden="true"]')
    expect(chevron?.className).not.toContain('-rotate-90')

    rerender(<DisclosureRow expanded={false} label="步骤" />)
    const collapsed = screen.getByRole('button', { name: '步骤' }).querySelector('span[aria-hidden="true"]')
    expect(collapsed?.className).toContain('-rotate-90')
  })

  it('keeps a chevron placeholder when the chevron is hidden', () => {
    render(<DisclosureRow expanded label="步骤" showChevron={false} reserveChevronSpace />)
    const chevron = screen.getByRole('button', { name: '步骤' }).querySelector('span[aria-hidden="true"]')
    expect(chevron?.className).toContain('invisible')
  })

  it('defaults to type=button so it never submits a surrounding form', () => {
    render(<DisclosureRow expanded label="步骤" />)
    expect(screen.getByRole('button', { name: '步骤' })).toHaveAttribute('type', 'button')
  })
})

describe('Spinner', () => {
  it('is decorative and always animated', () => {
    const { container } = render(<Spinner />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg?.getAttribute('class')).toContain('animate-spin')
  })

  it('maps size to a fixed pixel value', () => {
    const { container } = render(<Spinner size="lg" />)
    expect(container.querySelector('svg')).toHaveAttribute('width', '20')
  })

  it('renders the pixel variant as a 3x3 grid', () => {
    const { container } = render(<Spinner variant="pixel" />)
    const root = container.querySelector('[data-loader-variant="pixel"]')
    expect(root).not.toBeNull()
    expect(root?.querySelectorAll('.loader-pixel-cell')).toHaveLength(9)
  })

  it('renders the dots and orbit variants without an svg', () => {
    const { container: dots } = render(<Spinner variant="dots" />)
    expect(dots.querySelectorAll('.loader-dot-cell')).toHaveLength(3)

    const { container: orbit } = render(<Spinner variant="orbit" />)
    expect(orbit.querySelector('.loader-orbit-ring')).not.toBeNull()
  })
})

describe('ProgressBar', () => {
  it('exposes progressbar semantics with a rounded percentage', () => {
    render(<ProgressBar progress={0.68} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '68')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
  })

  it('clamps out-of-range progress', () => {
    const { rerender } = render(<ProgressBar progress={1.4} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    rerender(<ProgressBar progress={-0.2} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('switches to the success color when done', () => {
    const { container } = render(<ProgressBar progress={1} done />)
    const fill = container.querySelector('[role="progressbar"] > div')
    expect(fill?.className).toContain('bg-success-100')
  })
})

describe('StatusDot', () => {
  it('uses the tone color and stays decorative', () => {
    const { container } = render(<StatusDot tone="failed" />)
    const dot = container.firstElementChild
    expect(dot).toHaveAttribute('aria-hidden', 'true')
    expect(dot?.className).toContain('bg-danger-100')
  })

  it('only pulses while running', () => {
    const { container, rerender } = render(<StatusDot tone="running" />)
    expect(container.firstElementChild?.className).toContain('animate-pulse')
    rerender(<StatusDot tone="completed" />)
    expect(container.firstElementChild?.className).not.toContain('animate-pulse')
  })
})

describe('Chip', () => {
  it('applies tone classes without a border', () => {
    render(<Chip tone="accent">运行中</Chip>)
    const chip = screen.getByText('运行中')
    expect(chip.className).toContain('bg-accent-main-100/15')
    expect(chip.className).not.toContain('border')
  })

  it('resets the inherited text-fill-color so it stays readable inside shimmer rows', () => {
    // 回归保护：shimmer 用 -webkit-text-fill-color: transparent 实现，且该属性会继承。
    // chip 嵌在扫光行内时只设 color 覆盖不了它，表现为底色在、文字消失。
    render(<Chip tone="accent">explore</Chip>)
    expect(screen.getByText('explore').className).toContain('[-webkit-text-fill-color:currentColor]')
  })
})

describe('LoadingState', () => {
  it('announces busy state and shows the label', () => {
    render(<LoadingState label="正在加载会话" />)
    expect(screen.getByText('正在加载会话')).toBeInTheDocument()
    expect(screen.getByText('正在加载会话').closest('[aria-busy="true"]')).not.toBeNull()
  })

  it('hides the elapsed counter when disabled', () => {
    const { container } = render(<LoadingState label="加载历史" showElapsed={false} />)
    expect(container.textContent).toBe('加载历史')
  })
})
