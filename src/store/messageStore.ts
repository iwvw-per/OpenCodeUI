// ============================================
// MessageStore - 消息状态集中管理
// ============================================
//
// 核心设计：
// 1. 每个 session 的消息独立存储在内存中
// 2. SSE 事件直接修改对应 session 的消息（找不到则丢弃）
// 3. Undo/Redo 通过 revertState 实现
// 4. RAF 批量通知 React 组件更新

import i18n from '../i18n'
import type { Message, MessageError, Part, FilePart, AgentPart } from '../types/message'
import type { ApiMessageWithParts, ApiMessage, ApiPart, ApiSession, Attachment } from '../api/types'
import { logger } from '../utils/logger'
import { isUserUIMessage, toUIMessage, toUIMessageInfo, toUIPart } from '../utils/messageConversion'
import { compressMessageParts } from './turnCompression'
import { sessionActivityStore } from './sessionActivityStore'
import type { RevertState, RevertHistoryItem, SessionState, SendRollbackSnapshot } from './messageStoreTypes'

// Re-export types for consumers
export type { RevertState, RevertHistoryItem, SessionState, SendRollbackSnapshot } from './messageStoreTypes'

type Subscriber = () => void

/**
 * 每个服务器的消息缓存配额。与 ChatArea 的 SESSION_CACHE_LIMIT(16) 对齐，
 * 避免「消息已被丢弃、但虚拟化测量缓存还在」的错配。
 *
 * 按 serverId 分片计数：多服务器模式下，一台服务器的活跃会话不应把另一台的
 * 缓存挤掉（否则在服务器间来回切换会不断重拉）。
 */
const MAX_CACHED_SESSIONS_PER_SERVER = 16
/** 全局硬上限，防止服务器数量很多时内存无界增长（超出时优先淘汰非活动服务器） */
const MAX_CACHED_SESSIONS_TOTAL = 48

/**
 * 单个会话在内存中保留的消息预算。
 *
 * 消息列表已虚拟化，DOM 节点数受控，但 JS 堆里的消息对象不会自动释放：
 * 长会话会把整段历史常驻。这里给出硬上限，超出时从最旧端裁剪。
 *
 * 上限用**体积**而非条数，原因：轻量投影后单条消息从 ~25KB 降到 ~0.8KB（30 倍），
 * 条数上限会让「投影后本来很小的会话」被误裁 —— 实测 749 条的投影会话只有
 * ~618KB，却因为超过 500 条被裁掉最前面 249 条，导致首屏看不到最早几轮。
 * 按体积记账后，投影会话可以完整保留，而未投影的重会话仍受同等内存约束。
 *
 * 防退化：按条数兜底，避免「大量极小消息」把数组本身撑爆（每条仍是对象，
 * 有固定开销）。两个限制取先命中者。
 */
const MAX_SESSION_MESSAGE_BYTES = 12 * 1024 * 1024
const MAX_SESSION_MESSAGE_COUNT = 20_000
/** 单条消息计费上限：一条超大消息不应独占整个预算而把其余全部裁掉 */
const MAX_SINGLE_MESSAGE_BYTES = 2 * 1024 * 1024

/**
 * 估算单条消息的内存占用（按序列化长度近似，不精确但足够做预算）。
 *
 * 用 JSON.stringify 的长度而非真实堆占用：堆占用无法廉价测量，且这里只需要
 * 一个与体积强相关的可比量。超长消息按 MAX_SINGLE_MESSAGE_BYTES 截断计费。
 */
function estimateMessageBytes(message: Message): number {
  try {
    const size = JSON.stringify(message).length
    return Math.min(size, MAX_SINGLE_MESSAGE_BYTES)
  } catch {
    // 存在循环引用等无法序列化的情况：给一个保守的固定估算，避免整段被误裁。
    return 4096
  }
}

/** 从复合 key 提取 serverId（`${serverId}::${sessionId}`）；无分隔符时归为活动服务器 */
function serverIdOfSessionKey(sessionId: string): string {
  const idx = sessionId.indexOf('::')
  return idx === -1 ? '' : sessionId.slice(0, idx)
}

/**
 * 从复合 key 提取原始 sessionId（去掉 serverId 前缀）。
 *
 * 同一后端可能同时以多个 serverId 前缀被连接（如本机 `local` 与隧道
 * `aiagent:inst_xxx` 指向同一 opencode 实例），同一条会话因此会以不同前缀
 * 推事件。原始 sessionId 全局唯一，用它作为「同一会话」的判定依据。
 */
function rawSessionIdOfKey(sessionId: string): string {
  const idx = sessionId.indexOf('::')
  return idx === -1 ? sessionId : sessionId.slice(idx + 2)
}

/**
 * 同步合并文本：live 更长且与服务端兼容（服务端是前缀）时不回退；
 * 服务端更长则跟上；分叉时以服务端为准。
 */
function preferCompatibleText(local: string, incoming: string): string {
  if (local === incoming) return incoming
  if (local.startsWith(incoming)) return local
  if (incoming.startsWith(local)) return incoming
  return incoming
}

function partHasText(part: Part): part is Part & { text: string } {
  return 'text' in part && typeof (part as { text?: unknown }).text === 'string'
}

function mergePartPreferLiveText(local: Part | undefined, incoming: Part): Part {
  if (!local || local.id !== incoming.id) return incoming
  if (!partHasText(local) || !partHasText(incoming)) return incoming
  const text = preferCompatibleText(local.text, incoming.text)
  if (text === incoming.text) return incoming
  return { ...incoming, text } as Part
}

function mergePartsPreferLiveText(localParts: Part[], incomingParts: Part[]): Part[] {
  if (localParts.length === 0) return incomingParts
  const localById = new Map(localParts.map(part => [part.id, part]))
  return incomingParts.map(part => mergePartPreferLiveText(localById.get(part.id), part))
}

function messageIsIncomplete(message: { isStreaming?: boolean; info: { time?: { completed?: number } } }) {
  if (message.isStreaming) return true
  const completed = message.info.time && 'completed' in message.info.time ? message.info.time.completed : undefined
  return completed == null
}

/**
 * 仅未定稿时保护更长 live；incoming/本地已 completed 则强制服务端，不再 preserve。
 */
function shouldPreserveLiveParts(
  previous: { isStreaming?: boolean; info: { time?: { completed?: number } } },
  incoming?: { isStreaming?: boolean; info: { time?: { completed?: number } } },
) {
  if (incoming && !messageIsIncomplete(incoming)) return false
  return messageIsIncomplete(previous)
}

