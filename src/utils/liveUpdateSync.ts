// ============================================
// Live Update Sync - 会话进行中 → Android 实况通知
// ============================================
//
// 订阅 activeSessionStore：有会话进入 busy/retry 时发布实况通知（ColorOS 流体云），
// 状态或文案变化时节流更新，全部结束或出错时取消。
// 非 Android 环境桥不存在，本模块静默无操作。

import i18n from '../i18n'
import { activeSessionStore, type ActiveSessionEntry } from '../store/activeSessionStore'
import { notificationEventSettingsStore } from '../store/notificationEventSettingsStore'
import {
  startLiveUpdate,
  updateLiveUpdate,
  endLiveUpdate,
  liveUpdateSupported,
} from '../utils/liveUpdate'

const LIVE_UPDATE_ID = 9001
const UPDATE_THROTTLE_MS = 1000

let unsub: (() => void) | null = null
let started = false
let lastSignature = ''
let lastUpdateAt = 0
let timer: number | null = null

function buildSignature(entries: ActiveSessionEntry[]): string {
  return entries
    .map(e => `${e.sessionId}|${e.status.type}|${e.pendingAction?.type ?? ''}`)
    .sort()
    .join(',')
}

function statusText(entry: ActiveSessionEntry): string {
  if (entry.pendingAction?.type === 'permission') return i18n.t('chat:activeSession.awaitingPermission')
  if (entry.pendingAction?.type === 'question') return i18n.t('chat:activeSession.awaitingAnswer')
  if (entry.status.type === 'retry') return i18n.t('chat:activeSession.retrying')
  return i18n.t('chat:activeSession.working')
}

function buildPayload(entries: ActiveSessionEntry[]) {
  const first = entries[0]
  const title = first.title || i18n.t('chat:activeSession.working')
  const body =
    entries.length > 1 ? `${statusText(first)} · +${entries.length - 1}` : statusText(first)
  const hasPending = entries.some(e => !!e.pendingAction)
  const payload: {
    id: number
    title: string
    body: string
    shortText: string
    sessionId: string
    progress?: number
  } = {
    id: LIVE_UPDATE_ID,
    title,
    body,
    shortText: statusText(first),
    sessionId: first.sessionId,
  }
  // 等待用户操作时给满进度条（表示已到需要介入的节点），否则不确定进度
  if (hasPending) payload.progress = 100
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

function sync(): void {
  const entries = activeSessionStore.getBusySessions()

  // 无进行中会话：结束并复位
  if (entries.length === 0) {
    if (started) {
      endLiveUpdate(LIVE_UPDATE_ID)
      started = false
      lastSignature = ''
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
    }
    return
  }

  if (!notificationEventSettingsStore.isLiveUpdateEnabled()) {
    if (started) {
      endLiveUpdate(LIVE_UPDATE_ID)
      started = false
      lastSignature = ''
    }
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

export function initLiveUpdateSync(): () => void {
  if (!liveUpdateSupported()) return () => {}
  if (unsub) return unsub
  const offSessions = activeSessionStore.subscribe(sync)
  const offSettings = notificationEventSettingsStore.subscribe(sync)
  unsub = () => {
    offSessions()
    offSettings()
  }
  sync()
  return () => {
    if (unsub) {
      unsub()
      unsub = null
    }
    if (started) {
      endLiveUpdate(LIVE_UPDATE_ID)
      started = false
    }
  }
}
