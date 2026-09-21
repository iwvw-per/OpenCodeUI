// ============================================
// Session API Functions
// 基于 @opencode-ai/sdk: /session 相关接口
// ============================================

import { getSDKClient, unwrap } from './sdk'
import { resolveSessionTarget } from '../utils/sessionKey'
import { normalizeTodoItems } from './todo'
import { formatPathForApi, directoryCacheKey } from '../utils/directoryUtils'
import { getSessionMessages } from './message'
import { normalizeFileDiffs } from '../types/api/file'
import { INITIAL_MESSAGE_LIMIT } from '../constants/pagination'
import { serverStore } from '../store/serverStore'
import {
  readSessionListCache,
  writeSessionListCache,
  invalidateSessionListCache,
  dedupeSessionListRequest,
} from './sessionListCache'
import { singleFlight } from '../utils/singleFlight'
import { stripSessionListDetails } from './sanitize'
import type { ApiSession, SessionListParams, FileDiff, ApiMessageWithParts, ApiUserMessage } from './types'
import type { SessionStatusMap } from '../types/api/session'
import type { TodoItem } from '../types/api/event'

export { invalidateSessionListCache }

function normalizeSessionList(value: unknown): ApiSession[] {
  if (Array.isArray(value)) return value as ApiSession[]
  throw new Error('Invalid OpenCode session list response')
}

// ============================================
// Session Status & Diff
// ============================================

/**
 * 获取所有 session 的当前状态
 *
 * 同 (server, directory) 的并发调用共享一次网络请求：初始化、目录切换、
 * SSE 重连都会触发全量拉取，不去重会在同一帧发出多份相同请求。
 */
export async function getSessionStatus(directory?: string, serverId?: string): Promise<SessionStatusMap> {
  const sid = serverId ?? serverStore.getActiveServerId()
  return singleFlight(`status:${sid}:${directoryCacheKey(directory)}`, async () => {
    const sdk = getSDKClient(serverId)
    return unwrap(await sdk.session.status({ directory: formatPathForApi(directory, serverId) }))
  })
}

/**
 * 获取 session 的 diff
 * 返回可在 UI 中渲染的 SnapshotFileDiff（过滤缺少 file 的异常项）
 */
export async function getSessionDiff(
  sessionId: string,
  directory?: string,
  messageId?: string,
  serverId?: string,
): Promise<FileDiff[]> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return normalizeFileDiffs(
    unwrap(
      await sdk.session.diff({
        sessionID: target.sessionId,
        directory: formatPathForApi(directory, target.serverId),
        messageID: messageId,
      }),
    ),
  )
}

function isUserMessage(message: ApiMessageWithParts): message is ApiMessageWithParts & { info: ApiUserMessage } {
  return message.info.role === 'user'
}

/**
 * 获取当前可见用户消息对应的本轮 diff
 *
 * 对齐 opencode 官方行为：官方 turn 模式的变更列表直接取最近一条 user 消息
 * 的 summary.diffs（见 packages/app/src/pages/session.tsx 的 turnDiffs），
 * 而不是全量拉取消息。这里只取最近一批消息（INITIAL_MESSAGE_LIMIT，分页语义），
 * 避免 limit=undefined 时的全量下载——带 directory 参数时，全量消息响应会包含
 * 整个工作区相关的文件 part，大项目里一次请求可能非常大（issue #157）。
 */
export async function getLastTurnDiff(sessionId: string, directory?: string, serverId?: string): Promise<FileDiff[]> {
  const [session, messages] = await Promise.all([
    getSession(sessionId, directory, serverId),
    // project:false —— 本轮 diff 依赖 summary.diffs，不能用消息流的裁剪投影
    getSessionMessages(sessionId, INITIAL_MESSAGE_LIMIT, directory, serverId, { project: false }),
  ])

  const userMessages = messages.filter(isUserMessage)
  const revertMessageId = session.revert?.messageID
  const visibleUserMessages = revertMessageId
    ? userMessages.filter(message => message.info.id < revertMessageId)
    : userMessages

  return normalizeFileDiffs(visibleUserMessages.at(-1)?.info.summary?.diffs)
}

// ============================================
// Session CRUD
// ============================================

