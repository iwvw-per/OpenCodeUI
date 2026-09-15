import { describe, expect, it } from 'vitest'
import type { ApiSession } from '../api'
import {
  DEFAULT_SESSION_SORT,
  getSessionSortTime,
  insertSessionSorted,
  isSessionSortField,
  sortSessions,
} from './sessionSort'

function makeSession(id: string, created: number, updated: number): ApiSession {
  return {
    id,
    slug: id,
    projectID: 'project-1',
    directory: '/workspace/demo',
    title: id,
    version: '1',
    time: { created, updated },
  } as ApiSession
}

describe('sessionSort', () => {
  it('sorts by updated descending by default', () => {
    const a = makeSession('a', 1, 10)
    const b = makeSession('b', 2, 30)
    const c = makeSession('c', 3, 20)

    const sorted = sortSessions([a, b, c], DEFAULT_SESSION_SORT)

    expect(sorted.map(s => s.id)).toEqual(['b', 'c', 'a'])
  })

  it('sorts ascending when desc is false', () => {
    const a = makeSession('a', 1, 10)
    const b = makeSession('b', 2, 30)
    const c = makeSession('c', 3, 20)

    const sorted = sortSessions([a, b, c], { field: 'updated', desc: false })

    expect(sorted.map(s => s.id)).toEqual(['a', 'c', 'b'])
  })

  it('sorts by created time when field is created', () => {
    // updated 顺序与 created 顺序刻意相反，用来区分排序依据
    const a = makeSession('a', 30, 1)
    const b = makeSession('b', 20, 2)
    const c = makeSession('c', 10, 3)

    expect(sortSessions([a, b, c], { field: 'created', desc: true }).map(s => s.id)).toEqual(['a', 'b', 'c'])
    expect(sortSessions([a, b, c], { field: 'created', desc: false }).map(s => s.id)).toEqual(['c', 'b', 'a'])
  })

  it('does not mutate the input array', () => {
    const input = [makeSession('a', 1, 10), makeSession('b', 2, 30)]
    const snapshot = input.map(s => s.id)

    sortSessions(input, DEFAULT_SESSION_SORT)

    expect(input.map(s => s.id)).toEqual(snapshot)
  })

  it('keeps a stable order when timestamps tie', () => {
    const a = makeSession('a', 1, 5)
    const b = makeSession('b', 2, 5)
    const c = makeSession('c', 3, 5)

    // 时间戳相同时按 id 兜底，结果与输入顺序无关
    expect(sortSessions([c, a, b], DEFAULT_SESSION_SORT).map(s => s.id)).toEqual(['a', 'b', 'c'])
    expect(sortSessions([b, c, a], DEFAULT_SESSION_SORT).map(s => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('tolerates missing time fields instead of producing NaN order', () => {
    const noTime = { id: 'no-time', slug: 'x', projectID: 'p', directory: '/d', title: 'x', version: '1' } as ApiSession
    const withTime = makeSession('with-time', 1, 100)

    expect(getSessionSortTime(noTime, 'updated')).toBe(0)
    // 不抛错，且时间缺失的排到最后（倒序）
    expect(sortSessions([noTime, withTime], DEFAULT_SESSION_SORT).map(s => s.id)).toEqual(['with-time', 'no-time'])
  })

  it('falls back to the other timestamp when the requested one is missing', () => {
    const onlyCreated = { ...makeSession('a', 7, 0), time: { created: 7 } } as unknown as ApiSession
    expect(getSessionSortTime(onlyCreated, 'updated')).toBe(7)
  })

  it('validates sort field values', () => {
    expect(isSessionSortField('updated')).toBe(true)
    expect(isSessionSortField('created')).toBe(true)
    expect(isSessionSortField('bogus')).toBe(false)
    expect(isSessionSortField(undefined)).toBe(false)
  })

  describe('insertSessionSorted', () => {
    it('inserts a new session at the end when ascending', () => {
      const a = makeSession('a', 1, 10)
      const b = makeSession('b', 2, 20)
      const fresh = makeSession('fresh', 3, 30)

      const next = insertSessionSorted([a, b], fresh, { field: 'updated', desc: false })

      expect(next.map(s => s.id)).toEqual(['a', 'b', 'fresh'])
    })

    it('inserts a new session at the front when descending and newest', () => {
      const a = makeSession('a', 1, 10)
      const b = makeSession('b', 2, 20)
      const fresh = makeSession('fresh', 3, 30)

      // 倒序下已排序列表是 [b, a]
      const next = insertSessionSorted([b, a], fresh, { field: 'updated', desc: true })

      expect(next.map(s => s.id)).toEqual(['fresh', 'b', 'a'])
    })

    it('inserts in the middle by timestamp', () => {
      const a = makeSession('a', 1, 10)
      const c = makeSession('c', 3, 30)
      const middle = makeSession('middle', 2, 20)

      expect(insertSessionSorted([a, c], middle, { field: 'updated', desc: false }).map(s => s.id)).toEqual([
        'a',
        'middle',
        'c',
      ])
    })

    it('handles an empty list', () => {
      const fresh = makeSession('fresh', 1, 1)
      expect(insertSessionSorted([], fresh, DEFAULT_SESSION_SORT).map(s => s.id)).toEqual(['fresh'])
    })

    it('keeps the list sorted after repeated inserts', () => {
      const preference = { field: 'updated', desc: false } as const
      let list: ApiSession[] = []
      for (const session of [makeSession('b', 2, 20), makeSession('a', 1, 10), makeSession('c', 3, 30)]) {
        list = insertSessionSorted(list, session, preference)
      }
      expect(list.map(s => s.id)).toEqual(['a', 'b', 'c'])
    })
  })
})
