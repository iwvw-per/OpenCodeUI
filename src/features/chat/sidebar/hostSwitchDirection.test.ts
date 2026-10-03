import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hostSwitchDirection, hostSlideClass, useHostSlideState } from './hostSwitchDirection'

describe('hostSwitchDirection', () => {
  it('slides from the right when moving to a host further right', () => {
    expect(hostSwitchDirection(0, 1)).toBe('from-right')
    expect(hostSwitchDirection(0, 3)).toBe('from-right')
  })

  it('slides from the left when moving to a host further left', () => {
    expect(hostSwitchDirection(2, 1)).toBe('from-left')
    expect(hostSwitchDirection(3, 0)).toBe('from-left')
  })

  it('falls back to from-left when either index is unknown', () => {
    expect(hostSwitchDirection(-1, 1)).toBe('from-left')
    expect(hostSwitchDirection(1, -1)).toBe('from-left')
    expect(hostSwitchDirection(-1, -1)).toBe('from-left')
  })

  it('maps direction to the CSS class', () => {
    expect(hostSlideClass('from-right')).toBe('host-slide-from-right')
    expect(hostSlideClass('from-left')).toBe('host-slide-from-left')
  })
})

describe('useHostSlideState', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const ids = ['a', 'b', 'c']

  it('does not animate on first render', () => {
    const { result } = renderHook(() => useHostSlideState(ids, 'b'))
    expect(result.current.className).toBe('')
    expect(result.current.switching).toBe(false)
  })

  it('reports a slide + switching window when moving right', () => {
    const { result, rerender } = renderHook(({ server }) => useHostSlideState(ids, server), {
      initialProps: { server: 'a' },
    })
    rerender({ server: 'c' })
    expect(result.current.className).toBe('host-slide-from-right')
    expect(result.current.switching).toBe(true)
  })

  it('reports from-left when moving left', () => {
    const { result, rerender } = renderHook(({ server }) => useHostSlideState(ids, server), {
      initialProps: { server: 'c' },
    })
    rerender({ server: 'a' })
    expect(result.current.className).toBe('host-slide-from-left')
  })

  it('clears the switching flag after the slide duration', () => {
    const { result, rerender } = renderHook(({ server }) => useHostSlideState(ids, server), {
      initialProps: { server: 'a' },
    })
    rerender({ server: 'b' })
    expect(result.current.switching).toBe(true)

    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(result.current.switching).toBe(false)
  })
})