/**
 * 获取 session 列表
 * 默认不返回归档会话（time.archived），避免归档后回显到侧栏/搜索/会话切换。
 * 传 includeArchived 时透传服务端 archived 参数（服务端语义为"也包含归档"），
 * 并在归档视图下按 time.archived 收窄，供「已归档」列表使用。
 */
export async function getSessions(
  params: SessionListParams & { includeArchived?: boolean; archivedOnly?: boolean; skipCache?: boolean } = {},
  serverId?: string,
): Promise<ApiSession[]> {
  const sdk = getSDKClient(serverId)
  const { directory, roots, start, search, limit, includeArchived, archivedOnly, skipCache } = params
  // 服务端的 active 过滤是 time_archived IS NULL，会把恢复后的会话
  // （time.archived === 0，falsy-but-present）排除掉，导致恢复的会话不回显。
  // 因此无论目标列表是活跃还是归档，都向服务端请求归档（archived: true 包含式），
  // 再在客户端按 time.archived 真值分桶（见 openchamber splitGlobalSessionsByArchived）。
  const sdkArchived = true
  const sdkQuery = {
    directory: formatPathForApi(directory, serverId),
    roots,
    start,
    search,
    limit,
    archived: sdkArchived,
  }
  const cacheQuery = { ...sdkQuery, includeArchived, archivedOnly, skipCache }

  const cacheServerId = serverId ?? serverStore.getActiveServerId()
  const cached = readSessionListCache(cacheServerId, cacheQuery)
  // 返回浅拷贝：调用方（如 getArchivedSessions 的 sort）可能就地修改数组，
  // 直接返回缓存引用会把缓存内容改坏
  if (cached) return cached.slice()

  return dedupeSessionListRequest(cacheServerId, cacheQuery, async () => {
    const sessions = normalizeSessionList(unwrap(await sdk.experimental.session.list(sdkQuery)))
    const filtered = archivedOnly
      ? sessions.filter(session => Boolean(session.time?.archived))
      : includeArchived
        ? sessions
        : sessions.filter(session => !session.time?.archived)
    // 列表渲染不需要 summary.diffs / revert 快照 / permission 详情，
    // 这些字段单条可达数百 KB，且会被缓存 30s，去掉后缓存占用同步下降。
    const result = filtered.map(stripSessionListDetails)

    writeSessionListCache(cacheServerId, cacheQuery, result)
    return result.slice()
  })
}

/**
 * 获取已归档的 session 列表（按归档时间倒序）
 */
export async function getArchivedSessions(params: SessionListParams = {}, serverId?: string): Promise<ApiSession[]> {
  const sessions = await getSessions({ ...params, archivedOnly: true }, serverId)
  return [...sessions].sort((a, b) => (b.time?.archived ?? 0) - (a.time?.archived ?? 0))
}

/**
 * 恢复已归档的 session（把 time.archived 清为 0）
 */
export async function restoreSession(sessionId: string, directory?: string, serverId?: string): Promise<ApiSession> {
  return updateSession(sessionId, { time: { archived: 0 } }, directory, serverId)
}

/**
 * 获取单个 session
 */
export async function getSession(sessionId: string, directory?: string, serverId?: string): Promise<ApiSession> {
  const target = resolveSessionTarget(sessionId, serverId)
  // 首屏时 loadSession、SidePanel、元数据补齐会各取一次同一会话，
  // 合并同 key 在途请求。key 用与传输格式无关的目录键，
  // 避免 pathMode 在 auto 检测期间切换导致 key 失配。
  return singleFlight(`session:${target.serverId}:${target.sessionId}:${directoryCacheKey(directory)}`, async () => {
    const sdk = getSDKClient(target.serverId)
    return unwrap(
      await sdk.session.get({ sessionID: target.sessionId, directory: formatPathForApi(directory, target.serverId) }),
    )
  })
}

/**
 * 创建 session
 */
export async function createSession(
  params: {
    directory?: string
    title?: string
    parentID?: string
  } = {},
  serverId?: string,
): Promise<ApiSession> {
  const sdk = getSDKClient(serverId)
  const { directory, title, parentID } = params
  const session = unwrap(
    await sdk.session.create({
      directory: formatPathForApi(directory, serverId),
      title,
      parentID,
    }),
  )
  // 无显式 serverId 时按活动服务器失效，避免误伤其它服务器的列表缓存
  invalidateSessionListCache(serverId ?? serverStore.getActiveServerId())
  return session
}