class MessageStore {
  private sessions = new Map<string, SessionState>()
  /**
   * 原始 sessionId → 权威复合 key 的映射。
   *
   * 同一后端可能被以多个 serverId 前缀连接（本机 `local` 与隧道
   * `aiagent:inst_xxx` 指向同一 opencode 实例），同一条会话会以不同前缀推事件。
   * 这里把「首次出现的 key」定为权威 bucket，后续任何前缀的事件都归并进去，
   * 从而避免「UI 订阅的 bucket 收不到事件、事件写进了另一个 bucket」。
   */
  private rawSessionToKey = new Map<string, string>()
  private subscribers = new Set<Subscriber>()
  private sessionSubscribers = new Map<string, Map<Subscriber, number>>()
  private sessionVersions = new Map<string, number>()
  private allSessionsVersion = 0
  private changeVersion = 0
  private sessionAccessTime = new Map<string, number>()
  /** 被分屏 pane 保护的 sessionId 集合，evict 时跳过 */
  private protectedSessions = new Set<string>()
  private pendingNotify = false
  private pendingNotifyAllSessions = false
  private pendingSessionNotifyIds = new Set<string>()
  private rafId: number | null = null
  // delta 批量化：只追踪真正变化的 part，避免同消息内稳定 part 的 memo 引用失效
  private dirtyPartsBySession = new Map<string, Map<string, Set<string>>>()
  /**
   * id→索引缓存，消除高频事件路径上的线性 find。
   *
   * 缓存绑定在 state.messages / message.parts 的**数组引用**上：只有引用变了才
   * 重建（每帧 flush 最多一次），同一帧内的多个 delta 共用同一份索引，把每个
   * token 的 O(m)+O(p) 扫描降为 O(1)。
   */
  private messageIndexCache = new Map<string, { messages: Message[]; byId: Map<string, number> }>()
  private partIndexCache = new Map<string, Map<string, { parts: Part[]; byId: Map<string, number> }>>()

  // ============================================
  // Subscription & Notification
  // ============================================

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  subscribeSession(sessionId: string, fn: Subscriber): () => void {
    // UI 订阅的 key 优先成为权威 bucket：若该会话尚无 bucket，由第一个订阅者
    // 认领，之后任意前缀推来的事件都归并到此，避免「订阅的 key 收不到事件」。
    sessionId = this.resolveKey(sessionId, true)
    let subscribers = this.sessionSubscribers.get(sessionId)
    if (!subscribers) {
      subscribers = new Map()
      this.sessionSubscribers.set(sessionId, subscribers)
    }
    subscribers.set(fn, this.getSessionVersion(sessionId))
    return () => {
      subscribers.delete(fn)
      if (subscribers.size === 0) this.sessionSubscribers.delete(sessionId)
    }
  }

  private getSessionVersion(sessionId: string) {
    sessionId = this.resolveKey(sessionId)
    return Math.max(this.sessionVersions.get(sessionId) ?? 0, this.allSessionsVersion)
  }

  /** 公开的版本读取：供 React 快照缓存判断某 session 是否已变化 */
  getSessionChangeVersion(sessionId: string): number {
    return this.getSessionVersion(sessionId)
  }

  private markPendingSessionNotifications(sessionIds?: Iterable<string> | 'all') {
    if (sessionIds === 'all') {
      this.changeVersion += 1
      this.allSessionsVersion = this.changeVersion
      this.pendingNotifyAllSessions = true
      this.pendingSessionNotifyIds.clear()
      return
    }
    if (!sessionIds || this.pendingNotifyAllSessions) return
    for (const sessionId of sessionIds) {
      this.changeVersion += 1
      this.sessionVersions.set(sessionId, this.changeVersion)
      this.pendingSessionNotifyIds.add(sessionId)
    }
  }

