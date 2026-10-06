/**
 * 回归：已在顶部时上滚必须置 userScrolled。
 *
 * 背景：ChatArea 的上滑加载历史判定依赖 `userScrolledRef.current === true`
 * （onScroll / onWheel 两处都有这道门）。而 useAutoScroll 原本只在
 * 「scrollTop 真的下降」时才确认 userScrolled：
 *
 *   if (el.scrollTop < from) { ...setScrolled(true) }
 *
 * 当用户已经滚到 scrollTop === 0 时，scrollTop 无法再下降，于是
 * userScrolled 永远为 false，上滑加载历史的判定永远不成立 ——
 * 表现为「会话最前面几轮看不到，怎么往上滚都不加载」。
 *
 * 修复：在顶部（scrollTop <= 0）时，上滚手势本身就是「用户想往上看」的
 * 确证，直接置位，不再等待永远不可能到来的「scrollTop 下降」确认。
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAutoScroll } from './useAutoScroll'

/** 造一个可控的滚动容器：可设 scrollHeight/clientHeight/scrollTop */
function makeScrollEl(init: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollHeight', { value: init.scrollHeight, writable: true, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: init.clientHeight, writable: true, configurable: true })
  el.scrollTop = init.scrollTop
  document.body.appendChild(el)
  return el
}

function wheel(deltaY: number): WheelEvent {
  return new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
}

describe('useAutoScroll userScrolled 判定', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('sets userScrolled when scrolling up while already at the top', () => {
    const el = makeScrollEl({ scrollHeight: 3000, clientHeight: 800, scrollTop: 0 })
    const { result } = renderHook(() => useAutoScroll(10))

    act(() => {
      result.current.setScrollRef(el)
    })
    expect(result.current.userScrolledRef.current).toBe(false)

    // 已在顶部上滚：scrollTop 无法再下降
    act(() => {
      result.current.handleWheel(wheel(-120))
    })

    expect(result.current.userScrolledRef.current).toBe(true)
  })

  it('still sets userScrolled when scrolling up from a non-zero offset', () => {
    const el = makeScrollEl({ scrollHeight: 3000, clientHeight: 800, scrollTop: 600 })
    const { result } = renderHook(() => useAutoScroll(10))

    act(() => {
      result.current.setScrollRef(el)
    })
    act(() => {
      result.current.handleWheel(wheel(-120))
    })
    // 记录待确认位置，真实滚动发生后由 scroll 事件确认
    expect(result.current.userScrolledRef.current).toBe(false)

    act(() => {
      el.scrollTop = 400
      result.current.handleScroll()
    })
    expect(result.current.userScrolledRef.current).toBe(true)
  })

  it('keeps userScrolled false for a tiny upward nudge (escape dead zone)', () => {
    const el = makeScrollEl({ scrollHeight: 3000, clientHeight: 800, scrollTop: 2200 })
    const { result } = renderHook(() => useAutoScroll(10))

    act(() => {
      result.current.setScrollRef(el)
    })
    act(() => {
      result.current.handleWheel(wheel(-120))
    })
    // 从底部只上移几像素，不到死区 → 不收起
    act(() => {
      el.scrollTop = 2185
      result.current.handleScroll()
    })
    expect(result.current.userScrolledRef.current).toBe(false)
  })

  it('keeps userScrolled false when a touch scroll moves just past the bottom threshold', () => {
    const el = makeScrollEl({ scrollHeight: 3000, clientHeight: 800, scrollTop: 2200 })
    const { result } = renderHook(() => useAutoScroll(10))

    act(() => {
      result.current.setScrollRef(el)
    })
    // 触屏没有 wheel：轻扫离底一点点（不足死区）不应触发收起
    act(() => {
      el.scrollTop = 2185
      result.current.handleScroll()
    })
    expect(result.current.userScrolledRef.current).toBe(false)
  })

  it('ignores wheel when the container has no overflow', () => {
    const el = makeScrollEl({ scrollHeight: 800, clientHeight: 800, scrollTop: 0 })
    const { result } = renderHook(() => useAutoScroll(10))

    act(() => {
      result.current.setScrollRef(el)
    })
    act(() => {
      result.current.handleWheel(wheel(-120))
    })

    // 无溢出时不该因为空白页 spacer 的小溢出触发折叠/离底
    expect(result.current.userScrolledRef.current).toBe(false)
  })

  it('does not set userScrolled on a downward wheel', () => {
    const el = makeScrollEl({ scrollHeight: 3000, clientHeight: 800, scrollTop: 0 })
    const { result } = renderHook(() => useAutoScroll(10))

    act(() => {
      result.current.setScrollRef(el)
    })
    act(() => {
      result.current.handleWheel(wheel(120))
    })

    expect(result.current.userScrolledRef.current).toBe(false)
  })

  it('ignores upward wheel originating from a nested scrollable', () => {
    const el = makeScrollEl({ scrollHeight: 3000, clientHeight: 800, scrollTop: 0 })
    const nested = document.createElement('div')
    nested.setAttribute('data-scrollable', 'true')
    el.appendChild(nested)
    const { result } = renderHook(() => useAutoScroll(10))

    act(() => {
      result.current.setScrollRef(el)
    })

    // 从嵌套滚动容器派发，让 e.target 真的是它（构造函数不接受 target）
    let received: WheelEvent | null = null
    el.addEventListener('wheel', e => {
      received = e as WheelEvent
    })
    act(() => {
      nested.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }))
      if (received) result.current.handleWheel(received)
    })

    // 嵌套滚动容器自己消费的滚轮不该让外层离底
    expect(result.current.userScrolledRef.current).toBe(false)
  })
})
