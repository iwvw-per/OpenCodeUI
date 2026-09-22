// ============================================
// Preferences Sync Engine - 多端同步调度
//
// 职责：
//   1. 登录后首次做一次双向同步；
//   2. 服务端推送（SSE）到达时立刻同步，把「别的端的改动」接近实时地拉下来；
//   3. 轮询（本地变化或固定间隔）作为兜底与本地改动的上传通道；
//   4. 提供手动触发与状态查询给设置页。
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
//
// SSE 只是加速通道：它不改变同步语义，断开时自动重连并退化为纯轮询，正确性
// 不依赖它。
// ============================================

import { readAccount } from './aiagent'
import { subscribePreferenceEvents, type PreferenceEventsSubscription } from './preferencesEvents'
import {
  collectLocalPreferences,
  isSyncEnabled,
  isSyncableKey,
  syncPreferences,
} from './preferencesSync'
import { subscribePerServerStorageVersion } from '../utils/perServerStorage'

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'disabled'

export interface SyncState {
  status: SyncStatus
  lastSyncedAt: number
  error?: string
}

const POLL_INTERVAL_MS = 15_000
// 本地改动合并窗口：一次编辑常触发多次写入（如删一项后重排），需要合并成一次
// 上传；但不能太长，否则「改完立刻看另一台」的体感变差。500ms 足以吸收连写，
// 又让上传几乎立刻发生。
const PUSH_DEBOUNCE_MS = 500

let pollTimer: ReturnType<typeof setInterval> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let eventsSubscription: PreferenceEventsSubscription | null = null
let storageUnsubscribe: (() => void) | null = null
let lastFingerprint = ''
let lastSyncAt = 0
let inFlight = false
let pendingSync = false
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
  if (inFlight) {
    // 在途时被请求的同步不能直接丢弃：远端变更通知（SSE）若正好撞上在途同步，
    // 丢弃就只能等下一次轮询。这里记一个待办，在 finally 里补跑一次。
    pendingSync = true
    return
  }
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
    if (pendingSync) {
      pendingSync = false
      scheduleSync()
    }
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
 * 收到服务端变更通知时触发一次同步。
 *
 * 只对命中同步白名单的键作出反应：服务端会把该用户所有偏好变更都推过来
 * （含本机专属键），那些键本地既不读写也无同步价值，跟着跑一次同步纯属浪费。
 * 若此刻同步在途，走 debounce 排队而不是直接并发，避免两条链路争抢 stamps。
 */
function handlePreferenceChange(keys: string[]): void {
  if (!isSyncEnabled() || !readAccount()) return
  if (!keys.some(isSyncableKey)) return
  scheduleSync()
}

function startEventSubscription(): void {
  if (eventsSubscription) return
  eventsSubscription = subscribePreferenceEvents({ onEvent: event => handlePreferenceChange(event.keys) })
}

function stopEventSubscription(): void {
  eventsSubscription?.close()
  eventsSubscription = null
}

/**
 * 本地改动即时入队。
 *
 * 只靠轮询的话，改完项目要等最多一个轮询周期（15 秒）才被发现并上传 ——
 * 这是端到端延迟里最大的一段。这里订阅 per-server 存储的写入通知，本地一改
 * 立刻进入 2 秒 debounce，把「本端发现改动」从 0~15 秒压到 0 秒。
 *
 * 注意不能直接 runSync：一次编辑会连续触发多次写入（如删一项后重排），
 * 走 debounce 合并成一次上传。另外这个通知也会被「拉取写入」触发，
 * 那时指纹已与基线一致，pushPreferences 会因指纹相同而短路，不会空转。
 */
function startStorageSubscription(): void {
  if (storageUnsubscribe) return
  storageUnsubscribe = subscribePerServerStorageVersion(() => {
    if (!isSyncEnabled() || !readAccount()) return
    scheduleSync()
  })
}

function stopStorageSubscription(): void {
  storageUnsubscribe?.()
  storageUnsubscribe = null
}

/**
 * 启动同步：首次做一次双向同步（拉取服务端、推送本地），随后建立 SSE 订阅
 * 并按轮询间隔兜底同步。未启用同步或未登录时为空操作。
 */
export async function startPreferencesSync(): Promise<void> {
  if (pollTimer) return
  if (!isSyncEnabled() || !readAccount()) return

  // 经 runSync 统一互斥：登录与轮询可能同时触发，直接调 syncPreferences 会
  // 绕过 inFlight 造成两条链路并发写 stamps。
  await runSync(true)

  startEventSubscription()
  startStorageSubscription()
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
  pendingSync = false
  stopEventSubscription()
  stopStorageSubscription()
  setState({ status: 'idle' })
}

/** 手动触发一次双向同步（设置页按钮）。 */
export async function syncNow(): Promise<void> {
  if (!readAccount()) return
  await runSync(true)
}
