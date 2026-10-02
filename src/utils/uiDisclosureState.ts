import { useCallback, useState } from 'react'

type DisclosureState = {
  value: boolean
  touched: boolean
}

/**
 * 展开/折叠状态缓存上限。key 由 messageId / tool part id 拼接，随浏览过的
 * 消息与工具卡单调增长；不设上限就是一条只增不减的泄漏。超出后按插入顺序
 * 淘汰最旧项（Map 的插入序天然支持），用户最近操作的项会因再次写入而排到末尾。
 */
const MAX_DISCLOSURE_ENTRIES = 2000
const MAX_UI_STATE_ENTRIES = 2000

function setBounded<T>(cache: Map<string, T>, key: string, value: T, max: number) {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > max) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** 读命中时把该项移到插入序末尾，保证「最近被读取」的项不被淘汰（真 LRU 语义） */
function touchBounded<T>(cache: Map<string, T>, key: string, value: T) {
  cache.delete(key)
  cache.set(key, value)
}

const disclosureStateCache = new Map<string, DisclosureState>()

export function getUiDisclosureState(key: string, fallback: boolean): DisclosureState {
  const cached = disclosureStateCache.get(key)
  if (cached) {
    touchBounded(disclosureStateCache, key, cached)
    return cached
  }
  const initial = { value: fallback, touched: false }
  setBounded(disclosureStateCache, key, initial, MAX_DISCLOSURE_ENTRIES)
  return initial
}

export function setUiDisclosureState(key: string, value: boolean, touched = true) {
  setBounded(disclosureStateCache, key, { value, touched }, MAX_DISCLOSURE_ENTRIES)
}

export function hasUserTouchedUiDisclosure(key: string): boolean {
  return disclosureStateCache.get(key)?.touched ?? false
}

const uiStateCache = new Map<string, unknown>()

export function getUiState<T>(key: string, fallback: T): T {
  if (!uiStateCache.has(key)) {
    setBounded(uiStateCache, key, fallback, MAX_UI_STATE_ENTRIES)
    return fallback
  }
  const value = (uiStateCache.get(key) as T) ?? fallback
  touchBounded(uiStateCache, key, value)
  return value
}

export function setUiState<T>(key: string, value: T) {
  setBounded(uiStateCache, key, value, MAX_UI_STATE_ENTRIES)
}

export function useUiState<T>(key: string | undefined, fallback: T) {
  const [cached, setCached] = useState(() => ({ key, state: key ? getUiState(key, fallback) : fallback }))
  const state = cached.key === key ? cached.state : key ? getUiState(key, fallback) : fallback

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      setCached(prev => {
        const previousState = prev.key === key ? prev.state : key ? getUiState(key, fallback) : fallback
        const resolved = typeof next === 'function' ? (next as (prev: T) => T)(previousState) : next
        if (key) setUiState(key, resolved)
        return { key, state: resolved }
      })
    },
    [fallback, key],
  )

  return [state, setValue] as const
}

export function useUiDisclosureState(key: string, fallback: boolean) {
  const [cached, setCached] = useState(() => ({ key, state: getUiDisclosureState(key, fallback) }))
  const state = cached.key === key ? cached.state : getUiDisclosureState(key, fallback)

  const setValue = useCallback(
    (next: boolean | ((prev: boolean) => boolean), options?: { touched?: boolean; respectUser?: boolean }) => {
      setCached(prev => {
        const previousState = prev.key === key ? prev.state : getUiDisclosureState(key, fallback)
        if (options?.respectUser && previousState.touched) return prev.key === key ? prev : { key, state: previousState }
        const resolved =
          typeof next === 'function' ? (next as (prev: boolean) => boolean)(previousState.value) : next
        const touched = options?.touched ?? true
        const nextState = { value: resolved, touched: previousState.touched || touched }
        setBounded(disclosureStateCache, key, nextState, MAX_DISCLOSURE_ENTRIES)
        return { key, state: nextState }
      })
    },
    [fallback, key],
  )

  return [state.value, setValue, state.touched] as const
}
