import { beforeEach, describe, expect, it, vi } from 'vitest'
import { workStatusStore } from './workStatusStore'

describe('workStatusStore', () => {
  beforeEach(() => {
    localStorage.clear()
    workStatusStore.reset()
  })

  it('starts enabled with all sections visible and default expansion', () => {
    expect(workStatusStore.isEnabled()).toBe(true)
    expect(workStatusStore.isSectionVisible('session')).toBe(true)
    expect(workStatusStore.isSectionExpanded('tasks')).toBe(true)
    expect(workStatusStore.isSectionExpanded('unknown-section')).toBe(false)
  })

  it('toggles enabled and notifies subscribers', () => {
    const listener = vi.fn()
    workStatusStore.subscribe(listener)

    workStatusStore.toggleEnabled()
    expect(workStatusStore.isEnabled()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)

    workStatusStore.toggleEnabled()
    expect(workStatusStore.isEnabled()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('hides and shows a section', () => {
    workStatusStore.setSectionVisible('todos', false)
    expect(workStatusStore.isSectionVisible('todos')).toBe(false)

    workStatusStore.setSectionVisible('todos', true)
    expect(workStatusStore.isSectionVisible('todos')).toBe(true)
  })

  it('does not notify when a visibility write is a no-op', () => {
    const listener = vi.fn()
    workStatusStore.subscribe(listener)
    // todos 默认可见，再设为可见应无变化
    workStatusStore.setSectionVisible('todos', true)
    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps the order complete and drops unknown ids', () => {
    workStatusStore.setSectionOrder(['todos', 'session', 'bogus'])
    const order = workStatusStore.getSectionOrder()
    // 无效 id 被剔除，且顺序保留全部合法板块（新增板块追加末尾）
    expect(order).toContain('todos')
    expect(order).toContain('session')
    expect(order).not.toContain('bogus')
    expect(order.indexOf('todos')).toBeLessThan(order.indexOf('session'))
  })

  it('stores scroll position in memory only (does not persist)', () => {
    workStatusStore.setScrollTop(120)
    expect(workStatusStore.getScrollTop()).toBe(120)
  })

  it('reset restores defaults and clears subscribers', () => {
    workStatusStore.setEnabled(false)
    workStatusStore.setSectionVisible('session', false)
    workStatusStore.setScrollTop(50)
    const listener = vi.fn()
    workStatusStore.subscribe(listener)

    workStatusStore.reset()

    expect(workStatusStore.isEnabled()).toBe(true)
    expect(workStatusStore.isSectionVisible('session')).toBe(true)
    expect(workStatusStore.getScrollTop()).toBe(0)

    // 订阅者已清空：后续写入不应再回调旧监听
    workStatusStore.setEnabled(false)
    expect(listener).not.toHaveBeenCalled()
  })
})
