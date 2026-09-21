// ============================================
// Preferences Sync Engine - 多端同步调度
//
// 职责：
//   1. 登录后首次做一次双向同步；
//   2. 轮询（本地变化或固定间隔）触发双向同步，把别的端的改动拉下来、
//      把本地改动推上去；
//   3. 提供手动触发与状态查询给设置页。
//
// 采用「轮询 + 内容指纹」而非 patch localStorage.setItem：后者需要改写全局
// 对象，且无法覆盖直接操作 localStorage 的调用点（项目里存在多处），轮询能
// 统一捕获所有写入来源。
//
// 轮询是双向的（此前只推不拉，导致 A 端改动要等重启才可见，且 B 端会持续用
// 旧值把 A 端的改动顶回去）。为避免「拉下来又立刻推回去」的抖动，每轮结束
// 后重新采样指纹：拉取写入的值会被计入基线，下一轮不会因它再触发同步。
// 本地指纹未变时也会按轮询间隔做一次双向同步，保证服务端改动能被动拉下来。
// 同步器本身为未被本地改动的键沿用逐键时间戳，不会用当前时间顶掉服务端。
// ============================================

import { readAccount } from './aiagent'
import {
  collectLocalPreferences,
  isSyncEnabled,
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
let lastSyncAt = 0
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

/**
 * 统一的同步入口：所有触发路径（首同步、轮询、手动）都经此执行，
 * 以 inFlight 保证同一时刻只有一条链路在读写 stamps / tombstones。
 */
async function runSync(force: boolean): Promise<void> {
  if (inFlight) return
  if (!isSyncEnabled() || !readAccount()) return
  inFlight = true
  setState({ status: 'syncing', error: undefined })
  try {
    const { pulled, pushed } = await syncPreferences(undefined, force)
    lastFingerprint = fingerprintEntries()
    lastSyncAt = Date.now()
    setState({ status: 'synced', lastSyncedAt: Date.now(), error: undefined })
    if ((pulled > 0 || pushed > 0) && import.meta.env.DEV) {
      console.log(`[prefs-sync] pulled ${pulled}, pushed ${pushed} preferences`)
    }
  } catch (error) {
    setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
  } finally {
    inFlight = false
  }
}

function scheduleSync(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void runSync(false)
  }, PUSH_DEBOUNCE_MS)
}

function poll(): void {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  if (!isSyncEnabled() || !readAccount() || inFlight) return
  const current = fingerprintEntries()
  if (current !== lastFingerprint) {
    // 指纹已变说明本地有未推送的改动；若此刻同步在途，runSync 会在 finally 后
    // 由下一次 poll 处理，不额外排队，避免与在途链路争抢 stamps。
    scheduleSync()
    return
  }
  if (Date.now() - lastSyncAt < POLL_INTERVAL_MS) return
  void runSync(false)
}

/**
 * 启动同步：首次做一次双向同步（拉取服务端、推送本地），随后轮询触发双向
 * 同步。未启用同步或未登录时为空操作。
 */
export async function startPreferencesSync(): Promise<void> {
  if (pollTimer) return
  if (!isSyncEnabled() || !readAccount()) return

  // 经 runSync 统一互斥：登录与轮询可能同时触发，直接调 syncPreferences 会
  // 绕过 inFlight 造成两条链路并发写 stamps。
  await runSync(true)

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
  await runSync(true)
}
