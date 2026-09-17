// ============================================
// Session Key - 服务器作用域的会话标识
//
// 复合格式: `${serverId}::${sessionId}`
// pane / messageStore / childSessionStore 等内部一律使用复合 key，
// API 调用前通过 splitSessionKey 解析出 serverId。
// ============================================

import { serverStore } from '../store/serverStore'

const SEPARATOR = '::'

/**
 * 合成服务器作用域的会话 key
 */
export function makeSessionKey(serverId: string, sessionId: string): string {
  return `${serverId}${SEPARATOR}${sessionId}`
}

/**
 * 从复合 key 解析出 serverId 与原始 sessionId。
 * 不带 server 前缀的旧 key 视为活动服务器。
 *
 * 注意：空字符串不是「未分片」的旧 key。旧 key 里 sessionId 必定非空，
 * 因此空串一律视为畸变输入，按活动服务器 + 空 sessionId 返回，避免把
 * `''` 透传成下游的 sessionId（会被当成合法值参与 compare/Map key）。
 */
export function splitSessionKey(sessionKey: string): { serverId: string; sessionId: string } {
  const activeServerId = serverStore.getActiveServerId()
  if (!sessionKey) {
    return { serverId: activeServerId, sessionId: '' }
  }
  const idx = sessionKey.indexOf(SEPARATOR)
  if (idx === -1) {
    return { serverId: activeServerId, sessionId: sessionKey }
  }
  const serverId = sessionKey.slice(0, idx)
  // `::foo` 没有 server 段：旧数据或残缺 URL。不从空段生成的 serverId，
  // 按活动服务器处理；sessionId 保持空，交由调用方按参数非法拒绝，
  // 避免把 `::foo` 整串当作 sessionId 发给服务器。
  if (!serverId) {
    return { serverId: activeServerId, sessionId: '' }
  }
  return { serverId, sessionId: sessionKey.slice(idx + SEPARATOR.length) }
}

/**
 * 从复合 key 中提取 serverId
 */
export function sessionKeyToServerId(sessionKey: string): string {
  return splitSessionKey(sessionKey).serverId
}

/**
 * 从复合 key 中提取原始 sessionId
 */
export function sessionKeyToSessionId(sessionKey: string): string {
  return splitSessionKey(sessionKey).sessionId
}

/**
 * 解析 API 调用的目标：sessionId 可以是复合 key（serverId::sessionId）或原始 id。
 * 显式 serverId 优先；否则从复合 key 解析；两者都缺时用活动服务器。
 *
 * 注意：`::sessionId` 这种缺 server 段的畸形 key 会返回 sessionId 为空。
 * 调用方若拿到空 sessionId 应当视为参数非法（下游 SDK 会拒绝），
 * 而不是回填整串——回填会把 serverId 一并拼进 sessionID 发给服务器。
 */
export function resolveSessionTarget(sessionId: string, serverId?: string): { sessionId: string; serverId: string } {
  const parsed = splitSessionKey(sessionId)
  return { sessionId: parsed.sessionId, serverId: serverId ?? parsed.serverId }
}
