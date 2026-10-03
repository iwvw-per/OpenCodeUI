import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => {
  const data = new Map<string, string>()
  return {
    data,
    getJSONFor: vi.fn((key: string, serverId: string) => {
      const raw = data.get(`${serverId}:${key}`)
      return raw ? (JSON.parse(raw) as unknown) : null
    }),
    setJSONFor: vi.fn((key: string, value: unknown, serverId: string) => {
      data.set(`${serverId}:${key}`, JSON.stringify(value))
    }),
    remove: vi.fn(),
  }
})

vi.mock('../utils/perServerStorage', () => ({ serverStorage: storage }))

import { turnOutlineStore } from './turnOutlineStore'

describe('turnOutlineStore', () => {
  beforeEach(() => {
    turnOutlineStore.reset()
    storage.data.clear()
    storage.getJSONFor.mockClear()
    storage.setJSONFor.mockClear()
  })

  it('merges entries and keeps them sorted by createdAt', () => {
    turnOutlineStore.merge('srv', 'ses-1', [
      { messageId: 'u2', title: 'second', createdAt: 20 },
      { messageId: 'u1', title: 'first', createdAt: 10 },
    ])

    const entries = turnOutlineStore.getEntries('srv', 'ses-1')
    expect(entries.map(e => e.messageId)).toEqual(['u1', 'u2'])
  })

  it('deduplicates by messageId and updates changed titles in place', () => {
    turnOutlineStore.merge('srv', 'ses-1', [{ messageId: 'u1', title: 'old', createdAt: 10 }])
    const changed = turnOutlineStore.merge('srv', 'ses-1', [
      { messageId: 'u1', title: 'new', createdAt: 10 },
      { messageId: 'u2', title: 'second', createdAt: 20 },
    ])

    expect(changed).toBe(true)
    const entries = turnOutlineStore.getEntries('srv', 'ses-1')
    expect(entries).toHaveLength(2)
    expect(entries.find(e => e.messageId === 'u1')?.title).toBe('new')
  })

  it('returns false when merging identical entries', () => {
    turnOutlineStore.merge('srv', 'ses-1', [{ messageId: 'u1', title: 'first', createdAt: 10 }])
    expect(turnOutlineStore.merge('srv', 'ses-1', [{ messageId: 'u1', title: 'first', createdAt: 10 }])).toBe(false)
  })

  it('persists per server and reloads from storage', () => {
    turnOutlineStore.merge('srv', 'ses-1', [{ messageId: 'u1', title: 'first', createdAt: 10 }])
    expect(storage.setJSONFor).toHaveBeenCalled()

    // 模拟重挂：清内存态后应能从磁盘懒加载回来
    turnOutlineStore.reset()
    const entries = turnOutlineStore.getSnapshot('srv', 'ses-1')
    expect(entries.map(e => e.messageId)).toEqual(['u1'])
  })

  it('keeps sessions isolated within a server', () => {
    turnOutlineStore.merge('srv', 'ses-1', [{ messageId: 'u1', title: 'one', createdAt: 1 }])
    turnOutlineStore.merge('srv', 'ses-2', [{ messageId: 'u2', title: 'two', createdAt: 2 }])

    expect(turnOutlineStore.getEntries('srv', 'ses-1').map(e => e.messageId)).toEqual(['u1'])
    expect(turnOutlineStore.getEntries('srv', 'ses-2').map(e => e.messageId)).toEqual(['u2'])
  })

  it('clears a single session and drops a server', () => {
    turnOutlineStore.merge('srv', 'ses-1', [{ messageId: 'u1', title: 'one', createdAt: 1 }])
    turnOutlineStore.clearSession('srv', 'ses-1')
    expect(turnOutlineStore.getEntries('srv', 'ses-1')).toHaveLength(0)

    turnOutlineStore.merge('srv', 'ses-1', [{ messageId: 'u1', title: 'one', createdAt: 1 }])
    turnOutlineStore.dropServer('srv')
    expect(turnOutlineStore.getEntries('srv', 'ses-1')).toHaveLength(0)
  })
})
