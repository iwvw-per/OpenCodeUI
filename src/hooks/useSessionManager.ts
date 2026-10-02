// ============================================
// useSessionManager - Session 加载和状态管理
// ============================================
//
// 职责：
// 1. 加载 session 消息（初始加载 + 懒加载历史）
// 2. 处理 undo/redo（调用 API + 更新 store）
// 3. 只管理单个 session 的加载状态，不再承担全局当前 session 同步

import { useCallback, useEffect, useRef } from 'react'
import { logger } from '../utils/logger'
import { isUserUIMessage, toApiMessageWithParts } from '../utils/messageConversion'
import { messageStore, type RevertState, type SessionState } from '../store'
import { sessionKeyToServerId } from '../utils/sessionKey'
import {
  getSessionMessagePage,
  getSession,
  revertMessage,
  unrevertSession,
  extractUserMessageContent,
  type ApiMessageWithParts,
} from '../api'
import { sessionErrorHandler } from '../utils'
import { isSessionNotFoundError } from '../utils/sessionErrors'
import { INITIAL_MESSAGE_LIMIT, HISTORY_LOAD_BATCH_SIZE } from '../constants'
import type { MessageError } from '../types/message'

function toLoadMessageError(error: unknown): MessageError {
  const message = error instanceof Error ? error.message : String(error || 'Failed to load session')
  return {
    name: 'APIError',
    data: {
      message,
      isRetryable: isRetryableLoadError(error),
      responseBody: error instanceof Error ? error.stack : undefined,
    },
  }
}

/**
 * 判定加载失败是否值得自动重试。
 *
 * 目标场景：本地 serve 进程短暂未就绪、传输层单次抖动，抛出的
 * `TypeError: Failed to fetch`（Tauri/webview 网络层失败）或超时/中止错误。
 * 这类错误是瞬态的，重试同一请求即可恢复，不必让用户手动刷新。
 *
 * 明确不重试：404/会话不存在（重试也不会出现），以及其它带 4xx 状态码的
 * 确定性错误。
 */
function isRetryableLoadError(error: unknown): boolean {
  if (isSessionNotFoundError(error)) return false

  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : null
  const status =
    typeof record?.status === 'number'
      ? record.status
      : typeof record?.statusCode === 'number'
        ? record.statusCode
        : undefined
  if (status !== undefined && status >= 400 && status < 500) return false

  const message = error instanceof Error ? error.message : String(error ?? '')
  return /failed to fetch|network|timeout|timed out|aborted|econnrefused|connection (refused|reset|closed)|load failed/i.test(
    message,
  )
}

/** 有限次退避重试；仅在 isRetryableLoadError 判定为可重试且未失效时重试 */
async function withLoadRetry<T>(fn: () => Promise<T>, isStale: () => boolean): Promise<T> {
  const delays = [500, 1500, 3000]
  let lastError: unknown
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (isStale() || !isRetryableLoadError(error) || attempt === delays.length) throw error
      sessionErrorHandler('load session retry', error)
      await new Promise(resolve => setTimeout(resolve, delays[attempt]))
    }
  }
  throw lastError
}

/**
 * 判定服务端是否支持游标分页。
 * 支持时返回 nextCursor；不支持（旧版 serve 忽略 before）时只给 hasMoreHistory，
 * 调用方退回「limit 递增后重拉」的旧分页。
 */
function resolveHistoryPaging(page: { messages: ApiMessageWithParts[]; nextCursor?: string }, pageSize: number) {
  if (page.nextCursor) return { hasMoreHistory: true, historyCursor: page.nextCursor }
  return { hasMoreHistory: page.messages.length >= pageSize, historyCursor: undefined }
}

interface UseSessionManagerOptions {
  sessionId: string | null
  directory?: string // 当前项目目录
  onLoadComplete?: () => void
  onError?: (error: Error) => void
  onSessionMissing?: (sessionId: string) => void
}

function preferCompatiblePartText(local: string, incoming: string): string {
  if (local === incoming) return incoming
  if (local.startsWith(incoming)) return local
  if (incoming.startsWith(local)) return incoming
  return incoming
}

