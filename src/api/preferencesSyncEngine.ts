// ============================================
// Preferences Sync Engine - 多端同步调度
//
// 职责：
//   1. 登录后首次拉取服务端偏好；
//   2. 监听本地设置变化（轮询指纹比对），防抖后推送；
//   3. 提供手动触发与状态查询给设置页。
//
// 采用「轮询 + 内容指纹」而非 patch localStorage.setItem：后者需要改写全局
// 对象，且无法覆盖直接操作 localStorage 的调用点（项目里存在多处），轮询能
// 统一捕获所有写入来源。
// ============================================

import { readAccount } from './aiagent'
import {
  collectLocalPreferences,
  isSyncEnabled,
  pushPreferences,
  syncPreferences,
} from './preferencesSync'

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'disabled'

export interface SyncState {
  status: SyncStatus
  lastSyncedAt: number
  error?: string
}

const POLL_INTERVAL_MS = 15_000
const PUSH_DEBOUNCE_MS = 2_000

let pollTimer: ReturnType<typeof setInterval> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let lastFingerprint = ''
let inFlight = false
let state: SyncState = { status: 'idle', lastSyncedAt: 0 }
const listeners = new Set<(state: SyncState) => void>()

function setState(next: Partial<SyncState>): void {
  state = { ...state, ...next }
  listeners.forEach(listener => listener(state))
}

export function getSyncState(): SyncState {
  return state
}

export function subscribeSyncState(listener: (state: SyncState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 与 preferencesSync 的指纹算法保持一致（键排序 + FNV-1a）。 */
function fingerprintEntries(): string {
  const entries = collectLocalPreferences()
  const keys = Object.keys(entries).sort()
  let hash = 2166136261
  for (const key of keys) {
    const line = `${key}=${entries[key]}`
    for (let index = 0; index < line.length; index += 1) {
      hash ^= line.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
  }
  return `${keys.length}:${(hash >>> 0).toString(16)}`
}

async function runPush(force: boolean): Promise<void> {
  if (inFlight) return
  inFlight = true
  setState({ status: 'syncing', error: undefined })
  try {
    const written = await pushPreferences(undefined, force)
    lastFingerprint = fingerprintEntries()
    setState({ status: 'synced', lastSyncedAt: Date.now(), error: undefined })
    if (written > 0 && import.meta.env.DEV) {
      console.log(`[prefs-sync] pushed ${written} preferences`)
    }
  } catch (error) {
    setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
  } finally {
    inFlight = false
  }
}

function schedulePush(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void runPush(false)
  }, PUSH_DEBOUNCE_MS)
}

function poll(): void {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  if (!isSyncEnabled() || !readAccount() || inFlight) return
  const current = fingerprintEntries()
  if (current === lastFingerprint) return
  schedulePush()
}

/**
 * 启动同步：首次做一次双向同步（拉取服务端、推送本地），随后轮询本地变化。
 * 未启用同步或未登录时为空操作。
 */
export async function startPreferencesSync(): Promise<void> {
  if (pollTimer) return
  if (!isSyncEnabled() || !readAccount()) return

  setState({ status: 'syncing' })
  try {
    await syncPreferences(undefined, true)
    lastFingerprint = fingerprintEntries()
    setState({ status: 'synced', lastSyncedAt: Date.now(), error: undefined })
  } catch (error) {
    setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
  }

  pollTimer = setInterval(poll, POLL_INTERVAL_MS)
}

export function stopPreferencesSync(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  setState({ status: 'idle' })
}

/** 手动触发一次双向同步（设置页按钮）。 */
export async function syncNow(): Promise<void> {
  if (!readAccount()) return
  setState({ status: 'syncing', error: undefined })
  try {
    await syncPreferences(undefined, true)
    lastFingerprint = fingerprintEntries()
    setState({ status: 'synced', lastSyncedAt: Date.now(), error: undefined })
  } catch (error) {
    setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}
