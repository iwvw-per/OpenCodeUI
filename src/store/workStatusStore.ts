// ============================================
// WorkStatusStore — 工作状态面板状态
// ============================================
//
// 管理对话列里的工作状态卡片：
//   - 用户总开关（面板是否启用）
//   - 板块顺序与隐藏集合（「面板板块」弹窗配置）
//   - 各折叠板块的展开态
//   - 面板滚动位置
//
// 顺序与隐藏分开存：顺序保留全部 id，隐藏只记 hidden，
// 这样配置弹窗始终能列出全部板块，勾选即可恢复。
//
// 展开态与滚动位置放在 store 而非组件 state：面板会随视口宽度被卸载，
// 本地 state 会静默丢掉用户的选择。

import { useSyncExternalStore } from 'react'
import {
  sanitizeWorkStatusHiddenSections,
  sanitizeWorkStatusSectionOrder,
  type WorkStatusSectionId,
} from '../features/workStatus/sections'

interface WorkStatusState {
  enabled: boolean
  order: WorkStatusSectionId[]
  hidden: WorkStatusSectionId[]
  expanded: Record<string, boolean>
  scrollTop: number
}

const STORAGE_KEY_ENABLED = 'opencode-work-status-enabled'
const STORAGE_KEY_ORDER = 'opencode-work-status-order'
const STORAGE_KEY_HIDDEN = 'opencode-work-status-hidden'
const STORAGE_KEY_EXPANDED = 'opencode-work-status-expanded'

/** 默认展开的折叠板块；其余折叠板块收起，避免面板一上来就铺满 */
const DEFAULT_EXPANDED: Record<string, boolean> = {
  tasks: true,
  subagents: true,
}

function sanitizeExpanded(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_EXPANDED }
  const result: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'boolean') result[key] = value
  }
  return result
}

class WorkStatusStore {
  private state: WorkStatusState = {
    enabled: true,
    order: sanitizeWorkStatusSectionOrder([]),
    hidden: [],
    expanded: { ...DEFAULT_EXPANDED },
    scrollTop: 0,
  }
  private listeners = new Set<() => void>()

  constructor() {
    try {
      const savedEnabled = localStorage.getItem(STORAGE_KEY_ENABLED)
      if (savedEnabled !== null) this.state.enabled = savedEnabled !== 'false'

      const savedOrder = localStorage.getItem(STORAGE_KEY_ORDER)
      if (savedOrder) this.state.order = sanitizeWorkStatusSectionOrder(JSON.parse(savedOrder))

      const savedHidden = localStorage.getItem(STORAGE_KEY_HIDDEN)
      if (savedHidden) this.state.hidden = sanitizeWorkStatusHiddenSections(JSON.parse(savedHidden))

      const savedExpanded = localStorage.getItem(STORAGE_KEY_EXPANDED)
      if (savedExpanded) this.state.expanded = sanitizeExpanded(JSON.parse(savedExpanded))
    } catch {
      // 保持默认
    }
  }

  getState(): WorkStatusState {
    return this.state
  }

  getSnapshot = (): WorkStatusState => this.state

  isEnabled(): boolean {
    return this.state.enabled
  }

  isSectionVisible(id: WorkStatusSectionId): boolean {
    return !this.state.hidden.includes(id)
  }

  getSectionOrder(): WorkStatusSectionId[] {
    return this.state.order
  }

  isSectionExpanded(id: string): boolean {
    return this.state.expanded[id] ?? DEFAULT_EXPANDED[id] ?? false
  }

  getScrollTop(): number {
    return this.state.scrollTop
  }

  setEnabled(enabled: boolean) {
    if (this.state.enabled === enabled) return
    this.state = { ...this.state, enabled }
    this.persist(STORAGE_KEY_ENABLED, String(enabled))
    this.emit()
  }

  toggleEnabled() {
    this.setEnabled(!this.state.enabled)
  }

  setSectionVisible(id: WorkStatusSectionId, visible: boolean) {
    const hidden = new Set(this.state.hidden)
    if (visible) hidden.delete(id)
    else hidden.add(id)
    const next = sanitizeWorkStatusHiddenSections([...hidden])
    if (next.length === this.state.hidden.length) return
    this.state = { ...this.state, hidden: next }
    this.persist(STORAGE_KEY_HIDDEN, JSON.stringify(next))
    this.emit()
  }

  setHiddenSections(ids: readonly string[]) {
    const next = sanitizeWorkStatusHiddenSections(ids)
    if (next.length === this.state.hidden.length && next.every((id, i) => id === this.state.hidden[i])) return
    this.state = { ...this.state, hidden: next }
    this.persist(STORAGE_KEY_HIDDEN, JSON.stringify(next))
    this.emit()
  }

  setSectionOrder(ids: readonly string[]) {
    const order = sanitizeWorkStatusSectionOrder(ids)
    if (order.length === this.state.order.length && order.every((id, i) => id === this.state.order[i])) return
    this.state = { ...this.state, order }
    this.persist(STORAGE_KEY_ORDER, JSON.stringify(order))
    this.emit()
  }

  setSectionExpanded(id: string, expanded: boolean) {
    if (this.isSectionExpanded(id) === expanded) return
    const next = { ...this.state.expanded, [id]: expanded }
    this.state = { ...this.state, expanded: next }
    this.persist(STORAGE_KEY_EXPANDED, JSON.stringify(next))
    this.emit()
  }

  setScrollTop(scrollTop: number) {
    if (this.state.scrollTop === scrollTop) return
    // 滚动位置只留在内存里：它属于当前会话的面板，不该跨会话恢复，
    // 也经不起每次滚动都写 localStorage。
    this.state = { ...this.state, scrollTop }
    this.listeners.forEach(fn => fn())
  }

  private persist(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch {
      // ignore
    }
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    this.listeners.forEach(fn => fn())
  }
}

export const workStatusStore = new WorkStatusStore()

export function useWorkStatus() {
  return useSyncExternalStore(workStatusStore.subscribe, workStatusStore.getSnapshot, workStatusStore.getSnapshot)
}
