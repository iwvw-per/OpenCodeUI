// ============================================
// Message Sanitization - 剥离渲染不读取的重负载字段
//
// OpenCode 的 message/session 快照会携带体积巨大的 diff 全文：
//   - `info.summary.diffs[].patch`：整轮 patch 文本，实测单页 50 条中占 163KB
//     （未压缩响应 396KB 的 41%，gzip 后仍占 85KB）
//   - `session.summary.diffs` / `session.revert.snapshot|diff`：详情专用字段
//
// 这些字段没有任何渲染路径读取：
//   - 消息流渲染只读 text / reasoning / tool.state.output / file.url
//   - 「本轮变更」视图走 getLastTurnDiff，它单独以 project:false 拉完整数据
//   - revert 状态只需 messageID/partID 标记
//
// 因此统一在「数据进入 store 的每个入口」剥掉，避免它们随 SSE 事件反复
// 进入内存并参与不可变拷贝。注意 `tool.state.metadata.diff` / `.filediff.patch`
// 是工具卡片的 diff 视图数据源，必须保留，不在此处剥离。
// ============================================

import type { ApiMessage, ApiMessageWithParts, ApiSession } from './types'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 剥离 message.info.summary.diffs（保留 title/body）。
 * 返回原引用表示未变化，便于调用方保持引用稳定。
 */
export function stripMessageSummaryDiffs(info: ApiMessage): ApiMessage {
  const summary = (info as { summary?: unknown }).summary
  if (!isRecord(summary) || !('diffs' in summary)) return info
  const { diffs: _diffs, ...rest } = summary
  return { ...info, summary: rest } as ApiMessage
}

/**
 * 剥离 tool part 的 state.attachments（多为 data:image base64，单条可达 1MB）。
 * 没有任何渲染路径读取 state.attachments。
 */
export function stripPartAttachments(part: ApiMessageWithParts['parts'][number]): ApiMessageWithParts['parts'][number] {
  if (part.type !== 'tool') return part
  const state = (part as { state?: unknown }).state
  if (!isRecord(state)) return part
  const attachments = state.attachments
  if (!Array.isArray(attachments) || attachments.length === 0) return part
  const { attachments: _attachments, ...restState } = state
  return { ...part, state: restState } as typeof part
}

/**
 * 单条工具输出的字符上限。`tool.state.output` 可能是整个大文件的 cat 结果或
 * 数万行命令日志，是消息流常驻内存的主要来源。超过上限时保留首尾、省略中间，
 * 正常输出不受影响，病态输出也不会把 JS 堆撑大。
 *
 * HEAD + TAIL 必须明显小于 MAX：截断结果还要加一段省略标记，若两者之和等于
 * MAX，结果长度会超过 MAX 从而被再次截断（幂等性被破坏）。
 */
export const MAX_TOOL_OUTPUT_CHARS = 256 * 1024
const TOOL_OUTPUT_HEAD_CHARS = 120 * 1024
const TOOL_OUTPUT_TAIL_CHARS = 120 * 1024
const TOOL_OUTPUT_TRUNCATION_MARKER = 'characters truncated to limit memory'

function truncateLongString(value: string): string {
  if (value.length <= MAX_TOOL_OUTPUT_CHARS) return value
  // 已经截断过的串直接返回，保证幂等（重复投影不会反复改写标记）
  if (value.includes(TOOL_OUTPUT_TRUNCATION_MARKER)) return value
  const omitted = value.length - TOOL_OUTPUT_HEAD_CHARS - TOOL_OUTPUT_TAIL_CHARS
  return `${value.slice(0, TOOL_OUTPUT_HEAD_CHARS)}\n\n... [${omitted.toLocaleString('en-US')} ${TOOL_OUTPUT_TRUNCATION_MARKER}] ...\n\n${value.slice(value.length - TOOL_OUTPUT_TAIL_CHARS)}`
}

/**
 * 截断 tool.state.output 与运行态 metadata.output 的超长内容。
 * 返回原引用表示未变化。
 */
