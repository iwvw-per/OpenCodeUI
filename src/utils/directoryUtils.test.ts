import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  directoryCacheKey,
  formatPathForApi,
  resetPathModeCache,
  setPathMode,
  setDetectedPathStyle,
} from './directoryUtils'

vi.mock('../store/serverStore', () => ({
  serverStore: { getActiveServerId: () => 'test-server' },
}))

vi.mock('./perServerStorage', () => ({
  serverStorage: {
    get: () => null,
    set: () => undefined,
    getFor: () => null,
    setFor: () => undefined,
  },
}))

describe('directoryCacheKey', () => {
  beforeEach(() => {
    resetPathModeCache()
    setPathMode('auto')
  })

  it('is identical for forward and backslash forms of the same directory', () => {
    expect(directoryCacheKey('E:/Code/App')).toBe(directoryCacheKey('E:\\Code\\App'))
  })

  it('ignores trailing separators', () => {
    expect(directoryCacheKey('E:/Code/App/')).toBe(directoryCacheKey('E:\\Code\\App'))
  })

  it('keeps case distinct so case-sensitive backends are not merged', () => {
    expect(directoryCacheKey('/srv/app')).not.toBe(directoryCacheKey('/srv/App'))
  })

  it('returns an empty string for empty input', () => {
    expect(directoryCacheKey(undefined)).toBe('')
    expect(directoryCacheKey(null)).toBe('')
  })

  it('stays stable when the detected path style flips mid-session', () => {
    // 这是本次修复的核心：pathMode 在 auto 检测期间可能从 unix 翻到 windows，
    // 传输格式会变，但 cache key 必须保持同一个，否则缓存与在途合并全部失效。
    setDetectedPathStyle('unix', 'test-server')
    const beforeFlip = formatPathForApi('E:/Code/App', 'test-server')
    const keyBeforeFlip = directoryCacheKey('E:/Code/App')

    setDetectedPathStyle('windows', 'test-server')
    const afterFlip = formatPathForApi('E:/Code/App', 'test-server')
    const keyAfterFlip = directoryCacheKey('E:/Code/App')

    // 传输格式确实变了（这正是导致重复请求的原因）
    expect(beforeFlip).not.toBe(afterFlip)
    // 但 key 不变
    expect(keyBeforeFlip).toBe(keyAfterFlip)
  })
})
