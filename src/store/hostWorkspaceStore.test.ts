import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hostWorkspaceStore } from './hostWorkspaceStore'

describe('hostWorkspaceStore', () => {
  beforeEach(() => {
    localStorage.clear()
    hostWorkspaceStore.reset()
  })

  it('returns a stable empty workspace for an unknown server', () => {
    const first = hostWorkspaceStore.get('unknown')
    expect(first.sessionKey).toBeNull()
    expect(first.directory).toBeUndefined()
    expect(hostWorkspaceStore.get('unknown')).toBe(first)
  })

  it('stores and reads a per-server workspace', () => {
    hostWorkspaceStore.set('local', { sessionKey: 'local::ses_1', directory: 'E:\\a' })
    hostWorkspaceStore.set('aiagent:inst_x', { sessionKey: 'aiagent:inst_x::ses_2', directory: '/b' })

    expect(hostWorkspaceStore.get('local').sessionKey).toBe('local::ses_1')
    expect(hostWorkspaceStore.get('local').directory).toBe('E:\\a')
    expect(hostWorkspaceStore.get('aiagent:inst_x').sessionKey).toBe('aiagent:inst_x::ses_2')
  })

  it('keeps servers isolated from each other', () => {
    hostWorkspaceStore.set('a', { sessionKey: 'a::s1', directory: '/a' })
    hostWorkspaceStore.set('b', { sessionKey: null, directory: '/b' })
    expect(hostWorkspaceStore.get('a').directory).toBe('/a')
    expect(hostWorkspaceStore.get('b').sessionKey).toBeNull()
    expect(hostWorkspaceStore.get('b').directory).toBe('/b')
  })

  it('notifies subscribers and returns a new snapshot reference on change', () => {
    const listener = vi.fn()
    hostWorkspaceStore.subscribe(listener)

    const before = hostWorkspaceStore.get('a')
    hostWorkspaceStore.set('a', { sessionKey: 'a::s1', directory: '/a' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(hostWorkspaceStore.get('a')).not.toBe(before)
  })

  it('does not notify or change reference when writing the same value', () => {
    hostWorkspaceStore.set('a', { sessionKey: 'a::s1', directory: '/a' })
    const snapshot = hostWorkspaceStore.get('a')
    const listener = vi.fn()
    hostWorkspaceStore.subscribe(listener)

    hostWorkspaceStore.set('a', { sessionKey: 'a::s1', directory: '/a' })
    expect(listener).not.toHaveBeenCalled()
    expect(hostWorkspaceStore.get('a')).toBe(snapshot)
  })

  it('ignores an empty server id', () => {
    const listener = vi.fn()
    hostWorkspaceStore.subscribe(listener)
    hostWorkspaceStore.set('', { sessionKey: 'x', directory: '/x' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('drops a server workspace', () => {
    hostWorkspaceStore.set('a', { sessionKey: 'a::s1', directory: '/a' })
    hostWorkspaceStore.drop('a')
    expect(hostWorkspaceStore.get('a').sessionKey).toBeNull()
  })

  it('persists across instances via localStorage', async () => {
    hostWorkspaceStore.set('a', { sessionKey: 'a::s1', directory: '/a' })
    // 重新导入模块会新建实例，应从 localStorage 恢复
    vi.resetModules()
    const { hostWorkspaceStore: fresh } = await import('./hostWorkspaceStore')
    expect(fresh.get('a').sessionKey).toBe('a::s1')
  })
})