function messageTimeIncomplete(time?: { completed?: number } | { created: number }) {
  if (!time) return true
  return !('completed' in time) || time.completed == null
}

function mergePartsForReload(
  localParts: ApiMessageWithParts['parts'],
  apiParts: ApiMessageWithParts['parts'],
): ApiMessageWithParts['parts'] {
  const localById = new Map(localParts.map(part => [part.id, part]))
  return apiParts.map(part => {
    const local = localById.get(part.id)
    if (!local || !('text' in local) || !('text' in part)) return part
    if (typeof local.text !== 'string' || typeof part.text !== 'string') return part
    const text = preferCompatiblePartText(local.text, part.text)
    if (text === part.text) return part
    return { ...part, text: text as typeof part.text }
  })
}

function mergeWithLocalStreamingMessages(
  apiMessages: ApiMessageWithParts[],
  localState?: SessionState,
): ApiMessageWithParts[] {
  if (!localState || localState.messages.length === 0) return apiMessages

  const localById = new Map(localState.messages.map(message => [message.info.id, message]))
  const apiIds = new Set(apiMessages.map(m => m.info.id))

  // 同 message：仅未定稿时 part 文本不回退；incoming 已 completed 则强制服务端
  const mergedApi = apiMessages.map(apiMessage => {
    const local = localById.get(apiMessage.info.id)
    if (!local) return apiMessage
    if (!messageTimeIncomplete(apiMessage.info.time)) return apiMessage
    const preserve = local.isStreaming || messageTimeIncomplete(local.info.time) || localState.isStreaming
    if (!preserve) return apiMessage
    return {
      ...apiMessage,
      parts: mergePartsForReload(local.parts as ApiMessageWithParts['parts'], apiMessage.parts),
    }
  })

  const localOnly = localState.isStreaming
    ? localState.messages.filter(m => !apiIds.has(m.info.id)).map(toApiMessageWithParts)
    : []

  if (localOnly.length === 0) return mergedApi

  return [...mergedApi, ...localOnly].sort((a, b) => {
    const aCreated = a.info.time?.created ?? 0
    const bCreated = b.info.time?.created ?? 0
    return aCreated - bCreated
  })
}

