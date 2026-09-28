import { beforeEach, describe, expect, it } from 'vitest'
import { inputDraftStore } from './inputDraftStore'

describe('inputDraftStore', () => {
  beforeEach(() => {
    // 清空所有桶：模块级单例跨用例会串数据
    for (const id of ['a', 'b', 'c']) inputDraftStore.clear(id)
  })

  it('keeps drafts per session independently', () => {
    inputDraftStore.save('a', { text: 'hello a', attachments: [] })
    inputDraftStore.save('b', { text: 'hello b', attachments: [] })

    expect(inputDraftStore.load('a')?.text).toBe('hello a')
    expect(inputDraftStore.load('b')?.text).toBe('hello b')
  })

  it('returns undefined for a session with no draft', () => {
    expect(inputDraftStore.load('never-typed')).toBeUndefined()
  })

  it('clears the draft for a session', () => {
    inputDraftStore.save('a', { text: 'hello', attachments: [] })
    inputDraftStore.clear('a')
    expect(inputDraftStore.load('a')).toBeUndefined()
  })

  it('overwrites an existing draft with the latest snapshot', () => {
    inputDraftStore.save('a', { text: 'first', attachments: [] })
    inputDraftStore.save('a', { text: 'second', attachments: [] })
    expect(inputDraftStore.load('a')?.text).toBe('second')
  })
})
