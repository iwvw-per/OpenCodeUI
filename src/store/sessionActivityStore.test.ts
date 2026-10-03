import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  sessionActivityStore,
  getSessionAnchorTime,
  sortSessionsByAnchor,
  insertSessionByAnchor,
} from './sessionActivityStore'
import type { ApiSession } from '../api'

function makeSession(id: string, updated: number, created = updated): ApiSession {
  return {
    id,
    slug: id,
    projectID: 'p',
    directory: '/workspace/demo',
    title: id,
    version: '1',
    time: { created, updated },
  } as ApiSession
}

describe('sessionActivityStore', () => {
  beforeEach(() => {
    sessionActivityStore.reset()
  })

  it('records a session anchor and notifies subscribers', () => {
    const listener = vi.fn()
    sessionActivityStore.subscribe(listener)

    sessionActivityStore.recordActivity('s1', 100, '/workspace/demo', 'local')

    expect(sessionActivityStore.getSessionAnchor('s1')).toBe(100)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('ignores a stale (older) timestamp without notifying', () => {
    const listener = vi.fn()
    sessionActivityStore.recordActivity('s1', 100)
    sessionActivityStore.subscribe(listener)

    sessionActivityStore.recordActivity('s1', 50)

    expect(sessionActivityStore.getSessionAnchor('s1')).toBe(100)
    expect(listener).not.toHaveBeenCalled()
  })

  it('tracks the directory anchor as the max across sessions', () => {
    sessionActivityStore.recordActivity('s1', 100, '/workspace/demo', 'local')
    sessionActivityStore.recordActivity('s2', 200, '/workspace/demo', 'local')

    expect(sessionActivityStore.getDirectoryAnchor('local', '/workspace/demo')).toBe(200)

    // 旧会话的新活动也应抬高目录锚点
    sessionActivityStore.recordActivity('s1', 300, '/workspace/demo', 'local')
    expect(sessionActivityStore.getDirectoryAnchor('local', '/workspace/demo')).toBe(300)
  })

  it('normalizes slashes and trailing slash in the directory key', () => {
    sessionActivityStore.recordActivity('s1', 100, 'C:\\Work\\Demo\\', 'local')
    expect(sessionActivityStore.getDirectoryAnchor('local', 'C:/Work/Demo')).toBe(100)
  })

  it('getSessionAnchorTime falls back to session.time when no anchor', () => {
    expect(getSessionAnchorTime(makeSession('s1', 42))).toBe(42)

    sessionActivityStore.recordActivity('s1', 99)
    expect(getSessionAnchorTime(makeSession('s1', 42))).toBe(99)
  })

  it('sorts sessions by anchor descending (newest first)', () => {
    sessionActivityStore.recordActivity('a', 10)
    sessionActivityStore.recordActivity('b', 30)
    sessionActivityStore.recordActivity('c', 20)

    const sorted = sortSessionsByAnchor([makeSession('a', 1), makeSession('b', 1), makeSession('c', 1)])
    expect(sorted.map(s => s.id)).toEqual(['b', 'c', 'a'])
  })

  it('uses a stable id tie-break for equal anchors', () => {
    const sorted = sortSessionsByAnchor([makeSession('c', 5), makeSession('a', 5), makeSession('b', 5)])
    expect(sorted.map(s => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('inserts a new session by anchor order', () => {
    sessionActivityStore.recordActivity('a', 10)
    sessionActivityStore.recordActivity('c', 30)
    sessionActivityStore.recordActivity('m', 20)

    let list = sortSessionsByAnchor([makeSession('a', 1), makeSession('c', 1)])
    list = insertSessionByAnchor(list, makeSession('m', 1))
    expect(list.map(s => s.id)).toEqual(['c', 'm', 'a'])
  })

  it('does not mutate the input array', () => {
    const input = [makeSession('a', 1), makeSession('b', 2)]
    const snapshot = input.map(s => s.id)
    sortSessionsByAnchor(input)
    expect(input.map(s => s.id)).toEqual(snapshot)
  })
})
