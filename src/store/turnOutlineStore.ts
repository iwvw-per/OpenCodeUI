// ============================================
// turnOutlineStore - 独立的会话轮次大纲缓存
// ============================================
//
// 侧边时间轴（OutlineIndex）原先直接读「已加载进内存的消息」生成条目，
// 于是历史没加载完时轴上就没有更早的轮次——用户必须一路往上滚，轴才补齐。
//
// 本 store 把「轮次大纲」从消息加载里解耦出来：
//   - 随分页/SSE 增量累积 user 轮次（id + 标题 + 创建时间），去重合并
//   - 按 serverId + sessionId 持久化到 localStorage，重挂/切换会话立即有完整轴
//   - 内存态用 Map 索引，合并与查询 O(1)
//
// 边界：它只负责「有哪些轮次、标题是什么」，不持有消息本体；消息内容仍由
// messageStore 管。两者以 messageId 关联，轴点击滚动仍走 ChatArea 的
// scrollToMessageId（目标未加载时由现有分页兜底）。
// ============================================

import type { TurnOutlineEntry } from '../components/outlineIndexModel'
import { serverStorage } from '../utils/perServerStorage'

const STORAGE_KEY = 'turn-outline'
const MAX_ENTRIES_PER_SESSION = 2000
const MAX_SESSIONS = 64

interface SessionOutline {
  entries: TurnOutlineEntry[]
  /** messageId → 条目下标，合并时去重 */
  index: Map<string, number>
}

class TurnOutlineStore {
  private sessions = new Map<string, SessionOutline>()
  private subscribers = new Set<() => void>()
  private version = 0
  /** 快照缓存：满足 useSyncExternalStore 的稳定引用要求 */
  private snapshotCache = new Map<string, { version: number; value: TurnOutlineEntry[] }>()

  subscribe = (fn: () => void): (() => void) => {
    this.subscribers.add(fn)
    return () => {
      this.subscribers.delete(fn)
    }
  }

  private emit() {
    this.version++
    this.snapshotCache.clear()
    for (const fn of this.subscribers) fn()
  }

  /** 会话 key：`serverId::sessionId` */
  private key(serverId: string, sessionId: string): string {
    return `${serverId}::${sessionId}`
  }

  private getOrLoad(serverId: string, sessionId: string): SessionOutline {
    const key = this.key(serverId, sessionId)
    const existing = this.sessions.get(key)
    if (existing) return existing

    const stored = serverStorage.getJSONFor<Record<string, TurnOutlineEntry[]>>(STORAGE_KEY, serverId)
    const outline: SessionOutline = { entries: [], index: new Map() }
    const fromDisk = stored?.[sessionId]
    if (Array.isArray(fromDisk)) {
      for (const entry of fromDisk) {
        if (!entry || typeof entry.messageId !== 'string') continue
        outline.index.set(entry.messageId, outline.entries.length)
        outline.entries.push(entry)
      }
    }
    this.sessions.set(key, outline)
    this.pruneIfNeeded()
    return outline
  }

  /** 读取某会话的完整大纲（按创建时间升序）。无数据返回空数组。 */
  getEntries(serverId: string, sessionId: string): TurnOutlineEntry[] {
    const outline = this.sessions.get(this.key(serverId, sessionId))
    if (!outline || outline.entries.length === 0) return EMPTY_ENTRIES
    return outline.entries
  }

  /**
   * 稳定快照：内容未变时返回同一引用，供 useSyncExternalStore 使用。
   * 注意会触发一次磁盘懒加载（首次读取该会话时）。
   */
  getSnapshot(serverId: string, sessionId: string): TurnOutlineEntry[] {
    const key = this.key(serverId, sessionId)
    const cached = this.snapshotCache.get(key)
    if (cached && cached.version === this.version) return cached.value

    const outline = this.getOrLoad(serverId, sessionId)
    const value = outline.entries.length === 0 ? EMPTY_ENTRIES : outline.entries
    this.snapshotCache.set(key, { version: this.version, value })
    return value
  }