export function useSessionManager({ sessionId, directory, onLoadComplete, onError, onSessionMissing }: UseSessionManagerOptions) {
  const loadSequenceRef = useRef<Map<string, number>>(new Map())
  /** 每个 session 是否正在加载更早的历史，防止并发 loadMore 造成分页错位 */
  const isLoadingMoreRef = useRef<Map<string, boolean>>(new Map())
  const loadSessionRef = useRef<(sid: string, options?: { force?: boolean }) => Promise<void>>(async () => {})

  // 使用 ref 保存 directory，避免依赖变化
  const directoryRef = useRef(directory)

  useEffect(() => {
    directoryRef.current = directory
  }, [directory])

  // ============================================
  // Load Session
  // ============================================

  const loadSession = useCallback(
    async (sid: string, options?: { force?: boolean }) => {
      const force = options?.force ?? false

      const seq = (loadSequenceRef.current.get(sid) ?? 0) + 1
      loadSequenceRef.current.set(sid, seq)
      const isStale = () => loadSequenceRef.current.get(sid) !== seq

      const dir = directoryRef.current

      // 检查是否已有消息（SSE 可能已经推送了）
      const existingState = messageStore.getSessionState(sid)
      const hasExistingMessages = existingState && existingState.messages.length > 0
      const hasLoadedBaseline = existingState?.loadState === 'loaded' && !existingState?.isStale

      // 如果已经有消息且正在 streaming，不能覆盖消息，但仍需加载元数据
      // 仅在「已经完整加载过」时才跳过覆盖；
      // 对于仅靠 SSE 暂存出来的 session（loadState=idle），仍要做一次完整拉取
      // force 模式下也不覆盖正在 streaming 且已加载的消息
      if (hasExistingMessages && existingState.isStreaming && hasLoadedBaseline) {
        // 异步加载 session 元数据（不阻塞）
        const dir = directoryRef.current
        const serverId = sessionKeyToServerId(sid)
        Promise.all([
          getSession(sid, dir, serverId).catch(() => null),
          getSessionMessagePage(sid, INITIAL_MESSAGE_LIMIT, undefined, dir, serverId)
            .then(page => ({ ok: true as const, page }))
            .catch(() => ({ ok: false as const, page: { messages: [] as ApiMessageWithParts[], nextCursor: undefined } })),
        ])
          .then(([sessionInfo, pageResult]) => {
            if (isStale()) return

            messageStore.updateSessionMetadata(sid, {
              ...(pageResult.ok ? resolveHistoryPaging(pageResult.page, INITIAL_MESSAGE_LIMIT) : {}),
              directory: sessionInfo?.directory ?? dir ?? '',
              title: sessionInfo?.title,
              shareUrl: sessionInfo?.share?.url,
            })
          })
          .catch(() => {
            // 元数据加载失败不影响 streaming，静默忽略
          })
        if (!isStale()) {
          onLoadComplete?.()
        }
        return
      }

      // 已有可显示内容时，刷新走「后台替换」而不打回 loading。
      //
      // ChatPane 用 `loadState === 'loaded'` 决定是否挂载 ChatArea，回落成
      // loading 会卸载已渲染的对话、闪一次全屏 loading、再重新挂载并跳回顶部
      // ——用户看到的就是「切换主机 / 重连 / 切回前台时对话整个刷新一遍」。
      // 保留 loaded 状态让旧内容留在屏上，数据到达后原地替换，滚动位置不丢。
      // 只有首次加载（屏上还没有内容）才需要 loading 占位并显示骨架。
      const hasContentToKeep =
        !!existingState && (existingState.loadState === 'loaded' || existingState.messages.length > 0)
      if (!hasContentToKeep) {
        messageStore.setLoadState(sid, 'loading')
      }

      try {
        // 并行加载 session 信息和消息（传递 directory）。
        // 瞬态网络失败（本地 serve 短暂未就绪、传输层抖动）自动重试，避免
        // 首屏或重连时一次 Failed to fetch 就把用户卡在错误页。
        const serverId = sessionKeyToServerId(sid)
        const [sessionInfo, page] = await withLoadRetry(
          () =>
            Promise.all([
              getSession(sid, dir, serverId).catch(() => null),
              getSessionMessagePage(sid, INITIAL_MESSAGE_LIMIT, undefined, dir, serverId),
            ]),
          isStale,
        )
        const apiMessages = page.messages

        if (isStale()) return

        // 再次检查：加载期间 SSE 可能已经推送了更多消息
        // force 模式下（重连）始终用服务器数据覆盖，因为本地数据可能不完整
        const currentState = messageStore.getSessionState(sid)
        const shouldKeepStreamingOnly =
          !force &&
          !!currentState &&
          !currentState.isStale &&
          currentState.loadState === 'loaded' &&
          currentState.messages.length > apiMessages.length

        const paging = resolveHistoryPaging(page, INITIAL_MESSAGE_LIMIT)

        if (shouldKeepStreamingOnly) {
          // SSE 推送的消息比 API 返回的多，说明有新消息，跳过覆盖
          // 但仍需更新元数据，否则 hasMoreHistory 等状态可能停留在默认值
          messageStore.updateSessionMetadata(sid, {
            ...paging,
            directory: sessionInfo?.directory ?? dir ?? '',
            title: sessionInfo?.title,
            loadState: 'loaded',
            shareUrl: sessionInfo?.share?.url,
          })
          onLoadComplete?.()
          return
        }

        const mergedMessages = mergeWithLocalStreamingMessages(apiMessages, currentState)

        // 设置消息到 store
        messageStore.setMessages(sid, mergedMessages, {
          directory: sessionInfo?.directory ?? dir ?? '',
          title: sessionInfo?.title,
          ...paging,
          revertState: sessionInfo?.revert ?? null,
          shareUrl: sessionInfo?.share?.url,
        })

        // force 模式（如 SSE 重连）只静默刷新数据，不触发滚动
        if (!force) {
          onLoadComplete?.()
        }
      } catch (error) {
        if (isStale()) return
        sessionErrorHandler('load session', error)
        messageStore.setLoadError(sid, toLoadMessageError(error))
        if (isSessionNotFoundError(error)) {
          onSessionMissing?.(sid)
        }
        onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    },
    [onLoadComplete, onError, onSessionMissing],
  )

  // 保持 ref 同步，避免 effect 依赖 loadSession 导致重复触发
  useEffect(() => {
    loadSessionRef.current = loadSession
  }, [loadSession])

  // ============================================
  // Load More History
  // ============================================

  const loadMoreHistory = useCallback(async () => {
    if (!sessionId) return

    // 并发保护：同一 session 只允许一个 loadMore 在途
    if (isLoadingMoreRef.current.get(sessionId)) return

    const state = messageStore.getSessionState(sessionId)
    if (!state) return

    const dir = state.directory || directoryRef.current
    const before = state.historyCursor
    // 既没有游标、服务端又声称还有历史：旧版 serve（不支持 before 游标），
    // 退回「limit 递增后重拉」的旧分页
    const legacyLimit = !before ? Math.max(INITIAL_MESSAGE_LIMIT, state.messages.length) + HISTORY_LOAD_BATCH_SIZE : 0
    if (!before && !state.hasMoreHistory) return

    // 与 loadSession 相同的序号校验：仅当本次请求仍是最新请求时才应用结果
    const seq = (loadSequenceRef.current.get(sessionId) ?? 0) + 1
    loadSequenceRef.current.set(sessionId, seq)
    const isStale = () => loadSequenceRef.current.get(sessionId) !== seq

    isLoadingMoreRef.current.set(sessionId, true)
    try {
      const serverId = sessionKeyToServerId(sessionId)
      const page = before
        ? await getSessionMessagePage(sessionId, HISTORY_LOAD_BATCH_SIZE, before, dir, serverId)
        : await getSessionMessagePage(sessionId, legacyLimit, undefined, dir, serverId)

      // 期间发生了新的加载（loadSession 或再次 loadMore），丢弃本次结果
      if (isStale()) return

      const latestState = messageStore.getSessionState(sessionId)
      if (!latestState) return

      // 去重 + 按时间排序
      const existingIds = new Set(latestState.messages.map(m => m.info.id))
      const prependCandidates = page.messages
        .filter(m => !existingIds.has(m.info.id))
        .sort((a, b) => (a.info.time?.created ?? 0) - (b.info.time?.created ?? 0))

      const paging = before
        ? resolveHistoryPaging(page, HISTORY_LOAD_BATCH_SIZE)
        : resolveHistoryPaging(page, legacyLimit)

      messageStore.prependMessages(sessionId, prependCandidates, paging.hasMoreHistory, paging.historyCursor)
    } catch (error) {
      sessionErrorHandler('load more history', error)
    } finally {
      isLoadingMoreRef.current.set(sessionId, false)
    }
  }, [sessionId])

  // ============================================
  // Undo
  // ============================================

  /**
   * 发起撤销请求并计算 redo 历史，但不提交状态。
   *
   * 拆出「网络请求」与「状态提交」两步，是为了让动画与网络并行：
   * 调用方可先发起本请求，同时播放淡出动画，动画结束后再 commitUndo，
   * 从而把网络往返从串行路径上移出（原来先等动画再发请求，两段耗时叠加）。
   */
  const requestUndo = useCallback(
    async (userMessageId: string): Promise<RevertState | null> => {
      if (!sessionId) return null

      const state = messageStore.getSessionState(sessionId)
      if (!state) return null

      const dir = state.directory || directoryRef.current

      try {
        // 调用 API 设置 revert 点（传递 directory）
        await revertMessage(sessionId, userMessageId, undefined, dir, sessionKeyToServerId(sessionId))

        // 找到 revert 点的索引
        const revertIndex = state.messages.findIndex(m => m.info.id === userMessageId)
        if (revertIndex === -1) return null

        // 收集被撤销的用户消息，构建 redo 历史
        const revertedUserMessages = state.messages.slice(revertIndex).filter(isUserUIMessage)

        const history = revertedUserMessages.map(m => {
          const content = extractUserMessageContent(m)
          const userInfo = m.info
          return {
            messageId: m.info.id,
            text: content.text,
            attachments: content.attachments,
            model: userInfo.model,
            variant: userInfo.model.variant,
            agent: userInfo.agent,
          }
        })

        return { messageId: userMessageId, history }
      } catch (error) {
        sessionErrorHandler('undo', error)
        return null
      }
    },
    [sessionId],
  )

  /** 提交撤销状态（由 requestUndo 得到的 revertState） */
  const commitUndo = useCallback(
    (revertState: RevertState) => {
      if (!sessionId) return
      messageStore.setRevertState(sessionId, revertState)
    },
    [sessionId],
  )

  const handleUndo = useCallback(
    async (userMessageId: string) => {
      const revertState = await requestUndo(userMessageId)
      if (revertState) commitUndo(revertState)
    },
    [requestUndo, commitUndo],
  )

  // ============================================
  // Redo
  // ============================================

  const handleRedo = useCallback(async () => {
    if (!sessionId) return

    const state = messageStore.getSessionState(sessionId)
    if (!state?.revertState) return

    const { history } = state.revertState
    if (history.length === 0) return

    const dir = state.directory || directoryRef.current

    try {
      // 移除第一条历史记录（最早撤销的）
      const newHistory = history.slice(1)

      if (newHistory.length > 0) {
        // 还有更多历史，设置新的 revert 点
        const newRevertMessageId = newHistory[0].messageId
        await revertMessage(sessionId, newRevertMessageId, undefined, dir, sessionKeyToServerId(sessionId))

        messageStore.setRevertState(sessionId, {
          messageId: newRevertMessageId,
          history: newHistory,
        })
      } else {
        // 没有更多历史，完全清除 revert 状态
        await unrevertSession(sessionId, dir, sessionKeyToServerId(sessionId))
        messageStore.setRevertState(sessionId, null)
      }
    } catch (error) {
      sessionErrorHandler('redo', error)
    }
  }, [sessionId])

  // ============================================
  // Redo All
  // ============================================

  const handleRedoAll = useCallback(async () => {
    if (!sessionId) return

    const state = messageStore.getSessionState(sessionId)
    const dir = state?.directory || directoryRef.current

    try {
      await unrevertSession(sessionId, dir, sessionKeyToServerId(sessionId))
      messageStore.setRevertState(sessionId, null)
    } catch (error) {
      sessionErrorHandler('redo all', error)
    }
  }, [sessionId])

  // ============================================
  // Clear Revert
  // ============================================

  const clearRevert = useCallback(() => {
    if (!sessionId) return
    messageStore.setRevertState(sessionId, null)
  }, [sessionId])

  // ============================================
  // Effects
  // ============================================

  // 根据 sessionId 切换缓存视图。
  // focused pane / URL 的同步由 App 顶层统一负责，
  // 这里不再写任何“全局当前 session”状态。
  useEffect(() => {
    if (sessionId) {
      const cached = messageStore.getSessionState(sessionId)
      const canUseCached = !!cached && cached.loadState === 'loaded' && !cached.isStale && cached.messages.length > 0

      if (canUseCached) {
        logger.log('[SessionManager] switch:use-cached', {
          sessionId,
          cachedCount: cached.messages.length,
        })
        return
      }

      logger.log('[SessionManager] switch:fetch-session', { sessionId })
      void loadSessionRef.current(sessionId)
    }
  }, [sessionId])

  return {
    loadSession,
    loadMoreHistory,
    handleUndo,
    requestUndo,
    commitUndo,
    handleRedo,
    handleRedoAll,
    clearRevert,
  }
}