  private notify(sessionIds?: Iterable<string> | 'all') {
    this.markPendingSessionNotifications(sessionIds)
    if (this.pendingNotify) return
    this.pendingNotify = true

    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame(() => {
        this.pendingNotify = false
        this.rafId = null
        this.flushDirtyMessages()
        this.subscribers.forEach(fn => fn())
        this.flushSessionSubscribers()
      })
    } else {
      this.pendingNotify = false
      this.flushDirtyMessages()
      this.subscribers.forEach(fn => fn())
      this.flushSessionSubscribers()
    }
  }

  private flushSessionSubscribers() {
    if (this.pendingNotifyAllSessions) {
      this.pendingNotifyAllSessions = false
      this.pendingSessionNotifyIds.clear()
      this.sessionSubscribers.forEach((subscribers, sessionId) => {
        this.flushSubscribersForSession(sessionId, subscribers)
      })
      return
    }

    if (this.pendingSessionNotifyIds.size === 0) return
    const sessionIds = Array.from(this.pendingSessionNotifyIds)
    this.pendingSessionNotifyIds.clear()
    for (const sessionId of sessionIds) {
      const subscribers = this.sessionSubscribers.get(sessionId)
      if (subscribers) this.flushSubscribersForSession(sessionId, subscribers)
    }
  }

  private flushSubscribersForSession(sessionId: string, subscribers: Map<Subscriber, number>) {
    const version = this.getSessionVersion(sessionId)
    subscribers.forEach((seenVersion, fn) => {
      if (seenVersion === version) return
      subscribers.set(fn, version)
      fn()
    })
  }

  /**
   * 将 delta 期间 mutable 修改过的消息做一次不可变快照。
   * 这样一帧内多个 delta 只产生一次数组拷贝，未变化的 part 继续复用引用。
   *
   * 只遍历脏消息（按 id 索引定位），不再对整表 map；只在确有变化时才复制
   * messages 数组，未脏消息与其 parts 引用原样保留。
   */
  private flushDirtyMessages() {
    if (this.dirtyPartsBySession.size === 0) return

    for (const [sessionId, dirtyPartsByMessage] of this.dirtyPartsBySession) {
      const state = this.sessions.get(sessionId)
      if (!state) continue

      const byId = this.getMessageIndex(sessionId, state)
      let newMessages: Message[] | null = null

      for (const [messageId, dirtyPartIds] of dirtyPartsByMessage) {
        const msgIndex = byId.get(messageId)
        if (msgIndex === undefined) continue

        const message = (newMessages ?? state.messages)[msgIndex]
        if (!message) continue

        const partIndex = this.getPartIndex(sessionId, messageId, message.parts)
        let partsChanged = false
        const newParts = message.parts.slice()
        for (const partId of dirtyPartIds) {
          const partIndexInMessage = partIndex.get(partId)
          if (partIndexInMessage === undefined) continue
          newParts[partIndexInMessage] = { ...message.parts[partIndexInMessage] }
          partsChanged = true
        }
        if (!partsChanged) continue

        if (!newMessages) newMessages = state.messages.slice()
        newMessages[msgIndex] = { ...message, parts: newParts }
      }

      if (newMessages) {
        state.messages = newMessages
      }
    }

    this.dirtyPartsBySession.clear()
  }

  private notifyImmediate(sessionIds?: Iterable<string> | 'all') {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.markPendingSessionNotifications(sessionIds)
    this.pendingNotify = false
    this.flushDirtyMessages()
    this.subscribers.forEach(fn => fn())
    this.flushSessionSubscribers()
  }

  // ============================================
  // Getters
  // ============================================

  getSessionState(sessionId: string): SessionState | undefined {
    return this.sessions.get(this.resolveKey(sessionId))
  }

  getVisibleMessages(sessionId: string | null): Message[] {
    if (!sessionId) return []
    sessionId = this.resolveKey(sessionId)
    const state = this.sessions.get(sessionId)
    if (!state) return []

    const { messages, revertState } = state
    if (!revertState) return messages

    const revertIndex = messages.findIndex(m => m.info.id === revertState.messageId)
    return revertIndex === -1 ? messages : messages.slice(0, revertIndex)
  }

  getIsStreaming(sessionId: string | null): boolean {
    if (!sessionId) return false
    return this.sessions.get(this.resolveKey(sessionId))?.isStreaming ?? false
  }

  getRevertState(sessionId: string | null): RevertState | null {
    if (!sessionId) return null
    return this.sessions.get(this.resolveKey(sessionId))?.revertState ?? null
  }

  getHasMoreHistory(sessionId: string | null): boolean {
    if (!sessionId) return false
    return this.sessions.get(this.resolveKey(sessionId))?.hasMoreHistory ?? false
  }

  getHistoryCursor(sessionId: string | null): string | undefined {
    if (!sessionId) return undefined
    return this.sessions.get(this.resolveKey(sessionId))?.historyCursor
  }

  /**
   * 内存缺口：被裁剪掉、尚未补回的条数。
   *
   * 用于 loadMoreHistory 判断「是否有本地缺口需要补」，与 hasMoreHistory
   * （服务端是否还有更早）区分开，避免用缺口去驱动空拉循环。
   */
  getTrimmedCount(sessionId: string | null): number {
    if (!sessionId) return 0
    return this.sessions.get(this.resolveKey(sessionId))?.trimmedCount ?? 0
  }

  getSessionDirectory(sessionId: string | null): string {
    if (!sessionId) return ''
    return this.sessions.get(this.resolveKey(sessionId))?.directory ?? ''
  }

  getSessionTitle(sessionId: string | null): string {
    if (!sessionId) return ''
    return this.sessions.get(this.resolveKey(sessionId))?.title ?? ''
  }

  getShareUrl(sessionId: string | null): string | undefined {
    if (!sessionId) return undefined
    return this.sessions.get(this.resolveKey(sessionId))?.shareUrl
  }

  getLoadState(sessionId: string | null): SessionState['loadState'] {
    if (!sessionId) return 'idle'
    return this.sessions.get(this.resolveKey(sessionId))?.loadState ?? 'idle'
  }

  isSessionStale(sessionId: string): boolean {
    return this.sessions.get(this.resolveKey(sessionId))?.isStale ?? false
  }

  // ============================================
  // Session Management
  // ============================================

  /**
   * 返回 session 的 message id→index 映射，绑定当前 messages 数组引用。
   * 引用未变时直接复用；变了才重建（每帧最多一次）。
   */
  private getMessageIndex(sessionId: string, state: SessionState): Map<string, number> {
    const cached = this.messageIndexCache.get(sessionId)
    if (cached && cached.messages === state.messages) return cached.byId
    const byId = new Map<string, number>()
    for (let i = 0; i < state.messages.length; i++) {
      byId.set(state.messages[i].info.id, i)
    }
    this.messageIndexCache.set(sessionId, { messages: state.messages, byId })
    // messages 变更时顺带清理已不在会话内的 part 索引，避免长会话滚动时无界增长
    const perMessage = this.partIndexCache.get(sessionId)
    if (perMessage && perMessage.size > byId.size * 2) {
      for (const messageId of perMessage.keys()) {
        if (!byId.has(messageId)) perMessage.delete(messageId)
      }
    }
    return byId
  }

  /** 返回某条消息内 part id→index 映射，绑定当前 parts 数组引用。 */
  private getPartIndex(sessionId: string, messageId: string, parts: Part[]): Map<string, number> {
    let perMessage = this.partIndexCache.get(sessionId)
    if (!perMessage) {
      perMessage = new Map()
      this.partIndexCache.set(sessionId, perMessage)
    }
    const cached = perMessage.get(messageId)
    if (cached && cached.parts === parts) return cached.byId
    const byId = new Map<string, number>()
    for (let i = 0; i < parts.length; i++) {
      byId.set(parts[i].id, i)
    }
    perMessage.set(messageId, { parts, byId })
    return byId
  }

  /**
   * 把任意前缀的复合 key 归并到该会话的权威 bucket。
   *
   * 权威 bucket = 该 raw sessionId 首次出现的 key（通常是用户打开会话时 UI 用的那个）。
   * 之后其它前缀（同一后端的另一条连接）推来的事件都写入同一份 state，
   * UI 读任意前缀都能看到。返回 undefined 表示该 raw sessionId 尚无 bucket
   * 且调用方要求不新建（get 语义）。
   */
  private resolveKey(sessionId: string, create = false): string {
    const raw = rawSessionIdOfKey(sessionId)
    const existing = this.rawSessionToKey.get(raw)
    if (existing) return existing
    if (!create) return sessionId
    this.rawSessionToKey.set(raw, sessionId)
    return sessionId
  }

  private ensureSession(sessionId: string): SessionState {
    sessionId = this.resolveKey(sessionId, true)
    this.sessionAccessTime.set(sessionId, Date.now())

    let state = this.sessions.get(sessionId)
    if (!state) {
      this.evictOldSessions(serverIdOfSessionKey(sessionId))
      state = {
        messages: [],
        revertState: null,
        isStreaming: false,
        loadState: 'idle',
        hasMoreHistory: false,
        historyCursor: undefined,
        trimmedCount: 0,
        directory: '',
        title: undefined,
        loadError: undefined,
        shareUrl: undefined,
        isStale: false,
      }
      this.sessions.set(sessionId, state)
    }
    return state
  }

  /**
   * 记一条用户消息的活动锚点（侧栏排序用）。非 user 消息或时间缺失时跳过。
   * 目录取会话当前已知的 directory，serverId 从复合 key 解析。
   */
  private recordUserMessageAnchor(
    sessionId: string,
    info: { role?: string; time?: { created?: number } },
    directory?: string,
  ): void {
    if (info.role !== 'user') return
    const created = info.time?.created
    if (!created) return
    const state = this.sessions.get(sessionId)
    sessionActivityStore.recordActivity(
      rawSessionIdOfKey(sessionId),
      created,
      directory ?? state?.directory,
      serverIdOfSessionKey(sessionId),
    )
  }

  /** 整段消息里取最大的用户消息时间，作为该会话的锚点（冷启动播种/刷新）。 */
  private recordUserAnchorFromMessages(sessionId: string, directory?: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    let max = 0
    for (const message of state.messages) {
      if (message.info.role !== 'user') continue
      const created = message.info.time?.created ?? 0
      if (created > max) max = created
    }
    if (!max) return
    sessionActivityStore.recordActivity(
      rawSessionIdOfKey(sessionId),
      max,
      directory ?? state.directory,
      serverIdOfSessionKey(sessionId),
    )
  }

  private evictOldSessions(protectServerId?: string) {
    const countFor = (serverId: string) => {
      let count = 0
      for (const id of this.sessions.keys()) {
        if (serverIdOfSessionKey(id) === serverId) count += 1
      }
      return count
    }

    const evictable = (id: string): boolean => {
      if (this.protectedSessions.has(id)) return false
      if (this.sessions.get(id)?.isStreaming) return false
      return true
    }

    /** 在给定 serverId 范围内淘汰最久未访问的会话；不传则跨所有服务器 */
    const evictOldest = (serverId?: string): boolean => {
      let oldestId: string | null = null
      let oldestTime = Infinity
      for (const [id, time] of this.sessionAccessTime) {
        if (serverId !== undefined && serverIdOfSessionKey(id) !== serverId) continue
        if (!evictable(id)) continue
        if (time < oldestTime) {
          oldestTime = time
          oldestId = id
        }
      }
      if (!oldestId) return false
      logger.log('[MessageStore] Evicting old session:', oldestId)
      this.sessions.delete(oldestId)
      this.sessionAccessTime.delete(oldestId)
      this.messageIndexCache.delete(oldestId)
      this.partIndexCache.delete(oldestId)
      this.rawSessionToKey.delete(rawSessionIdOfKey(oldestId))
      return true
    }

    // 1) 目标服务器超配额：只在该服务器内淘汰，不波及其它服务器
    if (protectServerId) {
      while (countFor(protectServerId) >= MAX_CACHED_SESSIONS_PER_SERVER) {
        if (!evictOldest(protectServerId)) break
      }
    }

    // 2) 全局硬上限：跨服务器淘汰最久未访问者
    while (this.sessions.size >= MAX_CACHED_SESSIONS_TOTAL) {
      if (!evictOldest()) break
    }
  }

  /** 保护 sessionId 不被 evict（分屏 pane 使用） */
  protectSession(sessionId: string) {
    this.protectedSessions.add(sessionId)
  }

  /** 取消保护（pane 关闭或切换 session 时调用） */
  unprotectSession(sessionId: string) {
    this.protectedSessions.delete(sessionId)
  }

  /**
   * 单会话消息条数上限：超出时从最旧端裁剪。
   *
   * 裁剪会丢掉内存里最旧的消息。为了让被裁历史仍可恢复，裁剪发生时记录
   * `trimmedCount`：上滑时据此走「按条数重拉一页」的路径把缺口补回来。
   *
   * 注意这里**不再**无条件置 `hasMoreHistory = true`。原因是「一次拉全」的
   * 轻量路径（getSessionLightweightMessages）本就会返回整段会话，裁剪只是丢
   * 内存副本、服务端并没有更早的内容。若此处强行置 true 且清空游标，
   * `loadMoreHistory` 的无游标分支会用「当前条数的一半」重拉**最新**一页 ——
   * 拉回的内容与内存完全重叠，去重后 unique 为 0，没有任何更早历史被补回；
   * 而 `prependMessages` 又会按该页的 hasMore 覆盖状态，于是「上滑 → 空拉 →
   * 仍报还有 → 再上滑」自我维持，表现为「加载历史记录」指示条反复出现。
   *
   * 因此改为：裁剪只标记缺口；是否「还有更早历史」仍由服务端语义决定
   * （调用方传入的 hasMoreHistory 或后续 prependMessages 的返回值）。
   * `loadMoreHistory` 通过 `trimmedCount` 识别缺口并优先补拉。
   *
   * revertState 指向的消息若被裁掉，会一并清空，避免撤销点悬空。
   */
  private capSessionMessages(state: SessionState) {
    const total = state.messages.length
    if (total <= MAX_SESSION_MESSAGE_COUNT) {
      // 条数没超，快速路径：累积体积判断是否需要按体积裁剪。
      let bytes = 0
      let cut = 0
      for (let i = total - 1; i >= 0; i--) {
        bytes += estimateMessageBytes(state.messages[i])
        if (bytes > MAX_SESSION_MESSAGE_BYTES) {
          cut = i + 1
          break
        }
      }
      if (cut === 0) return
      this.trimFromOldest(state, cut)
      return
    }
    // 条数超限：至少裁到 MAX_SESSION_MESSAGE_COUNT，再看体积。
    let bytes = 0
    let cut = total - MAX_SESSION_MESSAGE_COUNT
    for (let i = total - 1; i >= cut; i--) {
      bytes += estimateMessageBytes(state.messages[i])
      if (bytes > MAX_SESSION_MESSAGE_BYTES) {
        cut = i + 1
        break
      }
    }
    this.trimFromOldest(state, cut)
  }

  /**
   * 从最旧端裁掉 `cut` 条，并记录缺口。
   *
   * 只丢内存副本：被裁内容仍在服务端，`trimmedCount` 让上层能识别缺口并按需补拉。
   * 这里**不**置 `hasMoreHistory` —— 语义是「服务端是否还有更早」，与「本地有缺口」
   * 是两回事；混用会导致「上滑 → 空拉 → 仍报还有」的死循环。
   */
  private trimFromOldest(state: SessionState, cut: number) {
    if (cut <= 0) return
    const kept = state.messages.slice(cut)
    if (state.revertState) {
      const revert = state.revertState
      const revertIndex = kept.findIndex(m => m.info.id === revert.messageId)
      if (revertIndex === -1) state.revertState = null
    }
    state.messages = kept
    // 记录被裁掉的条数，供 loadMoreHistory 识别「内存缺口」并按缺口补拉。
    state.trimmedCount = (state.trimmedCount ?? 0) + cut
    // 裁剪后原游标指向被裁窗口之后，继续用它只会拉到与内存重叠的区间；
    // 清空让补拉走「按缺口重拉最新一页」的路径。
    state.historyCursor = undefined
  }

  updateSessionMetadata(
    sessionId: string,
    options: {
      hasMoreHistory?: boolean
      historyCursor?: string
      directory?: string
      title?: string
      loadState?: SessionState['loadState']
      shareUrl?: string
      loadError?: MessageError
    },
  ) {
    sessionId = this.resolveKey(sessionId)
    const state = this.sessions.get(sessionId)
    if (!state) return

    if (options.hasMoreHistory !== undefined) state.hasMoreHistory = options.hasMoreHistory
    // 用 in 判断：historyCursor 显式传 undefined 表示「已到最早一条」，必须清空旧游标
    if ('historyCursor' in options) state.historyCursor = options.historyCursor
    if (options.directory !== undefined) state.directory = options.directory
    if (options.title !== undefined) state.title = options.title
    if (options.loadState !== undefined) state.loadState = options.loadState
    if (options.loadError !== undefined) state.loadError = options.loadError
    if (options.shareUrl !== undefined) state.shareUrl = options.shareUrl

    this.notify([sessionId])
  }

  upsertLocalMessage(message: Message, directory?: string) {
    const sessionKey = this.resolveKey(message.info.sessionID, true)
    const state = this.ensureSession(sessionKey)
    const existingIndex = state.messages.findIndex(item => item.info.id === message.info.id)

    if (existingIndex >= 0) {
      state.messages = [...state.messages.slice(0, existingIndex), message, ...state.messages.slice(existingIndex + 1)]
    } else {
      state.messages = [...state.messages, message].sort((a, b) => {
        const aCreated = a.info.time?.created ?? 0
        const bCreated = b.info.time?.created ?? 0
        return aCreated - bCreated
      })
      this.capSessionMessages(state)
    }

    // 乐观发送的本地占位也是用户消息：立即抬高锚点，新会话即时置顶。
    // 新建会话的 state.directory 可能尚未回填，故显式传入目录。
    this.recordUserMessageAnchor(sessionKey, message.info, directory)
    this.notify([sessionKey])
  }

  removeMessage(sessionId: string, messageId: string) {
    sessionId = this.resolveKey(sessionId)
    const state = this.sessions.get(sessionId)
    if (!state) return
    const nextMessages = state.messages.filter(message => message.info.id !== messageId)
    if (nextMessages.length === state.messages.length) return
    state.messages = nextMessages
    this.notify([sessionId])
  }

  markAllSessionsStale() {
    let updated = false
    for (const state of this.sessions.values()) {
      if (state.loadState !== 'loaded' || state.isStale) continue
      state.isStale = true
      updated = true
    }
    if (updated) this.notify('all')
  }

  /**
   * 只失效指定服务器的会话。重连是按 serverId 独立的，不该波及其它服务器的缓存。
   * sessionId key 形如 `${serverId}::${sessionId}`。
   */
  markServerSessionsStale(serverId: string) {
    const prefix = `${serverId}::`
    let updated = false
    for (const [sessionId, state] of this.sessions) {
      if (!sessionId.startsWith(prefix)) continue
      if (state.loadState !== 'loaded' || state.isStale) continue
      state.isStale = true
      updated = true
    }
    if (updated) this.notify('all')
  }

  setLoadState(sessionId: string, loadState: SessionState['loadState']) {
    sessionId = this.resolveKey(sessionId, true)
    const state = this.ensureSession(sessionId)
    state.loadState = loadState
    if (loadState !== 'error') state.loadError = undefined
    this.notify([sessionId])
  }

  setLoadError(sessionId: string, error: MessageError) {
    sessionId = this.resolveKey(sessionId, true)
    const state = this.ensureSession(sessionId)
    state.loadState = 'error'
    state.loadError = error
    this.notify([sessionId])
  }

  // ============================================
  // Message CRUD
  // ============================================

  setMessages(
    sessionId: string,
    apiMessages: ApiMessageWithParts[],
    options?: {
      directory?: string
      title?: string
      hasMoreHistory?: boolean
      historyCursor?: string
      revertState?: ApiSession['revert'] | null
      shareUrl?: string
    },
  ) {
    sessionId = this.resolveKey(sessionId, true)
    const state = this.ensureSession(sessionId)
    const previousMessages = state.messages
    const previousById = new Map(previousMessages.map(message => [message.info.id, message]))

    state.messages = apiMessages.map(apiMessage => {
      const next = toUIMessage(apiMessage)
      const previous = previousById.get(next.info.id)
      // 定稿（completed）强制采用服务端；仅流式/未完成时不回退更长 live
      if (!previous || !shouldPreserveLiveParts(previous, next)) return next
      return {
        ...next,
        parts: mergePartsPreferLiveText(previous.parts, next.parts),
        isStreaming: previous.isStreaming || next.isStreaming,
      }
    })
    state.loadState = 'loaded'
    state.loadError = undefined
    state.hasMoreHistory = options?.hasMoreHistory ?? false
    state.historyCursor = options?.historyCursor
    state.directory = options?.directory ?? ''
    if (options?.title !== undefined) state.title = options.title
    state.shareUrl = options?.shareUrl
    state.isStale = false

    // 整段替换：先归零缺口，再由 capSessionMessages 按本次实际裁剪量重新记账。
    state.trimmedCount = 0
    this.capSessionMessages(state)

    // 冷启动/刷新播种：整段加载后取最大用户消息时间作为锚点基线（单调，不会降级）。
    this.recordUserAnchorFromMessages(sessionId, options?.directory)

    // Revert 状态
    if (options?.revertState?.messageID) {
      const revertIndex = state.messages.findIndex(m => m.info.id === options.revertState!.messageID)
      if (revertIndex !== -1) {
        const revertedUserMessages = state.messages.slice(revertIndex).filter(isUserUIMessage)
        state.revertState = {
          messageId: options.revertState.messageID,
          history: revertedUserMessages.map(m => {
            return {
              messageId: m.info.id,
              text: this.extractUserText(m),
              attachments: this.extractUserAttachments(m),
              model: m.info.model,
              variant: m.info.model.variant,
              agent: m.info.agent,
            }
          }),
        }
      } else {
        // 撤销点已被裁剪掉（消息不在内存窗口内），清空以免悬空
        state.revertState = null
      }
    } else {
      state.revertState = null
    }

    // Streaming 检测
    const lastMsg = state.messages[state.messages.length - 1]
    if (lastMsg?.info.role === 'assistant') {
      const isLastMsgStreaming = !lastMsg.info.time?.completed
      state.isStreaming = isLastMsgStreaming
      if (isLastMsgStreaming) {
        const lastIndex = state.messages.length - 1
        state.messages[lastIndex] = { ...state.messages[lastIndex], isStreaming: true }
      }
    } else {
      state.isStreaming = false
    }

    this.notify([sessionId])
  }

  /**
   * 上滑加载历史：把更早的一页前插。
   *
   * 这里有意不调用 capSessionMessages —— 用户主动上滑就是为了看更早的内容，
   * 刚拉回来就裁掉会让上滑「拉不动」。单会话条数上限只在 append/SSE 增长路径
   * 作为内存兜底，历史加载路径的规模由用户滚动行为决定。
   */
  prependMessages(sessionId: string, apiMessages: ApiMessageWithParts[], hasMore: boolean, historyCursor?: string) {
    sessionId = this.resolveKey(sessionId)
    const state = this.sessions.get(sessionId)
    if (!state) return

    const newMessages = apiMessages.map(toUIMessage)

    // 去重
    const existingIds = new Set(state.messages.map(m => m.info.id))
    const unique = newMessages.filter(m => !existingIds.has(m.info.id))

    if (unique.length > 0) {
      state.messages = [...unique, ...state.messages]
    }
    // 内存缺口被补上多少就扣减多少：本次真正新增的条数即补回的条数。
    // 空拉（unique 为 0）时缺口不变，但也不会因此把 hasMoreHistory 置真而
    // 触发下一轮空拉 —— 缺口为 0 时 loadMoreHistory 的进入条件自然不成立。
    if (state.trimmedCount) {
      state.trimmedCount = Math.max(0, state.trimmedCount - unique.length)
    }
    state.hasMoreHistory = hasMore
    state.historyCursor = historyCursor

    this.notify([sessionId])
  }

  /**
   * 压缩较早轮次的过程内容。
   *
   * 只保留最近 `keepRecentTurns` 个用户轮次的完整过程；更早轮次的 assistant
   * 消息清空 reasoning 与工具大输出，只留渲染/统计所需的最小投影，并打上
   * `isCompressed` 标记。展开对应过程折叠块时按需回拉完整 parts。
   *
   * 只压缩已定稿（非流式、有 completed）的消息，避免误伤当前进行中的回合。
   * 返回是否发生实际变化，供调用方决定是否通知。
   */
  compressHistoricalTurns(sessionId: string, keepRecentTurns: number): boolean {
    sessionId = this.resolveKey(sessionId)
    const state = this.sessions.get(sessionId)
    if (!state) return false

    // 找轮次边界：每条 user 消息开启一个新轮次
    const turnStartIndexes: number[] = []
    for (let i = 0; i < state.messages.length; i++) {
      if (state.messages[i].info.role === 'user') turnStartIndexes.push(i)
    }
    if (turnStartIndexes.length <= keepRecentTurns) return false

    // 最近 keepRecentTurns 轮的起点，之前的所有消息都属可压缩区。
    // keepRecentTurns <= 0 时全部压缩；否则下标落在 [1, length) 内，安全。
    const compressBefore =
      keepRecentTurns <= 0 ? state.messages.length : turnStartIndexes[turnStartIndexes.length - keepRecentTurns]

    let changed = false
    const nextMessages = state.messages.slice()
    for (let i = 0; i < compressBefore; i++) {
      const message = nextMessages[i]
      if (message.info.role !== 'assistant') continue
      if (message.isStreaming || message.info.time.completed == null) continue
      if (message.isCompressed) continue

      const { parts, reasoningCount, stepCount } = compressMessageParts(message.parts)
      nextMessages[i] = {
        ...message,
        parts,
        isCompressed: true,
        compressedStats: { reasoningCount, stepCount },
      }
      changed = true
    }

    if (changed) {
      state.messages = nextMessages
      this.notify([sessionId])
    }
    return changed
  }

  /**
   * 用回拉到的完整消息替换内存中对应的压缩消息。
   *
   * 只替换 id 命中且当前仍存在的消息；替换后清掉 isCompressed 标记，使展开的
   * 折叠块恢复完整过程。不改动顺序，也不新增消息（回拉可能带回同轮其它消息，
   * 由调用方按需处理）。
   */
  hydrateMessages(sessionId: string, apiMessages: ApiMessageWithParts[]): boolean {
    sessionId = this.resolveKey(sessionId)
    const state = this.sessions.get(sessionId)
    if (!state || apiMessages.length === 0) return false

    const byId = new Map(apiMessages.map(message => [message.info.id, message]))
    let changed = false
    const nextMessages = state.messages.slice()

    for (let i = 0; i < nextMessages.length; i++) {
      const message = nextMessages[i]
      const incoming = byId.get(message.info.id)
      if (!incoming || !message.isCompressed) continue
      nextMessages[i] = {
        ...toUIMessage(incoming),
        isStreaming: message.isStreaming,
      }
      changed = true
    }

    if (changed) {
      state.messages = nextMessages
      this.notify([sessionId])
    }
    return changed
  }

  clearAll() {
    this.sessions.clear()
    this.sessionAccessTime.clear()
    this.dirtyPartsBySession.clear()
    this.messageIndexCache.clear()
    this.partIndexCache.clear()
    this.rawSessionToKey.clear()
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.pendingNotify = false
    this.notifyImmediate('all')
  }

  clearSession(sessionId: string) {
    sessionId = this.resolveKey(sessionId)
    this.sessions.delete(sessionId)
    this.sessionAccessTime.delete(sessionId)
    this.dirtyPartsBySession.delete(sessionId)
    this.messageIndexCache.delete(sessionId)
    this.partIndexCache.delete(sessionId)
    // 只清掉映射到本 key 的 raw 项；其它前缀若仍持有权威 key 则不动
    const raw = rawSessionIdOfKey(sessionId)
    if (this.rawSessionToKey.get(raw) === sessionId) this.rawSessionToKey.delete(raw)
    this.notify([sessionId])
  }

  setShareUrl(sessionId: string, url: string | undefined) {
    sessionId = this.resolveKey(sessionId)
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.shareUrl = url
    this.notify([sessionId])
  }

  // ============================================
  // SSE Event Handlers
  // ============================================

  handleMessageUpdated(apiMsg: ApiMessage) {
    const sessionKey = this.resolveKey(apiMsg.sessionID, true)
    const state = this.ensureSession(sessionKey)
    // 用户消息到达/更新：抬高会话与目录锚点（侧栏排序依据）
    this.recordUserMessageAnchor(sessionKey, apiMsg)
    // Replace an optimistic user row when the server's canonical message arrives.
    // Matching on text keeps this safe when the async prompt response has no message id.
    if (apiMsg.role === 'user') {
      const incomingText = Array.isArray((apiMsg as unknown as { parts?: Array<{ type?: string; text?: string }> }).parts)
        ? (apiMsg as unknown as { parts: Array<{ type?: string; text?: string }> }).parts
            .filter(part => part.type === 'text')
            .map(part => part.text ?? '')
            .join('')
        : undefined
      if (incomingText !== undefined) {
        const optimisticIndex = state.messages.findIndex(message => {
          if (!message.info.id.startsWith('msg-local-') || message.info.role !== 'user') return false
          return message.parts.some(part => part.type === 'text' && part.text === incomingText)
        })
        if (optimisticIndex >= 0) state.messages = state.messages.filter((_, index) => index !== optimisticIndex)
      }
    }
    const existingIndex = state.messages.findIndex(m => m.info.id === apiMsg.id)

    if (existingIndex >= 0) {
      const oldMessage = state.messages[existingIndex]
      const newMessage = { ...oldMessage, info: toUIMessageInfo(apiMsg) }
      state.messages = [
        ...state.messages.slice(0, existingIndex),
        newMessage,
        ...state.messages.slice(existingIndex + 1),
      ]
    } else {
      const newMsg: Message = {
        info: toUIMessageInfo(apiMsg),
        parts: [],
        isStreaming: apiMsg.role === 'assistant',
      }
      state.messages = [...state.messages, newMsg]
      this.capSessionMessages(state)
      if (apiMsg.role === 'assistant') {
        state.isStreaming = true
      }
    }

    this.notify([sessionKey])
  }

  handlePartUpdated(apiPart: ApiPart & { sessionID: string; messageID: string }) {
    const sessionKey = this.resolveKey(apiPart.sessionID)
    const state = this.sessions.get(sessionKey)
    if (!state) return

    let msgIndex = this.getMessageIndex(sessionKey, state).get(apiPart.messageID)
    if (msgIndex === undefined && apiPart.type === 'text') {
      const text = (apiPart as ApiPart & { text?: string }).text
      const optimisticIndex = typeof text === 'string'
        ? state.messages.findIndex(message => message.info.id.startsWith('msg-local-') && message.info.role === 'user' && message.parts.some(part => part.type === 'text' && part.text === text))
        : -1
      if (optimisticIndex >= 0) {
        const optimistic = state.messages[optimisticIndex]
        state.messages = [...state.messages.slice(0, optimisticIndex), { ...optimistic, info: { ...optimistic.info, id: apiPart.messageID } }, ...state.messages.slice(optimisticIndex + 1)]
        this.messageIndexCache.delete(sessionKey)
        msgIndex = optimisticIndex
      }
    }
    if (msgIndex === undefined) return

    const oldMessage = state.messages[msgIndex]
    let newParts = [...oldMessage.parts]
    const existingPartIndex = this.getPartIndex(sessionKey, apiPart.messageID, oldMessage.parts).get(apiPart.id)
    const incoming = toUIPart(apiPart)

    if (existingPartIndex !== undefined) {
      const existing = newParts[existingPartIndex]
      // 未定稿：兼容前缀时不回退；已 completed：强制服务端定稿
      newParts[existingPartIndex] = shouldPreserveLiveParts(oldMessage)
        ? mergePartPreferLiveText(existing, incoming)
        : incoming
    } else {
      // 服务端 canonical part 的 id 以 `prt` 开头；乐观消息的 part id 为本地形式
      // （如 `${messageId}:text`）。同一消息内出现服务端 part 时，先清掉同类型的本地
      // 占位 part，避免正文重复（乐观文本 + 服务端文本）。
      if (apiPart.id.startsWith('prt')) {
        newParts = newParts.filter(part => part.id.startsWith('prt') || part.type !== incoming.type)
      }
      newParts.push(incoming)
    }

    const newMessage = { ...oldMessage, parts: newParts }
    state.messages = [...state.messages.slice(0, msgIndex), newMessage, ...state.messages.slice(msgIndex + 1)]
    this.notify([sessionKey])
  }

  handlePartDelta(data: { sessionID: string; messageID: string; partID: string; field: string; delta: string }) {
    const sessionKey = this.resolveKey(data.sessionID)
    const state = this.sessions.get(sessionKey)
    if (!state) return

    const msgIndex = this.getMessageIndex(sessionKey, state).get(data.messageID)
    if (msgIndex === undefined) return
    const msg = state.messages[msgIndex]

    const partIndex = this.getPartIndex(sessionKey, data.messageID, msg.parts).get(data.partID)
    if (partIndex === undefined) return
    const part = msg.parts[partIndex]

    if (!(data.field === 'text' && 'text' in part))
      return // Mutable 修改：直接拼接 text，不做不可变拷贝。
      // 一帧内可能收到多个 delta，只有最后的状态会被 React 看到。
      // flushDirtyMessages() 会在 notify 的 rAF 回调中统一生成新引用。
    ;(part as { text: string }).text += data.delta

    let dirtyPartsByMessage = this.dirtyPartsBySession.get(sessionKey)
    if (!dirtyPartsByMessage) {
      dirtyPartsByMessage = new Map<string, Set<string>>()
      this.dirtyPartsBySession.set(sessionKey, dirtyPartsByMessage)
    }
    let dirtyPartIds = dirtyPartsByMessage.get(data.messageID)
    if (!dirtyPartIds) {
      dirtyPartIds = new Set<string>()
      dirtyPartsByMessage.set(data.messageID, dirtyPartIds)
    }
    dirtyPartIds.add(data.partID)
    this.notify([sessionKey])
  }

  handlePartRemoved(data: { partID: string; messageID: string; sessionID: string }) {
    const sessionKey = this.resolveKey(data.sessionID)
    const state = this.sessions.get(sessionKey)
    if (!state) return

    const msgIndex = this.getMessageIndex(sessionKey, state).get(data.messageID)
    if (msgIndex === undefined) return

    const oldMessage = state.messages[msgIndex]
    if (!oldMessage.parts.some(p => p.id === data.partID)) return

    const newMessage = { ...oldMessage, parts: oldMessage.parts.filter(p => p.id !== data.partID) }
    state.messages = [...state.messages.slice(0, msgIndex), newMessage, ...state.messages.slice(msgIndex + 1)]
    this.notify([sessionKey])
  }

  /**
   * 会话已结束（idle/error）时，把仍处于 running/pending 的 tool part 落定为
   * interrupted。
   *
   * 后端 bash 工具子进程卡死或事件丢失时，服务端可能永远不补发该 part 的
   * message.part.updated，工具卡片就会永久转圈——即使会话状态已变 idle、侧栏
   * 状态点已熄灭。这里以会话结束信号为准做一次对账，把悬空的 part 收尾。
   *
   * 只改内存副本：服务端后续若补发权威 completed/error，会被 handlePartUpdated
   * 正常覆盖。running 态的输出已在 metadata.output 中，标记 interrupted 后由
   * 渲染层继续展示（registry 的 interruptedOutput 分支）。
   */
  private reconcileInFlightTools(state: SessionState, now: number): boolean {
    let changed = false
    state.messages = state.messages.map(message => {
      let partsChanged = false
      const parts = message.parts.map(part => {
        if (part.type !== 'tool') return part
        const status = part.state.status
        if (status !== 'running' && status !== 'pending') return part
        partsChanged = true
        changed = true
        const start = part.state.time?.start ?? now
        return {
          ...part,
          state: {
            ...part.state,
            status: 'interrupted' as const,
            metadata: { ...(part.state.metadata ?? {}), interrupted: true },
            time: { ...(part.state.time ?? {}), start, end: now },
          },
        }
      })
      return partsChanged ? { ...message, parts } : message
    })
    return changed
  }

  /** 会话结束的公共收尾：清 streaming、补 completed、对账悬空工具。 */
  private finalizeSession(sessionId: string) {
    sessionId = this.resolveKey(sessionId)
    const state = this.sessions.get(sessionId)
    if (!state) return

    state.isStreaming = false
    const completedAt = Date.now()
    const hasStreamingMessage = state.messages.some(m => m.isStreaming)
    if (hasStreamingMessage) {
      state.messages = state.messages.map(m => {
        if (!m.isStreaming) return m
        return {
          ...m,
          isStreaming: false,
          info: {
            ...m.info,
            time: {
              ...m.info.time,
              completed: m.info.time.completed ?? completedAt,
            },
          },
        }
      })
    }
    this.reconcileInFlightTools(state, completedAt)
    this.notify([sessionId])
  }

  handleSessionIdle(sessionId: string) {
    this.finalizeSession(sessionId)
  }

  handleSessionError(sessionId: string) {
    this.finalizeSession(sessionId)
  }

  /**
   * 按 callID 落定某个工具 part（next.* 事件流的防御性对账）。
   *
   * 正常情况下工具终态由 message.part.updated 承载；若后端改用
   * session.next.tool.success/failed 或 session.next.shell.ended 描述结束，
   * 这里保证仍处于 running/pending 的对应 part 不会悬空。已有权威终态的
   * part 不覆盖（避免用不完整信息盖掉服务端结果）。
   */
  settleToolByCallID(
    sessionId: string,
    callID: string,
    outcome: { status: 'completed' | 'error'; output?: string; error?: string },
  ): void {
    sessionId = this.resolveKey(sessionId)
    const state = this.sessions.get(sessionId)
    if (!state) return

    const now = Date.now()
    let changed = false
    state.messages = state.messages.map(message => {
      let partsChanged = false
      const parts = message.parts.map(part => {
        if (part.type !== 'tool' || part.callID !== callID) return part
        const status = part.state.status
        if (status !== 'running' && status !== 'pending') return part
        partsChanged = true
        changed = true
        const start = part.state.time?.start ?? now
        if (outcome.status === 'error') {
          return {
            ...part,
            state: {
              ...part.state,
              status: 'error' as const,
              error: outcome.error ?? part.state.error ?? i18n.t('message:toolPart.toolFailed'),
              time: { ...(part.state.time ?? {}), start, end: now },
            },
          }
        }
        return {
          ...part,
          state: {
            ...part.state,
            status: 'completed' as const,
            output: outcome.output ?? part.state.output ?? '',
            time: { ...(part.state.time ?? {}), start, end: now },
          },
        }
      })
      return partsChanged ? { ...message, parts } : message
    })

    if (changed) this.notify([sessionId])
  }

  // ============================================
  // Undo/Redo
  // ============================================

  truncateAfterRevert(sessionId: string) {
    sessionId = this.resolveKey(sessionId)
    const state = this.sessions.get(sessionId)
    if (!state || !state.revertState) return

    const revertIndex = state.messages.findIndex(m => m.info.id === state.revertState!.messageId)
    if (revertIndex !== -1) {
      state.messages = state.messages.slice(0, revertIndex)
    }
    state.revertState = null
    this.notify([sessionId])
  }

  createSendRollbackSnapshot(sessionId: string): SendRollbackSnapshot | null {
    sessionId = this.resolveKey(sessionId)
    const state = this.sessions.get(sessionId)
    if (!state?.revertState) return null

    return {
      messages: state.messages.map(m => ({ ...m, parts: [...m.parts] })),
      revertState: {
        ...state.revertState,
        history: state.revertState.history.map(item => ({ ...item, attachments: [...item.attachments] })),
      },
    }
  }

  restoreSendRollback(sessionId: string, snapshot: SendRollbackSnapshot) {
    sessionId = this.resolveKey(sessionId)
    const state = this.sessions.get(sessionId)
    if (!state) return

    state.messages = snapshot.messages.map(m => ({ ...m, parts: [...m.parts] }))
    state.revertState = snapshot.revertState
      ? {
          ...snapshot.revertState,
          history: snapshot.revertState.history.map(item => ({ ...item, attachments: [...item.attachments] })),
        }
      : null
    state.isStreaming = false
    this.notify([sessionId])
  }

  setRevertState(sessionId: string, revertState: RevertState | null) {
    sessionId = this.resolveKey(sessionId)
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.revertState = revertState
    this.notify([sessionId])
  }

  getLastUserMessageId(sessionId: string | null): string | null {
    const messages = this.getVisibleMessages(sessionId)
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].info.role === 'user') return messages[i].info.id
    }
    return null
  }

  canUndo(sessionId: string | null): boolean {
    if (!sessionId) return false
    const state = this.sessions.get(this.resolveKey(sessionId))
    if (!state || state.isStreaming) return false
    return this.getVisibleMessages(sessionId).some(m => m.info.role === 'user')
  }

  canRedo(sessionId: string | null): boolean {
    if (!sessionId) return false
    const state = this.sessions.get(this.resolveKey(sessionId))
    if (!state || state.isStreaming) return false
    return (state.revertState?.history.length ?? 0) > 0
  }

  getRedoSteps(sessionId: string | null): number {
    if (!sessionId) return 0
    const state = this.sessions.get(this.resolveKey(sessionId))
    return state?.revertState?.history.length ?? 0
  }

  getCurrentRevertedContent(sessionId: string | null): RevertHistoryItem | null {
    if (!sessionId) return null
    const state = this.sessions.get(this.resolveKey(sessionId))
    const revertState = state?.revertState ?? null
    if (!revertState || revertState.history.length === 0) return null
    return revertState.history[0]
  }

  // ============================================
  // Streaming Control
  // ============================================

  setStreaming(sessionId: string, isStreaming: boolean) {
    sessionId = this.resolveKey(sessionId, true)
    const state = isStreaming ? this.ensureSession(sessionId) : this.sessions.get(sessionId)
    if (!state) return
    state.isStreaming = isStreaming
    this.notify([sessionId])
  }

  // ============================================
  // Private Helpers
  // ============================================
  private extractUserText(message: Message): string {
    return message.parts
      .filter((p): p is Part & { type: 'text' } => p.type === 'text' && !p.synthetic)
      .map(p => p.text)
      .join('\n')
  }

  private extractUserAttachments(message: Message): Attachment[] {
    const attachments: Attachment[] = []

    for (const part of message.parts) {
      if (part.type === 'file') {
        const fp = part as FilePart
        const isFolder = fp.mime === 'application/x-directory'
        const sourcePath =
          fp.source && 'path' in fp.source
            ? fp.source.path
            : fp.source && 'uri' in fp.source
              ? fp.source.uri
              : undefined
        attachments.push({
          id: fp.id || crypto.randomUUID(),
          type: isFolder ? 'folder' : 'file',
          displayName: fp.filename || sourcePath || 'file',
          url: fp.url,
          mime: fp.mime,
          relativePath: sourcePath,
          textRange: fp.source?.text
            ? {
                value: fp.source.text.value,
                start: fp.source.text.start,
                end: fp.source.text.end,
              }
            : undefined,
        })
      } else if (part.type === 'agent') {
        const ap = part as AgentPart
        attachments.push({
          id: ap.id || crypto.randomUUID(),
          type: 'agent',
          displayName: ap.name,
          agentName: ap.name,
          textRange: ap.source
            ? {
                value: ap.source.value,
                start: ap.source.start,
                end: ap.source.end,
              }
            : undefined,
        })
      }
    }

    return attachments
  }
}

export const messageStore = new MessageStore()
