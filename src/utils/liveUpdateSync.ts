// ============================================
// Live Update Sync - 会话进行中 → Android 实况通知
// ============================================
//
// 订阅 activeSessionStore：有会话进入 busy/retry 时发布实况通知（ColorOS 流体云），
// 状态或文案变化时节流更新，全部结束或出错时取消。
// 非 Android 环境桥不存在，本模块静默无操作。
//
// 健壮性：
// - 空状态宽限期：SSE 重连窗口内 busy 列表可能短暂为空，避免误取消通知。
// - 回前台强制重发：系统清掉通知后，回前台时若仍有进行中会话则重新发布。

import i18n from '../i18n'
import { activeSessionStore, type ActiveSessionEntry } from '../store/activeSessionStore'
import { paneLayoutStore } from '../store/paneLayoutStore'
import { notificationEventSettingsStore } from '../store/notificationEventSettingsStore'
import {
  startLiveUpdate,
  updateLiveUpdate,
  endLiveUpdate,
  liveUpdateSupported,
  type LiveUpdatePayload,
  type LiveUpdateSegment,
} from '../utils/liveUpdate'

const LIVE_UPDATE_ID = 9001
const UPDATE_THROTTLE_MS = 1000
/** busy 列表变空后，等待这么久再取消通知，避开 SSE 重连/切主机的瞬时空窗 */
const EMPTY_GRACE_MS = 4000
/** 标题单行宽度上限（全角按 2、半角按 1），超出截断加省略号 */
const TITLE_MAX_WIDTH = 28

let unsub: (() => void) | null = null
let started = false
let lastSignature = ''
let lastUpdateAt = 0
let timer: number | null = null
let emptyTimer: number | null = null
let visibilityHandler: (() => void) | null = null

/** 当前激活会话的复合 key（serverId::sessionId），与 activeSessionStore 内的键一致 */
function focusedSessionKey(): string | null {
  return paneLayoutStore.getFocusedSessionId() || null
}

/** 折叠空白并截断到单行宽度，避免系统通知标题换行成两行 */
function toSingleLineTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return flat
  let width = 0
  let out = ''
  for (const ch of flat) {
    const w = ch.charCodeAt(0) > 0x2e80 ? 2 : 1
    if (width + w > TITLE_MAX_WIDTH) return `${out}…`
    width += w
    out += ch
  }
  return out
}

function buildSignature(entries: ActiveSessionEntry[]): string {
  const focus = focusedSessionKey() ?? ''
  return (
    `@${focus}|` +
    entries
      .map(e => `${e.sessionId}|${e.status.type}|${e.pendingAction?.type ?? ''}`)
      .sort()
      .join(',')
  )
}

function isBlocked(entry: ActiveSessionEntry): boolean {
  return !!entry.pendingAction
}

function statusText(entry: ActiveSessionEntry): string {
  if (entry.pendingAction?.type === 'permission') return i18n.t('chat:activeSession.awaitingPermission')
  if (entry.pendingAction?.type === 'question') return i18n.t('chat:activeSession.awaitingAnswer')
  if (entry.status.type === 'retry') return i18n.t('chat:activeSession.retrying')
  return i18n.t('chat:activeSession.working')
}

