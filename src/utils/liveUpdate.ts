// ============================================
// Live Update - Android 16 实况通知（ColorOS 流体云）
// ============================================
//
// 通过原生桥 __opencode_android_live 产出 promoted ongoing 通知，
// 由系统提升为状态栏胶囊，并在 ColorOS 16/17 上进入流体云。
//
// 非 Android 环境（桌面 / 浏览器 / iOS）桥不存在，全部静默降级为无操作。

import { isTauri } from './tauri'

interface AndroidLiveBridge {
  start?: (json: string) => void
  update?: (json: string) => void
  end?: (id: number) => void
  canPromote?: () => boolean
}

export interface LiveUpdatePayload {
  id: number
  title: string
  body?: string
  shortText?: string
  progress?: number
  sessionId?: string
}

function getBridge(): AndroidLiveBridge | undefined {
  if (typeof window === 'undefined') return undefined
  if (!isTauri()) return undefined
  return (window as unknown as { __opencode_android_live?: AndroidLiveBridge }).__opencode_android_live
}

/** 当前平台是否支持实况通知（Android 端 Tauri）。 */
export function liveUpdateSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  return isTauri() && /Android/i.test(navigator.userAgent)
}

/** 系统是否允许本应用发布 promoted 通知（用户可在系统设置里关闭）。 */
export function canPromoteLiveUpdate(): boolean {
  const bridge = getBridge()
  if (typeof bridge?.canPromote !== 'function') return false
  try {
    return bridge.canPromote()
  } catch {
    return false
  }
}

function call(method: 'start' | 'update', payload: LiveUpdatePayload): void {
  const bridge = getBridge()
  const fn = bridge?.[method]
  if (typeof fn !== 'function') return
  try {
    fn(JSON.stringify(payload))
  } catch {
    /* 实况通知是增强体验，失败不应影响主流程 */
  }
}

/** 开始一条实况通知。 */
export function startLiveUpdate(payload: LiveUpdatePayload): void {
  call('start', payload)
}

/** 更新同 id 的实况通知（原地刷新，不堆叠）。 */
export function updateLiveUpdate(payload: LiveUpdatePayload): void {
  call('update', payload)
}

/** 结束并移除实况通知。 */
export function endLiveUpdate(id: number): void {
  const bridge = getBridge()
  if (typeof bridge?.end !== 'function') return
  try {
    bridge.end(id)
  } catch {
    /* ignore */
  }
}
