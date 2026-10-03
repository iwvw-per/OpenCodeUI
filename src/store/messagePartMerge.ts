// ============================================
// messagePartMerge — 流式 part 合并的纯函数
// ============================================
//
// 从 messageStore 抽出的无副作用逻辑：流式文本在「本地 live」与「服务端快照」
// 之间如何取舍。这是最容易出 bug 的一段（重复文本、回退、分叉），独立成模块
// 后可以被直接单测，而不必经由整个 store。

import type { Part } from '../types/message'

/** 从复合 key 提取 serverId（`${serverId}::${sessionId}`）；无分隔符时归为空串 */
export function serverIdOfSessionKey(sessionId: string): string {
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
export function rawSessionIdOfKey(sessionId: string): string {
  const idx = sessionId.indexOf('::')
  return idx === -1 ? sessionId : sessionId.slice(idx + 2)
}

/**
 * 同步合并文本：live 更长且与服务端兼容（服务端是前缀）时不回退；
 * 服务端更长则跟上；分叉时以服务端为准。
 */
export function preferCompatibleText(local: string, incoming: string): string {
  if (local === incoming) return incoming
  if (local.startsWith(incoming)) return local
  if (incoming.startsWith(local)) return incoming
  return incoming
}

export function partHasText(part: Part): part is Part & { text: string } {
  return 'text' in part && typeof (part as { text?: unknown }).text === 'string'
}

export function mergePartPreferLiveText(local: Part | undefined, incoming: Part): Part {
  if (!local || local.id !== incoming.id) return incoming
  if (!partHasText(local) || !partHasText(incoming)) return incoming
  const text = preferCompatibleText(local.text, incoming.text)
  if (text === incoming.text) return incoming
  return { ...incoming, text } as Part
}

export function mergePartsPreferLiveText(localParts: Part[], incomingParts: Part[]): Part[] {
  if (localParts.length === 0) return incomingParts
  const localById = new Map(localParts.map(part => [part.id, part]))
  return incomingParts.map(part => mergePartPreferLiveText(localById.get(part.id), part))
}

export interface IncompleteMessageLike {
  isStreaming?: boolean
  info: { time?: { completed?: number } }
}

export function messageIsIncomplete(message: IncompleteMessageLike): boolean {
  if (message.isStreaming) return true
  const completed = message.info.time && 'completed' in message.info.time ? message.info.time.completed : undefined
  return completed == null
}

/**
 * 仅未定稿时保护更长 live；incoming/本地已 completed 则强制服务端，不再 preserve。
 */
export function shouldPreserveLiveParts(
  previous: IncompleteMessageLike,
  incoming?: IncompleteMessageLike,
): boolean {
  if (incoming && !messageIsIncomplete(incoming)) return false
  return messageIsIncomplete(previous)
}

/** 服务端 canonical part 的 id 以 `prt` 开头；乐观本地占位 part 不是。 */
export function isServerPartId(id: string): boolean {
  return id.startsWith('prt')
}
