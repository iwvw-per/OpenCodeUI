import { useSyncExternalStore } from 'react'

const CAN_HOVER_QUERY = '((hover: hover) and (pointer: fine)), ((any-hover: hover) and (any-pointer: fine))'
const COARSE_POINTER_QUERY = '(pointer: coarse), (any-pointer: coarse)'

export interface InputCapabilities {
  canHover: boolean
  hasCoarsePointer: boolean
  hasTouch: boolean
  preferTouchUi: boolean
}

function getMatchMediaMatches(query: string) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  return window.matchMedia(query).matches
}

export function getInputCapabilities(): InputCapabilities {
  const canHover = getMatchMediaMatches(CAN_HOVER_QUERY)
  const hasCoarsePointer = getMatchMediaMatches(COARSE_POINTER_QUERY)
  const hasTouch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
  const preferTouchUi = (hasCoarsePointer || hasTouch) && !canHover

  return {
    canHover,
    hasCoarsePointer,
    hasTouch,
    preferTouchUi,
  }
}

// 模块级共享订阅：整个应用只挂一套监听器（2 个 matchMedia + 1 个 window pointerdown）。
// 此前每个 useInputCapabilities 调用点各挂一套，聊天里每个 CodeBlock / Terminal /
// MarkdownRenderer 都注册，随虚拟列表滚动不断累积（实测 window 上出现 25 个相同的
// pointerdown 处理器）。
const listeners = new Set<() => void>()
let cached = getInputCapabilities()

function sameCapabilities(a: InputCapabilities, b: InputCapabilities): boolean {
  return (
    a.canHover === b.canHover &&
    a.hasCoarsePointer === b.hasCoarsePointer &&
    a.hasTouch === b.hasTouch &&
    a.preferTouchUi === b.preferTouchUi
  )
}

function handleChange() {
  const next = getInputCapabilities()
  if (sameCapabilities(next, cached)) return
  cached = next
  for (const listener of listeners) listener()
}

let detach: (() => void) | null = null

function attach() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  const canHoverMediaQuery = window.matchMedia(CAN_HOVER_QUERY)
  const coarsePointerMediaQuery = window.matchMedia(COARSE_POINTER_QUERY)

  if (typeof canHoverMediaQuery.addEventListener === 'function') {
    canHoverMediaQuery.addEventListener('change', handleChange)
    coarsePointerMediaQuery.addEventListener('change', handleChange)
    detach = () => {
      canHoverMediaQuery.removeEventListener('change', handleChange)
      coarsePointerMediaQuery.removeEventListener('change', handleChange)
      window.removeEventListener('pointerdown', handleChange)
    }
  } else {
    canHoverMediaQuery.addListener(handleChange)
    coarsePointerMediaQuery.addListener(handleChange)
    detach = () => {
      canHoverMediaQuery.removeListener(handleChange)
      coarsePointerMediaQuery.removeListener(handleChange)
      window.removeEventListener('pointerdown', handleChange)
    }
  }

  window.addEventListener('pointerdown', handleChange, { passive: true })
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    cached = getInputCapabilities()
    attach()
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      detach?.()
      detach = null
    }
  }
}

function getSnapshot(): InputCapabilities {
  return cached
}

export function useInputCapabilities(): InputCapabilities {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