/**
 * 更新 session
 */
export async function updateSession(
  sessionId: string,
  params: { title?: string; time?: { archived?: number } },
  directory?: string,
  serverId?: string,
): Promise<ApiSession> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  const session = unwrap(
    await sdk.session.update({
      sessionID: target.sessionId,
      directory: formatPathForApi(directory, target.serverId),
      ...params,
    }),
  )
  invalidateSessionListCache(target.serverId)
  return session
}

/**
 * 删除 session
 */
export async function deleteSession(sessionId: string, directory?: string, serverId?: string): Promise<boolean> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  unwrap(
    await sdk.session.delete({ sessionID: target.sessionId, directory: formatPathForApi(directory, target.serverId) }),
  )
  invalidateSessionListCache(target.serverId)
  return true
}

// ============================================
// Session Actions
// ============================================

/**
 * 中止 session
 */
export async function abortSession(sessionId: string, directory?: string, serverId?: string): Promise<boolean> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  unwrap(
    await sdk.session.abort({ sessionID: target.sessionId, directory: formatPathForApi(directory, target.serverId) }),
  )
  return true
}

/**
 * 回退消息
 */
export async function revertMessage(
  sessionId: string,
  messageId: string,
  partId?: string,
  directory?: string,
  serverId?: string,
): Promise<ApiSession> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return unwrap(
    await sdk.session.revert({
      sessionID: target.sessionId,
      directory: formatPathForApi(directory, target.serverId),
      messageID: messageId,
      partID: partId,
    }),
  )
}

/**
 * 恢复已回退的消息
 */
export async function unrevertSession(sessionId: string, directory?: string, serverId?: string): Promise<ApiSession> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return unwrap(
    await sdk.session.unrevert({
      sessionID: target.sessionId,
      directory: formatPathForApi(directory, target.serverId),
    }),
  )
}

/**
 * 分享 session
 */
export async function shareSession(sessionId: string, directory?: string, serverId?: string): Promise<ApiSession> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return unwrap(
    await sdk.session.share({ sessionID: target.sessionId, directory: formatPathForApi(directory, target.serverId) }),
  )
}

/**
 * 取消分享 session
 */
export async function unshareSession(sessionId: string, directory?: string, serverId?: string): Promise<ApiSession> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return unwrap(
    await sdk.session.unshare({ sessionID: target.sessionId, directory: formatPathForApi(directory, target.serverId) }),
  )
}

/**
 * Fork session
 */
export async function forkSession(
  sessionId: string,
  messageId?: string,
  directory?: string,
  serverId?: string,
): Promise<ApiSession> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return unwrap(
    await sdk.session.fork({
      sessionID: target.sessionId,
      directory: formatPathForApi(directory, target.serverId),
      messageID: messageId,
    }),
  )
}

/**
 * 总结 session
 */
export async function summarizeSession(
  sessionId: string,
  params: { providerID: string; modelID: string; auto?: boolean },
  directory?: string,
  serverId?: string,
): Promise<boolean> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  unwrap(
    await sdk.session.summarize({
      sessionID: target.sessionId,
      directory: formatPathForApi(directory, target.serverId),
      ...params,
    }),
  )
  return true
}

/**
 * 获取子 session
 */
export async function getSessionChildren(
  sessionId: string,
  directory?: string,
  serverId?: string,
): Promise<ApiSession[]> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return unwrap(
    await sdk.session.children({
      sessionID: target.sessionId,
      directory: formatPathForApi(directory, target.serverId),
    }),
  )
}

/**
 * Session Todo
 */
export type ApiTodo = TodoItem

/**
 * 获取 session 的 todo 列表
 * SDK 的 Todo 没有 id 字段，用 index+content+status 合成
 */
export async function getSessionTodos(sessionId: string, directory?: string, serverId?: string): Promise<ApiTodo[]> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  const todos = unwrap(
    await sdk.session.todo({ sessionID: target.sessionId, directory: formatPathForApi(directory, target.serverId) }),
  )
  return normalizeTodoItems(todos)
}
