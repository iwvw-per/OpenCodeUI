// ============================================
// workStatusVisibilityStore — 工作状态面板「是否占位」的跨组件广播
// ============================================
//
// 面板可见性在 ChatPane 内由 useWorkStatusVisibility 测量得到，但顶栏的
// 上下文圆环需要读它（面板可见时隐藏，避免与面板内的上下文信息重复），
// 而桌面端顶栏由 App 的 DesktopTitlebar 渲染，与 ChatPane 不在同一子树。
// 用一个按 paneId 分片的外部 store 打通，避免为传递一个布尔值层层透传。

import { useSyncExternalStore } from 'react'

const visibility = new Map<string, boolean>()
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(listener => listener())
}

export function setWorkStatusPanelVisible(paneId: string, visible: boolean): void {
  if (visibility.get(paneId) === visible) return
  visibility.set(paneId, visible)
  emit()
}

export function clearWorkStatusPanelVisible(paneId: string): void {
  if (!visibility.has(paneId)) return
  visibility.delete(paneId)
  emit()
}

export function useWorkStatusPanelVisible(paneId: string | null | undefined): boolean {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => (paneId ? (visibility.get(paneId) ?? false) : false),
    () => (paneId ? (visibility.get(paneId) ?? false) : false),
  )
}
