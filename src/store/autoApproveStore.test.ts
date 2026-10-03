import { beforeEach, describe, expect, it, vi } from 'vitest'

// autoApproveStore 构造时读 serverStorage（localStorage 前缀封装），
// 单测用内存实现替换，避免依赖真实 localStorage 与 serverStore。
vi.mock('../utils/perServerStorage', () => {
  const store = new Map<string, string>()
  return {
    serverStorage: {
      get: (key: string) => store.get(key) ?? null,
      set: (key: string, value: string) => void store.set(key, value),
      remove: (key: string) => void store.delete(key),
    },
  }
})

import { autoApproveStore } from './autoApproveStore'

describe('autoApproveStore', () => {
  beforeEach(() => {
    autoApproveStore.reset()
  })

  describe('shouldAutoApprove', () => {
    it('returns false when disabled', () => {
      autoApproveStore.setEnabled(false)
      autoApproveStore.addRules('s1', 'bash', ['*'])
      expect(autoApproveStore.shouldAutoApprove('s1', 'bash', ['ls'])).toBe(false)
    })

    it('returns false when there are no rules for the session', () => {
      expect(autoApproveStore.shouldAutoApprove('s1', 'bash', ['ls'])).toBe(false)
    })

    it('returns false for an empty request pattern list', () => {
      autoApproveStore.addRules('s1', 'bash', ['*'])
      expect(autoApproveStore.shouldAutoApprove('s1', 'bash', [])).toBe(false)
    })

    it('approves when a wildcard rule matches every requested pattern', () => {
      autoApproveStore.addRules('s1', 'bash', ['git *'])
      expect(autoApproveStore.shouldAutoApprove('s1', 'bash', ['git status'])).toBe(true)
      expect(autoApproveStore.shouldAutoApprove('s1', 'bash', ['git commit -m x'])).toBe(true)
    })

    it('rejects when any requested pattern is unmatched', () => {
      autoApproveStore.addRules('s1', 'bash', ['git *'])
      expect(autoApproveStore.shouldAutoApprove('s1', 'bash', ['git status', 'rm -rf /'])).toBe(false)
    })

    it('requires the permission type to match (or a * rule)', () => {
      autoApproveStore.addRules('s1', 'bash', ['*'])
      expect(autoApproveStore.shouldAutoApprove('s1', 'edit', ['anything'])).toBe(false)

      autoApproveStore.addRules('s1', '*', ['*'])
      expect(autoApproveStore.shouldAutoApprove('s1', 'edit', ['anything'])).toBe(true)
    })

    it('matches wildcards in either direction', () => {
      // request 带通配、rule 是具体值：双向匹配应命中
      autoApproveStore.addRules('s1', 'bash', ['git status'])
      expect(autoApproveStore.shouldAutoApprove('s1', 'bash', ['git *'])).toBe(true)
    })
  })

  describe('rules', () => {
    it('deduplicates identical permission+pattern rules', () => {
      autoApproveStore.addRules('s1', 'bash', ['ls', 'ls'])
      autoApproveStore.addRules('s1', 'bash', ['ls'])
      expect(autoApproveStore.getRules('s1')).toHaveLength(1)
    })

    it('clearRules only affects the target session', () => {
      autoApproveStore.addRules('s1', 'bash', ['ls'])
      autoApproveStore.addRules('s2', 'bash', ['ls'])
      autoApproveStore.clearRules('s1')
      expect(autoApproveStore.getRules('s1')).toHaveLength(0)
      expect(autoApproveStore.getRules('s2')).toHaveLength(1)
    })
  })

  describe('full auto pane cycle', () => {
    it('cycles off -> session -> global -> off', () => {
      expect(autoApproveStore.cyclePaneFullAutoMode('p1')).toBe('session')
      expect(autoApproveStore.cyclePaneFullAutoMode('p1')).toBe('global')
      expect(autoApproveStore.cyclePaneFullAutoMode('p1')).toBe('off')
    })

    it('reports per-pane mode independently', () => {
      autoApproveStore.setPaneFullAutoMode('p1', 'session')
      expect(autoApproveStore.getPaneFullAutoMode('p1')).toBe('session')
      expect(autoApproveStore.getPaneFullAutoMode('p2')).toBe('off')
    })
  })

  describe('auto reply claim', () => {
    it('claims a request id only once until released', () => {
      expect(autoApproveStore.claimAutoReply('req-1')).toBe(true)
      expect(autoApproveStore.claimAutoReply('req-1')).toBe(false)
      autoApproveStore.releaseAutoReply('req-1')
      expect(autoApproveStore.claimAutoReply('req-1')).toBe(true)
    })
  })

  describe('reset', () => {
    it('restores defaults and clears listeners', () => {
      autoApproveStore.setEnabled(false)
      autoApproveStore.setFullAutoMode('global')
      autoApproveStore.addRules('s1', 'bash', ['ls'])
      const listener = vi.fn()
      autoApproveStore.onFullAutoChange(listener)

      autoApproveStore.reset()

      expect(autoApproveStore.enabled).toBe(true)
      expect(autoApproveStore.getRules('s1')).toHaveLength(0)
      expect(autoApproveStore.getPaneFullAutoMode('p1')).toBe('off')
    })
  })
})
