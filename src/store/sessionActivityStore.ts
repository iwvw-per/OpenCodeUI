// ============================================
// sessionActivityStore - 会话/目录「最后活动时间」锚点
// ============================================
//
// 侧栏会话列表固定「最新对话置顶」，依据不是会话的 time.updated。
// assistant 流式输出会持续刷新 time.updated，多个会话并行运行时各自的时间戳
// 交替变化，按它排序会让列表来回跳。
//
// 这里维护一层单调锚点：
//   - 会话锚点：用户最后一条消息的发送时间（打开会话、SSE、乐观发送时写入）。
//   - 目录锚点：该目录下会话锚点的最大值，供项目排序与项目行「最后对话时间」。
//
// 写入单调只增：迟到的旧时间戳事件不会把顺序降回去，因此天然抗并发抖动。
// 冷启动（内存无锚点）时由列表加载侧用会话的 time.updated 播种一次基线，
// 之后不再随流式变化，只在用户发送或显式刷新时抬高。
//
// 会话锚点用「原始 sessionId」作 key：同一后端可能被多个 serverId 前缀连接
// （local 与隧道指向同一实例），原始 id 才唯一。

import { normalizeToForwardSlash } from '../utils/directoryUtils'
import type { ApiSession } from '../api'

const SEPARATOR = '\x00'

export interface ActivityChange {
  sessionId?: string
  /** 本次变化影响的目录（已归一化），无则 undefined */
  directory?: string
  serverId?: string
}

function directoryKey(serverId: string, directory: string): string {
  return `${serverId}${SEPARATOR}${normalizeToForwardSlash(directory)}`
}

class SessionActivityStore {
  private sessionAnchors = new Map<string, number>()
  private directoryAnchors = new Map<string, number>()
  private subscribers = new Set<(change: ActivityChange) => void>()
  /** 内容版本：每次实际变化递增，供 useSyncExternalStore 判断快照是否变化 */
  private version = 0

  subscribe = (fn: (change: ActivityChange) => void): (() => void) => {
    this.subscribers.add(fn)
    return () => {
      this.subscribers.delete(fn)
    }
  }

  getVersion = (): number => this.version

  private emit(change: ActivityChange) {
    this.version += 1
    for (const fn of this.subscribers) fn(change)
  }

  /**
   * 记一次会话活动时间（单调）。只有比已记录值更新才写入并通知，
   * 因此迟到/重复事件不会造成无谓重排，也不会把顺序降回去。
   */
  recordActivity(sessionId: string, timestamp: number | undefined, directory?: string, serverId?: string): void {
    if (!timestamp || !sessionId) return

    let changed = false
    if (timestamp > (this.sessionAnchors.get(sessionId) ?? 0)) {
      this.sessionAnchors.set(sessionId, timestamp)
      changed = true
    }

    const normalized = directory ? normalizeToForwardSlash(directory) : ''
    if (normalized && serverId) {
      const dirKey = directoryKey(serverId, normalized)
      if (timestamp > (this.directoryAnchors.get(dirKey) ?? 0)) {
        this.directoryAnchors.set(dirKey, timestamp)
        changed = true
      }
    }

    if (changed) this.emit({ sessionId, directory: normalized || undefined, serverId })
  }

  /** 取会话锚点；未记录过返回 undefined，由调用方回退到 session.time */
  getSessionAnchor(sessionId: string): number | undefined {
    return this.sessionAnchors.get(sessionId)
  }

  /** 取目录锚点（最后对话时间）；未记录过返回 undefined */
  getDirectoryAnchor(serverId: string, directory: string): number | undefined {
    if (!directory) return undefined
    return this.directoryAnchors.get(directoryKey(serverId, directory))
  }

  removeSession(sessionId: string): void {
    if (this.sessionAnchors.delete(sessionId)) this.emit({ sessionId })
  }

  /** 单测用：清空全部 */
  reset(): void {
    this.sessionAnchors.clear()
    this.directoryAnchors.clear()
  }
}

export const sessionActivityStore = new SessionActivityStore()

/**
 * 会话锚定时间：优先用锚点，未记录时回退到会话自身的 updated（再退 created）。
 * 时间缺失按 0 处理，避免 NaN 打乱顺序。
 */
export function getSessionAnchorTime(session: ApiSession): number {
  const anchor = sessionActivityStore.getSessionAnchor(session.id)
  if (anchor !== undefined) return anchor
  const time = session.time
  return time?.updated ?? time?.created ?? 0
}

/**
 * 按锚定时间倒序（最新对话置顶，返回新数组，不改原数组）。
 * 时间相同时按 id 升序兜底，保证结果稳定、与输入顺序无关。
 */
export function sortSessionsByAnchor<T extends ApiSession>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => {
    const delta = getSessionAnchorTime(b) - getSessionAnchorTime(a)
    if (delta !== 0) return delta
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/**
 * 把一个新出现的会话插到锚点倒序列表的正确位置（返回新数组）。
 * 保持「最新对话置顶」的语义，而不是无脑置于末尾。
 */
export function insertSessionByAnchor<T extends ApiSession>(sessions: T[], session: T): T[] {
  if (sessions.length === 0) return [session]
  const target = getSessionAnchorTime(session)
  let index = sessions.length
  for (let i = 0; i < sessions.length; i += 1) {
    if (getSessionAnchorTime(sessions[i]) < target) {
      index = i
      break
    }
  }
  const next = sessions.slice()
  next.splice(index, 0, session)
  return next
}