  /**
   * 合并一批轮次条目（分页拉取 / SSE 到达时调用）。
   * 去重按 messageId；已有条目标题更新时就地替换。返回是否有实际变化。
   */
  merge(serverId: string, sessionId: string, incoming: TurnOutlineEntry[]): boolean {
    if (incoming.length === 0) return false
    const outline = this.getOrLoad(serverId, sessionId)
    let changed = false

    for (const entry of incoming) {
      if (!entry.messageId) continue
      const existingIndex = outline.index.get(entry.messageId)
      if (existingIndex === undefined) {
        outline.index.set(entry.messageId, outline.entries.length)
        outline.entries.push(entry)
        changed = true
        continue
      }
      const existing = outline.entries[existingIndex]
      if (existing.title !== entry.title || existing.createdAt !== entry.createdAt) {
        outline.entries[existingIndex] = entry
        changed = true
      }
    }

    if (!changed) return false

    outline.entries.sort((a, b) => a.createdAt - b.createdAt)
    outline.index.clear()
    for (let i = 0; i < outline.entries.length; i++) {
      outline.index.set(outline.entries[i].messageId, i)
    }
    if (outline.entries.length > MAX_ENTRIES_PER_SESSION) {
      outline.entries = outline.entries.slice(-MAX_ENTRIES_PER_SESSION)
      outline.index.clear()
      for (let i = 0; i < outline.entries.length; i++) {
        outline.index.set(outline.entries[i].messageId, i)
      }
    }

    this.persist(serverId)
    this.emit()
    return true
  }

  /** 删除单条轮次（会话回退/消息删除） */
  remove(serverId: string, sessionId: string, messageId: string): boolean {
    const outline = this.sessions.get(this.key(serverId, sessionId))
    if (!outline) return false
    const index = outline.index.get(messageId)
    if (index === undefined) return false
    outline.entries.splice(index, 1)
    outline.index.delete(messageId)
    outline.index.clear()
    for (let i = 0; i < outline.entries.length; i++) {
      outline.index.set(outline.entries[i].messageId, i)
    }
    this.persist(serverId)
    this.emit()
    return true
  }

  /** 会话被删除时清理其大纲 */
  clearSession(serverId: string, sessionId: string): void {
    const key = this.key(serverId, sessionId)
    if (!this.sessions.delete(key)) return
    this.snapshotCache.delete(key)
    this.persist(serverId)
    this.emit()
  }

  /** 服务器被移除时清理其全部会话大纲 */
  dropServer(serverId: string): void {
    let changed = false
    for (const key of [...this.sessions.keys()]) {
      if (key.startsWith(`${serverId}::`)) {
        this.sessions.delete(key)
        this.snapshotCache.delete(key)
        changed = true
      }
    }
    try {
      serverStorage.setJSONFor(STORAGE_KEY, {}, serverId)
    } catch {
      // ignore
    }
    if (changed) this.emit()
  }

  /** 单测用：清空内存态 */
  reset(): void {
    this.sessions.clear()
    this.snapshotCache.clear()
    this.emit()
  }

  /** 把某服务器的所有会话大纲写回 localStorage（按 serverId 隔离） */
  private persist(serverId: string): void {
    const payload: Record<string, TurnOutlineEntry[]> = {}
    const prefix = `${serverId}::`
    for (const [key, outline] of this.sessions) {
      if (!key.startsWith(prefix)) continue
      if (outline.entries.length === 0) continue
      payload[key.slice(prefix.length)] = outline.entries
    }
    try {
      serverStorage.setJSONFor(STORAGE_KEY, payload, serverId)
    } catch {
      // 配额超限等写入失败不影响内存态
    }
  }

  private pruneIfNeeded(): void {
    if (this.sessions.size <= MAX_SESSIONS) return
    // Map 插入序即最近创建序；淘汰最早进入的会话大纲
    const excess = this.sessions.size - MAX_SESSIONS
    let removed = 0
    for (const key of this.sessions.keys()) {
      this.sessions.delete(key)
      this.snapshotCache.delete(key)
      if (++removed >= excess) break
    }
  }
}

const EMPTY_ENTRIES: TurnOutlineEntry[] = []

export const turnOutlineStore = new TurnOutlineStore()

export type { TurnOutlineStore }
