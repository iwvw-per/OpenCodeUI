import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs'
import { Switch } from './Switch'
import { Checkbox } from './Checkbox'
import { Input, Textarea } from './Input'

describe('Tabs', () => {
  it('switches the active panel on click', () => {
    render(
      <Tabs defaultValue="hosts">
        <TabsList>
          <TabsTrigger value="hosts">主机</TabsTrigger>
          <TabsTrigger value="projects">项目</TabsTrigger>
        </TabsList>
        <TabsContent value="hosts">主机内容</TabsContent>
        <TabsContent value="projects">项目内容</TabsContent>
      </Tabs>,
    )

    // Radix 只为激活面板渲染内容，非激活面板节点仍在 DOM 但内容为空。
    expect(screen.getByText('主机内容')).toBeInTheDocument()

    // Radix Tabs 在 mouseDown 上激活（比 click 响应更快），测试需按此触发。
    act(() => {
      fireEvent.mouseDown(screen.getByRole('tab', { name: '项目' }))
    })
    expect(screen.getByRole('tab', { name: '项目' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByText('项目内容')).toBeInTheDocument()
  })

  it('exposes active state via data-state for styling', () => {
    render(
      <Tabs defaultValue="hosts">
        <TabsList>
          <TabsTrigger value="hosts">主机</TabsTrigger>
          <TabsTrigger value="projects">项目</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    expect(screen.getByRole('tab', { name: '主机' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByRole('tab', { name: '项目' })).toHaveAttribute('data-state', 'inactive')
  })

  it('does not rely on a high-saturation solid accent background', () => {
    render(
      <Tabs defaultValue="hosts">
        <TabsList>
          <TabsTrigger value="hosts">主机</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const tab = screen.getByRole('tab', { name: '主机' })
    // 回归保护：激活态曾用 bg-accent-main-100 + 白字（各主题下对比度最低仅 2.1:1）。
    expect(tab.className).not.toContain('text-white')
    expect(tab.className).toContain('bg-accent-main-100/15')
    expect(tab.className).toContain('text-text-100')
  })

  it('exposes proper tablist semantics for keyboard navigation', () => {
    render(
      <Tabs defaultValue="hosts">
        <TabsList>
          <TabsTrigger value="hosts">主机</TabsTrigger>
          <TabsTrigger value="projects">项目</TabsTrigger>
        </TabsList>
        <TabsContent value="hosts">主机内容</TabsContent>
        <TabsContent value="projects">项目内容</TabsContent>
      </Tabs>,
    )
    // 键盘方向键切换由 Radix 原语保证；这里只锁定它所需的 ARIA 结构，
    // 避免我们在封装里不小心破坏语义（tablist/aria-selected/tabpanel 关联）。
    // 注：trigger 的 tabindex 由 Radix 在 TabList 获得焦点后才调整，不在此断言。
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
    expect(tabs[0]).toHaveAttribute('aria-controls')
    // 只有激活面板带 role="tabpanel"，非激活面板节点仍在 DOM 但不暴露该角色。
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  })
})

describe('Switch', () => {
  it('reports state to assistive tech and emits change', () => {
    const onChange = vi.fn()
    render(<Switch aria-label="启用" onCheckedChange={onChange} />)

    const control = screen.getByRole('switch', { name: '启用' })
    expect(control).toHaveAttribute('data-state', 'unchecked')

    fireEvent.click(control)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('Checkbox', () => {
  it('renders as a checkbox and emits change', () => {
    const onChange = vi.fn()
    render(<Checkbox aria-label="同意" onCheckedChange={onChange} />)

    fireEvent.click(screen.getByRole('checkbox', { name: '同意' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('Input and Textarea', () => {
  it('accepts typing and lets className override defaults', () => {
    render(<Input aria-label="名称" className="px-5" />)
    const input = screen.getByLabelText('名称')
    fireEvent.change(input, { target: { value: 'hello' } })
    expect(input).toHaveValue('hello')
    // tailwind-merge 应让调用方的 px-5 覆盖默认 px-2.5，而不是并存
    expect(input.className).toContain('px-5')
    expect(input.className).not.toContain('px-2.5')
  })

  it('renders a textarea', () => {
    render(<Textarea aria-label="说明" />)
    expect(screen.getByLabelText('说明').tagName).toBe('TEXTAREA')
  })
})
