import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dedupeSessionListRequest, sessionListCacheKey } from './sessionListCache'
import { ttlCacheInvalidate } from '../utils/ttlCache'
import type { ApiSession } from './types'

vi.mock('../store/serverStore', () => ({
  serverStore: { getActiveServerId: () => 'test-server' },
}))

function makeSessions(ids: string[]): ApiSession[] {
  return ids.map(id => ({ id }) as ApiSession)
}

describe('sessionListCacheKey', () => {
  it('treats forward and backslash forms of the same directory as one key', () => {
    const forward = sessionListCacheKey('srv', { directory: 'E:/Code/App', limit: 51 })
    const backslash = sessionListCacheKey('srv', { directory: 'E:\\Code\\App', limit: 51 })
    expect(forward).toBe(backslash)
  })

  it('keeps distinct directories distinct', () => {
    const a = sessionListCacheKey('srv', { directory: 'E:/Code/App', limit: 51 })
    const b = sessionListCacheKey('srv', { directory: 'E:/Code/Other', limit: 51 })
    expect(a).not.toBe(b)
  })

  it('keeps case distinct so case-sensitive backends are not merged', () => {
    const lower = sessionListCacheKey('srv', { directory: '/srv/app', limit: 51 })
    const upper = sessionListCacheKey('srv', { directory: '/srv/App', limit: 51 })
    expect(lower).not.toBe(upper)
  })

  it('separates archived modes', () => {
    const active = sessionListCacheKey('srv', { directory: 'E:/Code/App', limit: 51 })
    const archived = sessionListCacheKey('srv', { directory: 'E:/Code/App', limit: 51, archivedOnly: true })
    expect(active).not.toBe(archived)
  })
})

describe('dedupeSessionListRequest', () => {
  beforeEach(() => {
    ttlCacheInvalidate('session-list:')
  })

  it('shares one in-flight request across concurrent callers with the same key', async () => {
    const resolvers: Array<(value: ApiSession[]) => void> = []
    const factory = vi.fn(
      () =>
        new Promise<ApiSession[]>(r => {
          resolvers.push(r)
        }),
    )

    const first = dedupeSessionListRequest('srv', { directory: 'E:/Code/App', limit: 51 }, factory)
    const second = dedupeSessionListRequest('srv', { directory: 'E:\\Code\\App', limit: 51 }, factory)

    expect(factory).toHaveBeenCalledTimes(1)

    const payload = makeSessions(['a', 'b'])
    resolvers[0](payload)

    await expect(first).resolves.toEqual(payload)
    await expect(second).resolves.toEqual(payload)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('does not share requests across different directories', async () => {
    const factory = vi.fn(async () => makeSessions(['a']))

    await Promise.all([
      dedupeSessionListRequest('srv', { directory: 'E:/Code/A', limit: 51 }, factory),
      dedupeSessionListRequest('srv', { directory: 'E:/Code/B', limit: 51 }, factory),
    ])

    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('issues a fresh request after the previous one settles', async () => {
    const factory = vi.fn(async () => makeSessions(['a']))

    await dedupeSessionListRequest('srv', { directory: 'E:/Code/App', limit: 51 }, factory)
    await dedupeSessionListRequest('srv', { directory: 'E:/Code/App', limit: 51 }, factory)

    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('clears the in-flight entry when the request rejects', async () => {
    const failing = vi.fn(async () => {
      throw new Error('boom')
    })
    await expect(dedupeSessionListRequest('srv', { directory: 'E:/Code/App', limit: 51 }, failing)).rejects.toThrow(
      'boom',
    )

    const succeeding = vi.fn(async () => makeSessions(['b']))
    await expect(dedupeSessionListRequest('srv', { directory: 'E:/Code/App', limit: 51 }, succeeding)).resolves.toEqual(
      makeSessions(['b']),
    )
    expect(succeeding).toHaveBeenCalledTimes(1)
  })
})
