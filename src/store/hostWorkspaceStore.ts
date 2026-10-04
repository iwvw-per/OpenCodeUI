// ============================================
// HostWorkspaceStore — 每主机的激活工作区快照
// ============================================
//
// 多主机下「主机」是顶层上下文：每台主机各自记住自己当前打开的会话与目录，
// 切换主机时整体切换、切回来恢复。没有这个快照时，切服只能沿用 URL 里的
// 旧会话/目录，导致「旧主机的会话与项目泄漏到新主机」。
//
// 与 messageStore / sessionListIndexStore 的「按 serverId 分桶」是同一原则：
// 主机的 UI 上下文也应分桶，而不是全局单份。

export interface HostWorkspace {
  /** 该主机当前激活的会话（复合 key: serverId::sessionId），无则为 null */
  sessionKey: string | null
  /** 该主机当前目录 */
  directory: string | undefined
  /** 最近更新时刻，用于调试与淘汰 */
  updatedAt: number
}

const STORAGE_KEY = 'opencode-host-workspaces'

interface PersistedShape {
  version: 1
  byServer: Record<string, { sessionKey: string | null; directory?: string; updatedAt: number }>
}

function sanitize(raw: unknown): PersistedShape {
  const empty: PersistedShape = { version: 1, byServer: {} }
  if (!raw || typeof raw !== 'object') return empty
  const data = raw as Partial<PersistedShape>
  if (data.version !== 1 || !data.byServer || typeof data.byServer !== 'object') return empty
  const byServer: PersistedShape['byServer'] = {}
  for (const [serverId, value] of Object.entries(data.byServer)) {
    if (!serverId || !value || typeof value !== 'object') continue
    const v = value as { sessionKey?: unknown; directory?: unknown; updatedAt?: unknown }
    byServer[serverId] = {
      sessionKey: typeof v.sessionKey === 'string' ? v.sessionKey : null,
      directory: typeof v.directory === 'string' ? v.directory : undefined,
      updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0,
    }
  }
  return { version: 1, byServer }
}

const EMPTY_WORKSPACE: HostWorkspace = { sessionKey: null, directory: undefined, updatedAt: 0 }

function loadPersisted(): PersistedShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return sanitize(JSON.parse(raw))
  } catch {
    // ignore
  }
  return { version: 1, byServer: {} }
}

class HostWorkspaceStore {
  private byServer: PersistedShape['byServer']
  private listeners = new Set<() => void>()
  /** 供 useSyncExternalStore 的稳定快照：serverId -> HostWorkspace（引用稳定） */
  private snapshotCache = new Map<string, HostWorkspace>()

  constructor() {
    this.byServer = loadPersisted().byServer
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify() {
    this.listeners.forEach(fn => fn())
  }

  /** 读取某主机的快照；无记录时返回稳定空对象（引用不变） */
  get(serverId: string): HostWorkspace {
    const cached = this.snapshotCache.get(serverId)
    if (cached) return cached
    const entry = this.byServer[serverId]
    const value: HostWorkspace = entry
      ? { sessionKey: entry.sessionKey, directory: entry.directory, updatedAt: entry.updatedAt }
      : EMPTY_WORKSPACE
    this.snapshotCache.set(serverId, value)
    return value
  }

  /** 写入某主机的激活工作区（会话 + 目录） */
  set(serverId: string, workspace: { sessionKey: string | null; directory: string | undefined }): void {
    if (!serverId) return
    const current = this.byServer[serverId]
    if (
      current &&
      current.sessionKey === workspace.sessionKey &&
      current.directory === workspace.directory
    ) {
      return
    }
    this.byServer[serverId] = {
      sessionKey: workspace.sessionKey,
      directory: workspace.directory,
      updatedAt: Date.now(),
    }
    this.snapshotCache.delete(serverId)
    this.persist()
    this.notify()
  }

  /** 主机被移除时清理其快照 */
  drop(serverId: string): void {
    if (!(serverId in this.byServer)) return
    delete this.byServer[serverId]
    this.snapshotCache.delete(serverId)
    this.persist()
    this.notify()
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, byServer: this.byServer } satisfies PersistedShape))
    } catch {
      // ignore
    }
  }

  /** 清空全部状态与订阅者（不改动 localStorage）。供测试隔离使用。 */
  reset(): void {
    this.byServer = {}
    this.snapshotCache.clear()
    this.listeners.clear()
  }
}

export const hostWorkspaceStore = new HostWorkspaceStore()
