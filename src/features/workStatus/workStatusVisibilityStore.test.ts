import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  setWorkStatusPanelVisible,
  clearWorkStatusPanelVisible,
  useWorkStatusPanelVisible,
} from './workStatusVisibilityStore'

describe('workStatusVisibilityStore', () => {
  beforeEach(() => {
    clearWorkStatusPanelVisible('pane-a')
    clearWorkStatusPanelVisible('pane-b')
  })

  it('defaults to not visible for an unknown pane', () => {
    const { result } = renderHook(() => useWorkStatusPanelVisible('pane-a'))
    expect(result.current).toBe(false)
  })

  it('reflects visibility changes for the matching pane', () => {
    const { result } = renderHook(() => useWorkStatusPanelVisible('pane-a'))

    act(() => setWorkStatusPanelVisible('pane-a', true))
    expect(result.current).toBe(true)

    act(() => setWorkStatusPanelVisible('pane-a', false))
    expect(result.current).toBe(false)
  })

  it('isolates panes from each other', () => {
    const a = renderHook(() => useWorkStatusPanelVisible('pane-a'))
    const b = renderHook(() => useWorkStatusPanelVisible('pane-b'))

    act(() => setWorkStatusPanelVisible('pane-a', true))
    expect(a.result.current).toBe(true)
    expect(b.result.current).toBe(false)
  })

  it('clears a pane entry back to not visible', () => {
    const { result } = renderHook(() => useWorkStatusPanelVisible('pane-b'))

    act(() => setWorkStatusPanelVisible('pane-b', true))
    expect(result.current).toBe(true)

    act(() => clearWorkStatusPanelVisible('pane-b'))
    expect(result.current).toBe(false)
  })

  it('treats a null pane id as not visible', () => {
    const { result } = renderHook(() => useWorkStatusPanelVisible(null))
    expect(result.current).toBe(false)
  })
})
