import { useSyncExternalStore } from 'react'

const MOBILE_BREAKPOINT = 768

function getSnapshot(): boolean {
  return typeof window === 'undefined' ? false : window.innerWidth < MOBILE_BREAKPOINT
}

// 模块级共享订阅：整个应用只挂一个 window resize 监听。
// 此前每个 useIsMobile 调用点各挂一个，聊天里成百上千个组件实例累积出
// 大量同名 resize 监听器（实测 window 上出现 19 个完全相同的处理器）。
const listeners = new Set<() => void>()
let lastValue = getSnapshot()

function handleResize() {
  const next = getSnapshot()
  if (next === lastValue) return
  lastValue = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    lastValue = getSnapshot()
    window.addEventListener('resize', handleResize)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('resize', handleResize)
    }
  }
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
