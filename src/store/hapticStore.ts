// ============================================
// HapticStore - 触觉反馈（震动）配置持久化
// ============================================
//
// 移动端所有可交互操作的震动反馈由全局指针监听统一触发（见 useGlobalHaptics），
// 强弱分级由操作语义决定。本 store 提供总开关与全局强度档，默认开启、标准强度。
// 配置项存 localStorage，与 soundStore 同构，便于纳入设置备份。

import { useSyncExternalStore } from 'react'

export type HapticIntensity = 'subtle' | 'standard' | 'strong'

export const HAPTIC_INTENSITY_ORDER: readonly HapticIntensity[] = ['subtle', 'standard', 'strong']

export interface HapticSettings {
  /** 触觉反馈总开关 */
  enabled: boolean
  /** 全局强度档：对所有语义级别的震动做缩放 */
  intensity: HapticIntensity
}

type Subscriber = () => void

const STORAGE_KEY = 'opencode:haptic-settings'

function isIntensity(value: unknown): value is HapticIntensity {
  return value === 'subtle' || value === 'standard' || value === 'strong'
}

function createDefaultSettings(): HapticSettings {
  // 默认开启、标准强度：触觉反馈是移动端基础体验的一部分。
  return { enabled: true, intensity: 'standard' }
}

function loadSettings(): HapticSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createDefaultSettings()
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const defaults = createDefaultSettings()
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : defaults.enabled,
      intensity: isIntensity(parsed.intensity) ? parsed.intensity : defaults.intensity,
    }
  } catch {
    return createDefaultSettings()
  }
}

function saveSettings(settings: HapticSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // quota exceeded
  }
}

class HapticStore {
  private settings: HapticSettings = loadSettings()
  private subscribers = new Set<Subscriber>()

  subscribe = (cb: Subscriber): (() => void) => {
    this.subscribers.add(cb)
    return () => this.subscribers.delete(cb)
  }

  getSnapshot = (): HapticSettings => this.settings

  setEnabled(enabled: boolean) {
    if (this.settings.enabled === enabled) return
    this.settings = { ...this.settings, enabled }
    saveSettings(this.settings)
    this.subscribers.forEach(cb => cb())
  }

  setIntensity(intensity: HapticIntensity) {
    if (this.settings.intensity === intensity) return
    this.settings = { ...this.settings, intensity }
    saveSettings(this.settings)
    this.subscribers.forEach(cb => cb())
  }
}

export const hapticStore = new HapticStore()

export function useHapticSettings(): HapticSettings {
  return useSyncExternalStore(hapticStore.subscribe, hapticStore.getSnapshot)
}

export function normalizeHapticSettings(raw: unknown): HapticSettings {
  const defaults = createDefaultSettings()
  const parsed = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined
  return {
    enabled: typeof parsed?.enabled === 'boolean' ? parsed.enabled : defaults.enabled,
    intensity: isIntensity(parsed?.intensity) ? parsed.intensity : defaults.intensity,
  }
}

export function exportHapticBackup(): HapticSettings {
  return normalizeHapticSettings(hapticStore.getSnapshot())
}

export function importHapticBackup(raw: unknown): void {
  const settings = normalizeHapticSettings(raw)
  hapticStore.setEnabled(settings.enabled)
  hapticStore.setIntensity(settings.intensity)
}
