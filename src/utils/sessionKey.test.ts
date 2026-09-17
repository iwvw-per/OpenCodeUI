import { beforeEach, describe, expect, it, vi } from 'vitest'

const getActiveServerId = vi.fn(() => 'local')

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => getActiveServerId(),
  },
}))

const { makeSessionKey, resolveSessionTarget, sessionKeyToServerId, sessionKeyToSessionId, splitSessionKey } = await import(
  './sessionKey'
)

describe('sessionKey', () => {
  beforeEach(() => {
    getActiveServerId.mockReturnValue('local')
  })

  describe('makeSessionKey / splitSessionKey round trip', () => {
    it('round trips a normal key', () => {
      const key = makeSessionKey('server-1', 'ses_abc')
      expect(key).toBe('server-1::ses_abc')
      expect(splitSessionKey(key)).toEqual({ serverId: 'server-1', sessionId: 'ses_abc' })
    })

    it('splits on the first separator only', () => {
      // 服务器 id 自身不含 ::，sessionId 可能包含；取首个分隔符是正确的切分点
      const key = makeSessionKey('server-1', 'a::b::c')
      expect(splitSessionKey(key)).toEqual({ serverId: 'server-1', sessionId: 'a::b::c' })
    })

    it('treats keys without a separator as belonging to the active server', () => {
      expect(splitSessionKey('legacy_session')).toEqual({ serverId: 'local', sessionId: 'legacy_session' })
    })
  })

  describe('malformed input', () => {
    it('does not produce an empty serverId for a missing-server key', () => {
      // `::foo` 没有 server 段，不能解析出 serverId=''
      const key = makeSessionKey('', 'ses_abc')
      expect(key).toBe('::ses_abc')
      const parsed = splitSessionKey(key)
      expect(parsed.serverId).toBe('local')
      expect(parsed.serverId).not.toBe('')
      // sessionId 保持空，调用方应以参数非法处理，而不是把 `::ses_abc` 当 id 发出去
      expect(parsed.sessionId).toBe('')
    })

    it('returns empty sessionId but never an empty serverId for the empty string', () => {
      expect(splitSessionKey('')).toEqual({ serverId: 'local', sessionId: '' })
    })

    it('keeps a valid empty sessionId after a real server prefix', () => {
      expect(splitSessionKey('server-1::')).toEqual({ serverId: 'server-1', sessionId: '' })
    })
  })

  describe('accessors', () => {
    it('exposes both halves', () => {
      const key = makeSessionKey('srv', 'ses')
      expect(sessionKeyToServerId(key)).toBe('srv')
      expect(sessionKeyToSessionId(key)).toBe('ses')
    })

    it('always returns a string for getters', () => {
      expect(sessionKeyToServerId('')).toBe('local')
      expect(sessionKeyToSessionId('')).toBe('')
    })
  })

  describe('resolveSessionTarget', () => {
    it('prefers the explicit serverId', () => {
      expect(resolveSessionTarget('server-1::ses_abc', 'server-2')).toEqual({
        sessionId: 'ses_abc',
        serverId: 'server-2',
      })
    })

    it('uses the parsed serverId when none is passed', () => {
      expect(resolveSessionTarget('server-1::ses_abc')).toEqual({ sessionId: 'ses_abc', serverId: 'server-1' })
    })

    it('falls back to the active server for legacy keys', () => {
      getActiveServerId.mockReturnValue('server-9')
      expect(resolveSessionTarget('ses_abc')).toEqual({ sessionId: 'ses_abc', serverId: 'server-9' })
    })

    it('does not leak the serverId into sessionId for a malformed composite key', () => {
      const target = resolveSessionTarget('::ses_abc')
      expect(target.sessionId).toBe('')
      expect(target.serverId).toBe('local')
    })
  })
})
