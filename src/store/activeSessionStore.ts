// ============================================
// ActiveSessionStore - 追踪所有 session 的活跃状态
// ============================================
//
// 职责单一：只管 session 是否活跃、在等什么
//
// 数据来源：
// 1. GET /session/status → 全量 session 状态
// 2. GET /permission + GET /question → 补充等待中的 session
// 3. SSE session.status / permission.asked / question.asked 事件
//
// 与 notificationStore 完全独立，不互相依赖

import { useCallback, useSyncExternalStore } from 'react'
import type { SessionStatus, SessionStatusMap } from '../types/api/session'

// ============================================
// Types
// ============================================

export interface PendingRequest {
  requestId: string
  sessionId: string
  type: 'permission' | 'question'
  description?: string
}

export interface ActiveSessionEntry {
  sessionId: string
  status: SessionStatus
  title?: string
  directory?: string
  /** session 当前等待的用户操作 */
  pendingAction?: {
    type: 'permission' | 'question'
    description?: string
  }
}

interface SessionMetaEntry {
  sessionId: string
  title?: string
  directory?: string
}

interface ActiveSessionState {
  statusMap: SessionStatusMap
  initialized: boolean
}

type Subscriber = () => void

function isSameBusySessions(a: ActiveSessionEntry[], b: ActiveSessionEntry[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const left = a[i]
    const right = b[i]
    if (left.sessionId !== right.sessionId) return false
    if (left.title !== right.title || left.directory !== right.directory) return false
    if (left.pendingAction?.type !== right.pendingAction?.type) return false
    if (left.pendingAction?.description !== right.pendingAction?.description) return false
    if (left.status.type !== right.status.type) return false
    if (left.status.type === 'retry' && right.status.type === 'retry') {
      if (
        left.status.attempt !== right.status.attempt ||
        left.status.message !== right.status.message ||
        left.status.next !== right.status.next
      ) {
        return false
      }
    }
  }
  return true
}

// ============================================
// Store
// ============================================

class ActiveSessionStore {
  private state: ActiveSessionState = {
    statusMap: {},
    initialized: false,
  }
  private subscribers = new Set<Subscriber>()

  // session 元信息缓存（title, directory）
  private sessionMeta = new Map<string, { title?: string; directory?: string }>()

  // 未回复的 permission/question 请求 — requestId → PendingRequest
  private pendingRequests = new Map<string, PendingRequest>()

  // 服务端已报告 idle，但因有未回复请求而暂缓移出的 session
  private deferredIdleSessions = new Set<string>()

  // 派生数据缓存
  private cachedBusySessions: ActiveSessionEntry[] = []
  private cachedBusyCount: number = 0

