import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNow } from './useNow'
import { useMinDurationActive } from './useMinDurationActive'

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not tick while disabled', () => {
    const { result } = renderHook(() => useNow(100, false))
    const initial = result.current

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current).toBe(initial)
  })

  it('shares one timer between subscribers of the same interval', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval')

    const a = renderHook(() => useNow(250, true))
    const b = renderHook(() => useNow(250, true))

    // 同 interval 的第二个订阅者不再新起定时器
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(250)
    })
    // 两个订阅者都拿到同一帧的新时间
    expect(a.result.current).toBe(b.result.current)

    a.unmount()
    // 还有订阅者时定时器不销毁
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    b.unmount()
    // 最后一个订阅者离开后清理
    expect(vi.getTimerCount()).toBe(0)

    setIntervalSpy.mockRestore()
  })
})

describe('useMinDurationActive', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays active for at least the minimum duration after the flag drops', () => {
    const { result, rerender } = renderHook(({ active }) => useMinDurationActive(active, 300), {
      initialProps: { active: true },
    })

    expect(result.current).toBe(true)

    // 立刻结束：视觉上仍保持，避免扫光只闪一帧
    rerender({ active: false })
    expect(result.current).toBe(true)

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current).toBe(false)
  })

  it('reports active immediately when the flag turns on', () => {
    const { result, rerender } = renderHook(({ active }) => useMinDurationActive(active, 300), {
      initialProps: { active: false },
    })

    expect(result.current).toBe(false)

    rerender({ active: true })
    expect(result.current).toBe(true)
  })

  it('does not keep a timer after unmount', () => {
    const { rerender, unmount } = renderHook(({ active }) => useMinDurationActive(active, 300), {
      initialProps: { active: true },
    })

    rerender({ active: false })
    unmount()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(vi.getTimerCount()).toBe(0)
  })
})
