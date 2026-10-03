import { beforeEach, describe, expect, it, vi } from 'vitest'
import { changeScopeStore } from './changeScopeStore'

describe('changeScopeStore', () => {
  beforeEach(() => {
    changeScopeStore.clearAll()
  })

  it('defaults to turn when no session or no explicit mode', () => {
    expect(changeScopeStore.getMode(null)).toBe('turn')
    expect(changeScopeStore.getMode('session-1')).toBe('turn')
  })

  it('stores and reads a mode per session', () => {
    changeScopeStore.setMode('session-1', 'branch')
    changeScopeStore.setMode('session-2', 'git')
    expect(changeScopeStore.getMode('session-1')).toBe('branch')
    expect(changeScopeStore.getMode('session-2')).toBe('git')
  })

  it('notifies subscribers when the mode actually changes', () => {
    const listener = vi.fn()
    const unsubscribe = changeScopeStore.subscribe(listener)

    changeScopeStore.setMode('session-1', 'git')
    expect(listener).toHaveBeenCalledTimes(1)

    // 相同值不应重复通知
    changeScopeStore.setMode('session-1', 'git')
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    changeScopeStore.setMode('session-1', 'branch')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('ignores writes for a null session', () => {
    const listener = vi.fn()
    changeScopeStore.subscribe(listener)
    changeScopeStore.setMode(null, 'git')
    expect(listener).not.toHaveBeenCalled()
    expect(changeScopeStore.getMode(null)).toBe('turn')
  })

  it('clears a single session and notifies only when something changed', () => {
    const listener = vi.fn()
    changeScopeStore.setMode('session-1', 'git')
    changeScopeStore.subscribe(listener)

    changeScopeStore.clearSession('session-1')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(changeScopeStore.getMode('session-1')).toBe('turn')

    // 再清一次：无变化，不通知
    changeScopeStore.clearSession('session-1')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('clears all sessions and notifies only when non-empty', () => {
    const listener = vi.fn()
    changeScopeStore.subscribe(listener)

    changeScopeStore.clearAll()
    expect(listener).not.toHaveBeenCalled()

    changeScopeStore.setMode('session-1', 'git')
    changeScopeStore.setMode('session-2', 'branch')
    listener.mockClear()

    changeScopeStore.clearAll()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(changeScopeStore.getMode('session-1')).toBe('turn')
    expect(changeScopeStore.getMode('session-2')).toBe('turn')
  })
})