  subscribe = (callback: Subscriber): (() => void) => {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  private notify() {
    this.recomputeDerived()
    this.subscribers.forEach(cb => {
      cb()
    })
  }

  private recomputeDerived() {
    const entries = Object.entries(this.state.statusMap)
      .filter(([, status]) => status.type === 'busy' || status.type === 'retry')
      .map(([sessionId, status]) => {
        const meta = this.sessionMeta.get(sessionId)
        // 从自身 pendingRequests 查 pending action
        const pending = this.findPendingForSession(sessionId)
        return {
          sessionId,
          status,
          title: meta?.title,
          directory: meta?.directory,
          pendingAction: pending ? { type: pending.type, description: pending.description } : undefined,
        } as ActiveSessionEntry
      })
    // 内容不变时复用旧数组引用，避免 useBusySessions 订阅方因引用抖动重渲染
    if (!isSameBusySessions(this.cachedBusySessions, entries)) {
      this.cachedBusySessions = entries
    }
    this.cachedBusyCount = entries.length
  }

  private findPendingForSession(sessionId: string): PendingRequest | undefined {
    for (const req of this.pendingRequests.values()) {
      if (req.sessionId === sessionId) return req
    }
    return undefined
  }

  private hasPendingForSession(sessionId: string): boolean {
    for (const req of this.pendingRequests.values()) {
      if (req.sessionId === sessionId) return true
    }
    return false
  }

  getSnapshot = (): ActiveSessionState => this.state
  getBusySessionsSnapshot = (): ActiveSessionEntry[] => this.cachedBusySessions
  getBusyCountSnapshot = (): number => this.cachedBusyCount

  /**
   * 取单个 session 的 status 引用。
   * statusMap 未命中时返回 undefined，两者引用都稳定，
   * 供 useSessionStatus 作为 useSyncExternalStore 的 getSnapshot。
   */
  getSessionStatus(sessionId: string): SessionStatus | undefined {
    return this.state.statusMap[sessionId]
  }

  /**
   * 取单个 session 的活跃条目。
   * cachedBusySessions 内容不变时数组引用稳定，且 recomputeDerived 复用旧数组，
   * 因此未命中（undefined）与命中（同一元素引用）都满足 useSyncExternalStore 的稳定引用契约。
   */
  getBusySessionEntry(sessionId: string): ActiveSessionEntry | undefined {
    return this.cachedBusySessions.find(entry => entry.sessionId === sessionId)
  }

  private applyStatusSnapshot(statusMap: SessionStatusMap, baseMap: SessionStatusMap): SessionStatusMap {
    const nextMap = { ...baseMap }

    for (const [sessionId, status] of Object.entries(statusMap)) {
      if (status.type === 'idle') {
        delete nextMap[sessionId]
        continue
      }

      nextMap[sessionId] = status.type === 'retry' ? { ...status } : { type: 'busy' }
    }

    return nextMap
  }

  // ============================================
  // 初始化：从 API 拉取全量状态
  // ============================================

  initialize(statusMap: SessionStatusMap) {
    this.state = {
      statusMap: this.applyStatusSnapshot(statusMap, {}),
      initialized: true,
    }
    this.notify()
  }

  // ============================================
  // 范围刷新：返回值不是全量状态，只更新这次明确返回的 session
  // ============================================

  mergeStatusRefresh(statusMap: SessionStatusMap) {
    this.state = {
      statusMap: this.applyStatusSnapshot(statusMap, this.state.statusMap),
      initialized: true,
    }
    this.notify()
  }

  // ============================================
  // 初始化：从 /permission + /question API 补充
  // ============================================

  initializePendingRequests(
    permissions: Array<{ id: string; sessionID: string; permission: string; patterns?: string[] }>,
    questions: Array<{ id: string; sessionID: string; questions?: Array<{ header?: string }> }>,
  ) {
    this.applyPendingSnapshot(permissions, questions, new Map<string, PendingRequest>(), new Set<string>())
  }

  // ============================================
  // 范围刷新：保留这次范围外已知的 pending request
  // ============================================

  mergePendingRequests(
    permissions: Array<{ id: string; sessionID: string; permission: string; patterns?: string[] }>,
    questions: Array<{ id: string; sessionID: string; questions?: Array<{ header?: string }> }>,
  ) {
    this.applyPendingSnapshot(permissions, questions, new Map(this.pendingRequests), new Set(this.deferredIdleSessions))
  }

  private applyPendingSnapshot(
    permissions: Array<{ id: string; sessionID: string; permission: string; patterns?: string[] }>,
    questions: Array<{ id: string; sessionID: string; questions?: Array<{ header?: string }> }>,
    pendingRequests: Map<string, PendingRequest>,
    deferredIdleSessions: Set<string>,
  ) {
    let changed = false
    const newMap = { ...this.state.statusMap }

    for (const p of permissions) {
      const desc = p.patterns?.length ? `${p.permission}: ${p.patterns[0]}` : p.permission
      pendingRequests.set(p.id, {
        requestId: p.id,
        sessionId: p.sessionID,
        type: 'permission',
        description: desc,
      })
      if (!newMap[p.sessionID] || newMap[p.sessionID].type === 'idle') {
        newMap[p.sessionID] = { type: 'busy' }
        deferredIdleSessions.add(p.sessionID)
        changed = true
      }
    }

    for (const q of questions) {
      const desc = q.questions?.[0]?.header || 'Waiting for input'
      pendingRequests.set(q.id, {
        requestId: q.id,
        sessionId: q.sessionID,
        type: 'question',
        description: desc,
      })
      if (!newMap[q.sessionID] || newMap[q.sessionID].type === 'idle') {
        newMap[q.sessionID] = { type: 'busy' }
        deferredIdleSessions.add(q.sessionID)
        changed = true
      }
    }

    this.pendingRequests = pendingRequests
    this.deferredIdleSessions = deferredIdleSessions

    if (changed) {
      this.state = { ...this.state, statusMap: newMap }
    }
    this.notify()
  }

  // ============================================
  // SSE 事件：permission/question asked → 注册 pending
  // ============================================

  addPendingRequest(requestId: string, sessionId: string, type: 'permission' | 'question', description?: string) {
    this.pendingRequests.set(requestId, { requestId, sessionId, type, description })
    // 确保 session 在 busy 列表
    if (!this.state.statusMap[sessionId] || this.state.statusMap[sessionId].type === 'idle') {
      const newMap = { ...this.state.statusMap, [sessionId]: { type: 'busy' as const } }
      this.deferredIdleSessions.add(sessionId)
      this.state = { ...this.state, statusMap: newMap }
    }
    this.notify()
  }

  // ============================================
  // SSE 事件：permission/question replied → 移除 pending
  // ============================================

  resolvePendingRequest(requestId: string) {
    const req = this.pendingRequests.get(requestId)
    if (!req) return
    this.pendingRequests.delete(requestId)

    // 检查该 session 是否还有其他 pending，没有且 deferred 就移出 busy
    if (this.deferredIdleSessions.has(req.sessionId) && !this.hasPendingForSession(req.sessionId)) {
      this.deferredIdleSessions.delete(req.sessionId)
      const newMap = { ...this.state.statusMap }
      delete newMap[req.sessionId]
      this.state = { ...this.state, statusMap: newMap }
    }
    this.notify()
  }

  // ============================================
  // SSE 事件：session status 更新
  // ============================================

  updateStatus(sessionId: string, status: SessionStatus) {
    const newMap = { ...this.state.statusMap }

    if (status.type === 'idle') {
      if (this.hasPendingForSession(sessionId)) {
        this.deferredIdleSessions.add(sessionId)
      } else {
        this.deferredIdleSessions.delete(sessionId)
        delete newMap[sessionId]
      }
    } else if (status.type === 'retry') {
      this.deferredIdleSessions.delete(sessionId)
      newMap[sessionId] = { ...status }
    } else {
      this.deferredIdleSessions.delete(sessionId)
      newMap[sessionId] = { type: 'busy' }
    }

    this.state = { ...this.state, statusMap: newMap }
    this.notify()
  }

  removeSession(sessionId: string) {
    let changed = false
    let nextMap = this.state.statusMap

    if (nextMap[sessionId]) {
      nextMap = { ...nextMap }
      delete nextMap[sessionId]
      changed = true
    }

    for (const [requestId, request] of this.pendingRequests) {
      if (request.sessionId !== sessionId) continue
      this.pendingRequests.delete(requestId)
      changed = true
    }

    if (this.deferredIdleSessions.delete(sessionId)) changed = true
    if (this.sessionMeta.delete(sessionId)) changed = true

    if (!changed) return
    this.state = { ...this.state, statusMap: nextMap }
    this.notify()
  }

  // ============================================
  // Session 元信息管理
  // ============================================

  setSessionMeta(sessionId: string, title?: string, directory?: string) {
    const existing = this.sessionMeta.get(sessionId)
    const newTitle = title ?? existing?.title
    const newDir = directory ?? existing?.directory
    if (newTitle !== existing?.title || newDir !== existing?.directory) {
      this.sessionMeta.set(sessionId, { title: newTitle, directory: newDir })
      this.notify()
    }
  }

  setSessionMetaBulk(entries: SessionMetaEntry[]) {
    let changed = false

    for (const entry of entries) {
      const existing = this.sessionMeta.get(entry.sessionId)
      const newTitle = entry.title ?? existing?.title
      const newDir = entry.directory ?? existing?.directory

      if (newTitle !== existing?.title || newDir !== existing?.directory) {
        this.sessionMeta.set(entry.sessionId, { title: newTitle, directory: newDir })
        changed = true
      }
    }

    if (changed) {
      this.notify()
    }
  }

  getSessionMeta(sessionId: string) {
    return this.sessionMeta.get(sessionId)
  }

  getBusySessions(): ActiveSessionEntry[] {
    return this.cachedBusySessions
  }

  get busyCount(): number {
    return this.cachedBusyCount
  }
}

// ============================================
// Singleton & React Hooks
// ============================================

export const activeSessionStore = new ActiveSessionStore()

export function useActiveSessionStore() {
  return useSyncExternalStore(activeSessionStore.subscribe, activeSessionStore.getSnapshot)
}

export function useBusySessions(): ActiveSessionEntry[] {
  return useSyncExternalStore(activeSessionStore.subscribe, activeSessionStore.getBusySessionsSnapshot)
}

export function useBusyCount(): number {
  return useSyncExternalStore(activeSessionStore.subscribe, activeSessionStore.getBusyCountSnapshot)
}

/**
 * 按 sessionId 查活跃状态，不活跃时返回 undefined。
 *
 * 说明：仍使用 store 级别的 subscribe（任意 session 变化都会触发本 hook 回调），
 * 但 getSnapshot 返回的是 cachedBusySessions 中已缓存的元素引用，未命中时为 undefined，
 * 两者引用都稳定，因此 useSyncExternalStore 不会因引用抖动导致额外渲染。
 * 若后续要彻底避免无关 session 变化带来的回调开销，可在 store 内增加按 sessionId 的订阅表
 * （参考 messageStore.subscribeSession）。
 */
export function useSessionActiveEntry(sessionId: string): ActiveSessionEntry | undefined {
  const getSnapshot = useCallback(
    () => activeSessionStore.getBusySessionEntry(sessionId),
    [sessionId],
  )
  return useSyncExternalStore(activeSessionStore.subscribe, getSnapshot)
}

/**
 * 只订阅单个 session 的 status。
 *
 * 任意其它 session 的 busy/retry 变化都不会让本组件重渲染；getSnapshot 直接返回
 * statusMap 里的元素引用，未变化时引用稳定，不会触发额外渲染。
 */
export function useSessionStatus(sessionId: string | null): SessionStatus | undefined {
  const getSnapshot = useCallback(
    () => (sessionId ? activeSessionStore.getSessionStatus(sessionId) : undefined),
    [sessionId],
  )
  return useSyncExternalStore(activeSessionStore.subscribe, getSnapshot)
}