function projectName(entry: ActiveSessionEntry): string {
  const dir = entry.directory
  if (!dir) return ''
  const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

function buildPayload(entries: ActiveSessionEntry[]): LiveUpdatePayload {
  const focusedKey = focusedSessionKey()
  const focusedEntry = focusedKey ? entries.find(e => e.sessionId === focusedKey) : undefined
  const blockedEntry = entries.find(isBlocked)
  // 状态优先展示阻塞会话，让用户一眼看到需要介入
  const statusEntry = blockedEntry ?? focusedEntry ?? entries[0]
  // 会话标题跟随当前激活会话；激活会话不在进行中列表时回退到阻塞会话，再回退到第一个
  const titleEntry = focusedEntry ?? blockedEntry ?? entries[0]

  const total = entries.length
  const statusLabel = statusText(statusEntry)
  // 第一行：状态 + 任务数量
  const headline =
    total > 1
      ? `${statusLabel} · ${i18n.t('chat:activeSession.tasksCount', { count: total })}`
      : statusLabel
  // 第二行：会话标题（单行截断，避免通知卡片过高）
  const sessionTitle = toSingleLineTitle(titleEntry.title || i18n.t('chat:activeSession.working'))
  // 胶囊收起时显示：状态 + 进行中会话数量
  const shortText = total > 1 ? `${statusLabel} · ${total}` : statusLabel

  const payload: LiveUpdatePayload = {
    id: LIVE_UPDATE_ID,
    title: headline,
    body: sessionTitle,
    shortText,
    sessionId: titleEntry.sessionId,
    updatedAt: Date.now(),
  }
  const project = projectName(titleEntry)
  if (project) payload.subText = project

  if (total >= 2) {
    // 多会话：分段进度条，每段一个会话，阻塞段用警告色
    payload.segments = entries.map<LiveUpdateSegment>(e => ({ blocked: isBlocked(e) }))
  } else if (blockedEntry) {
    // 单会话阻塞：满进度条 + 阻塞文案
    payload.progress = 100
  } else {
    // 单会话进行中：不确定进度
    payload.indeterminate = true
  }
  return payload
}

function flush(entries: ActiveSessionEntry[], force: boolean): void {
  const now = Date.now()
  if (!force && now - lastUpdateAt < UPDATE_THROTTLE_MS) return
  lastUpdateAt = now
  const payload = buildPayload(entries)
  if (force) {
    startLiveUpdate(payload)
  } else {
    updateLiveUpdate(payload)
  }
}

function clearEmptyTimer(): void {
  if (emptyTimer !== null) {
    window.clearTimeout(emptyTimer)
    emptyTimer = null
  }
}

function endNow(): void {
  clearEmptyTimer()
  endLiveUpdate(LIVE_UPDATE_ID)
  started = false
  lastSignature = ''
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
}

function sync(): void {
  const entries = activeSessionStore.getBusySessions()

  // 无进行中会话：给宽限期，避开 SSE 重连窗口内的瞬时空状态。
  // 仅在 store 已完成初始化后才允许取消，避免冷启动时 SSE 尚未拉到状态就误清原生恢复的通知。
  if (entries.length === 0) {
    if (activeSessionStore.getSnapshot().initialized && emptyTimer === null) {
      emptyTimer = window.setTimeout(() => {
        emptyTimer = null
        if (activeSessionStore.getBusySessions().length === 0) endNow()
      }, EMPTY_GRACE_MS)
    }
    return
  }

  // 有会话了：取消待执行的空状态取消
  clearEmptyTimer()

  if (!notificationEventSettingsStore.isLiveUpdateEnabled()) {
    if (started) endNow()
    return
  }

  const signature = buildSignature(entries)
  if (signature === lastSignature) return

  if (!started) {
    started = true
    lastSignature = signature
    flush(entries, true)
    return
  }

  lastSignature = signature
  const elapsed = Date.now() - lastUpdateAt
  if (elapsed >= UPDATE_THROTTLE_MS) {
    flush(entries, false)
  } else if (timer === null) {
    // 节流：合并窗口内的多次变化，到点后按最新状态更新一次
    timer = window.setTimeout(() => {
      timer = null
      const latest = activeSessionStore.getBusySessions()
      if (latest.length > 0) flush(latest, false)
    }, UPDATE_THROTTLE_MS - elapsed)
  }
}

/**
 * 回前台时强制重发：系统可能在后台清掉通知，或前台服务被重启后丢失内容。
 * 只要仍有进行中会话，就重新发布一次（force=true 走 start 路径，会重建前台服务）。
 */
function resyncOnForeground(): void {
  if (typeof document === 'undefined') return
  if (document.visibilityState !== 'visible') return
  if (!notificationEventSettingsStore.isLiveUpdateEnabled()) return
  const entries = activeSessionStore.getBusySessions()
  if (entries.length === 0) return
  clearEmptyTimer()
  started = true
  lastSignature = buildSignature(entries)
  flush(entries, true)
}

export function initLiveUpdateSync(): () => void {
  if (!liveUpdateSupported()) return () => {}
  if (unsub) return unsub
  const offSessions = activeSessionStore.subscribe(sync)
  const offSettings = notificationEventSettingsStore.subscribe(sync)
  const offLayout = paneLayoutStore.subscribe(sync)
  visibilityHandler = resyncOnForeground
  document.addEventListener('visibilitychange', visibilityHandler)
  unsub = () => {
    offSessions()
    offSettings()
    offLayout()
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
    clearEmptyTimer()
  }
  sync()
  return () => {
    if (unsub) {
      unsub()
      unsub = null
    }
    if (started) endNow()
  }
}