export function truncatePartOutput(part: ApiMessageWithParts['parts'][number]): ApiMessageWithParts['parts'][number] {
  if (part.type !== 'tool') return part
  const state = (part as { state?: unknown }).state
  if (!isRecord(state)) return part

  let nextState: UnknownRecord | null = null

  const output = state.output
  if (typeof output === 'string') {
    const truncated = truncateLongString(output)
    if (truncated !== output) {
      nextState = { ...state, output: truncated }
    }
  }

  const metadata = state.metadata
  if (isRecord(metadata) && typeof metadata.output === 'string') {
    const truncated = truncateLongString(metadata.output)
    if (truncated !== metadata.output) {
      nextState = { ...(nextState ?? state), metadata: { ...metadata, output: truncated } }
    }
  }

  if (!nextState) return part
  return { ...part, state: nextState } as typeof part
}

/**
 * SSE 与分页拉取共用的单 part 裁剪入口：剥离附件 + 截断超长输出。
 */
export function sanitizeStreamPart(part: ApiMessageWithParts['parts'][number]): ApiMessageWithParts['parts'][number] {
  return truncatePartOutput(stripPartAttachments(part))
}

/**
 * 把一条「消息 + parts」裁剪成渲染足够、体积最小的投影。
 *
 * 对 SSE 事件与分页拉取共用，保证两条路径进入 store 的数据形态一致。
 */
export function sanitizeMessageWithParts(message: ApiMessageWithParts): ApiMessageWithParts {
  const info = stripMessageSummaryDiffs(message.info)
  let parts = message.parts
  let partsChanged = false

  for (let index = 0; index < parts.length; index += 1) {
    const next = sanitizeStreamPart(parts[index])
    if (next === parts[index]) continue
    if (!partsChanged) parts = parts.slice()
    parts[index] = next
    partsChanged = true
  }

  if (info === message.info && !partsChanged) return message
  return { ...message, info, parts }
}

/**
 * 剥离 session.summary.diffs 与 session.revert 的大字段。
 *
 * session 列表与 SSE session.updated 都会携带整轮 patch 全文；
 * 列表只需要 revert 的 messageID/partID 标记来判定「已回退」。
 */
export function stripSessionDiffSnapshots(session: ApiSession): ApiSession {
  let next = session
  let changed = false

  const revert = (session as { revert?: unknown }).revert
  if (isRecord(revert) && (typeof revert.snapshot === 'string' || typeof revert.diff === 'string')) {
    const { snapshot: _snapshot, diff: _diff, ...restRevert } = revert
    next = { ...next, revert: restRevert } as ApiSession
    changed = true
  }

  const summary = (next as { summary?: unknown }).summary
  if (isRecord(summary) && 'diffs' in summary) {
    const { diffs: _diffs, ...restSummary } = summary
    next = { ...next, summary: restSummary } as ApiSession
    changed = true
  }

  return changed ? next : session
}

/**
 * 会话列表专用：只保留 revert 的定位标记，丢掉其余详情。
 * 列表渲染不需要 summary.diffs / permission 等详情字段。
 */
export function stripSessionListDetails(session: ApiSession): ApiSession {
  const record = session as ApiSession & { revert?: unknown; permission?: unknown; summary?: unknown }
  const hasRevertDetails = isRecord(record.revert)
    ? Object.keys(record.revert).some(key => key !== 'messageID' && key !== 'partID')
    : record.revert !== undefined
  const hasSummaryDiffs = isRecord(record.summary) && Array.isArray(record.summary.diffs)
  if (!hasRevertDetails && !hasSummaryDiffs && !('permission' in record)) return session

  const stripped = stripSessionDiffSnapshots(session) as typeof record
  const next: UnknownRecord = { ...stripped }
  delete next.permission

  if (isRecord(next.revert)) {
    const marker: UnknownRecord = {}
    if (typeof next.revert.messageID === 'string') marker.messageID = next.revert.messageID
    if (typeof next.revert.partID === 'string') marker.partID = next.revert.partID
    if (Object.keys(marker).length > 0) next.revert = marker
    else delete next.revert
  }

  if (isRecord(next.summary)) {
    const { diffs: _diffs, ...restSummary } = next.summary
    next.summary = restSummary
  }

  return next as unknown as ApiSession
}
