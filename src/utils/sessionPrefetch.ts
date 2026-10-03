// ============================================
// sessionPrefetch - 会话首页消息的后台预取
//
// 切换会话时 ChatPane 会等 getSessionMessagePage 返回、loadState 变 loaded
// 才挂载 ChatArea，期间只有全屏 loading。侧栏 hover 时提前把首页消息拉进
// messageStore，点击时命中缓存即可首帧出内容。
//
// 约束：
// - 只预取「未被加载过」的会话，已 loaded / stale 的交给正常加载路径，避免覆盖。
// - 同一会话并发只发一次；完成后按 TTL 去重，短时间内重复 hover 不重复请求。
// - 结果只写入 messageStore，不触发滚动 / onLoadComplete 等交互副作用。
// ============================================

import { getSession, getSessionTurnPage } from '../api'
import { messageStore } from '../store/messageStore'
import { makeSessionKey } from './sessionKey'
import { INITIAL_TURN_LIMIT } from '../constants/pagination'

/** 同一会话预取结果保留时长：期间再次 hover 不重复请求 */
const PREFETCH_TTL_MS = 30_000

const inflight = new Map<string, Promise<void>>()
const lastFetchedAt = new Map<string, number>()

function shouldPrefetch(sessionKey: string): boolean {
  const state = messageStore.getSessionState(sessionKey)
  // 已有内容或已定稿加载过，不再预取（正常路径会决定是否刷新）
  if (state && (state.messages.length > 0 || state.loadState === 'loaded')) return false
  if (inflight.has(sessionKey)) return false
  const at = lastFetchedAt.get(sessionKey)
  if (at != null && Date.now() - at < PREFETCH_TTL_MS) return false
  return true
}

/**
 * 预取某会话首页消息。失败静默（正常加载路径会兜底并报错）。
 * @param sessionId 原始 session id
 * @param directory 会话目录
 * @param serverId 服务器 id
 */
export function prefetchSessionMessages(sessionId: string, directory?: string, serverId?: string): void {
  if (!sessionId) return
  const sessionKey = makeSessionKey(serverId ?? '', sessionId)
  if (!shouldPrefetch(sessionKey)) return

  const request = (async () => {
    const [sessionInfo, page] = await Promise.all([
      getSession(sessionId, directory, serverId).catch(() => null),
      getSessionTurnPage(sessionId, INITIAL_TURN_LIMIT, undefined, directory, serverId),
    ])

    // 请求期间该会话可能已被正常加载（或已开始流式），不覆盖
    const current = messageStore.getSessionState(sessionKey)
    if (current && (current.messages.length > 0 || current.loadState === 'loaded' || current.isStreaming)) return

    messageStore.setMessages(sessionKey, page.messages, {
      directory: sessionInfo?.directory ?? directory ?? '',
      title: sessionInfo?.title,
      hasMoreHistory: page.hasMore,
      historyCursor: page.nextCursor,
      revertState: sessionInfo?.revert ?? null,
      shareUrl: sessionInfo?.share?.url,
    })
  })()
    .catch(() => {
      // 预取失败静默
    })
    .finally(() => {
      inflight.delete(sessionKey)
      lastFetchedAt.set(sessionKey, Date.now())
    })

  inflight.set(sessionKey, request)
}

/** 测试用：清空预取登记 */
export function resetSessionPrefetch(): void {
  inflight.clear()
  lastFetchedAt.clear()
}
