// ============================================
// 从工具调用结果聚合「本轮变更文件」
//
// 官方 turn 模式的变更列表来自服务端写入的 `user message.summary.diffs`。
// 该字段依赖服务端 snapshot 配置与版本，缺失时面板会显示「本轮无变更」，
// 而消息流里的工具卡片仍能显示改动（数据源是 tool.state.metadata）。
//
// 本模块从工具 part 的 metadata 聚合出 FileDiff[]，作为 summary.diffs 为空时
// 的回退数据源，保证「有工具改动就一定能在变更面板看到」。
//
// 刻意保持纯函数、不引入 React / 渲染器依赖，便于单测与复用。
// ============================================

import { diffLines } from 'diff'
import { extractContentFromUnifiedDiff } from '../../../utils/diffUtils'
import type { FileDiff } from '../../../api/types'
import type { ToolPart } from '../../../types/message'

type UnknownRecord = Record<string, unknown>

/** 结构化的消息形态：UI 的 Message 与 API 的 MessageWithParts 都满足 */
export interface TurnDiffMessage {
  info: { role: string }
  parts: readonly unknown[]
}

function isToolPart(part: unknown): part is ToolPart {
  return isRecord(part) && part.type === 'tool' && 'state' in part
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function countLines(before: string, after: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const change of diffLines(before, after)) {
    if (change.added) additions += change.count || 0
    if (change.removed) deletions += change.count || 0
  }
  return { additions, deletions }
}

/** 把统一 diff 字符串转成 before/after（失败时返回 undefined） */
function pairFromUnified(diff: string): { before: string; after: string } | undefined {
  const pair = extractContentFromUnifiedDiff(diff)
  return pair.before || pair.after ? pair : undefined
}

interface PendingFile {
  file: string
  patch?: string
  before?: string
  after?: string
  additions?: number
  deletions?: number
}

/** 从单个工具 part 的 metadata 解析出改动的文件条目 */
function filesFromToolPart(part: ToolPart): PendingFile[] {
  const state = part.state as { status?: string; metadata?: unknown; title?: string }
  if (state.status === 'error') return []
  const metadata = isRecord(state.metadata) ? state.metadata : undefined
  if (!metadata) return []

  const result: PendingFile[] = []

  const metadataFiles = metadata.files
  if (Array.isArray(metadataFiles)) {
    for (const entry of metadataFiles) {
      if (!isRecord(entry)) continue
      const file = (entry.filePath ?? entry.file) as string | undefined
      if (typeof file !== 'string' || !file) continue
      const diff = typeof entry.diff === 'string' ? entry.diff : undefined
      const patch = typeof entry.patch === 'string' ? entry.patch : undefined
      const before = typeof entry.before === 'string' ? entry.before : undefined
      const after = typeof entry.after === 'string' ? entry.after : undefined
      result.push({
        file,
        patch: patch ?? diff,
        before,
        after,
        additions: typeof entry.additions === 'number' ? entry.additions : undefined,
        deletions: typeof entry.deletions === 'number' ? entry.deletions : undefined,
      })
    }
    if (result.length > 0) return result
  }

  const input = isRecord(part.state.input) ? part.state.input : undefined
  const filePath =
    (typeof metadata.filepath === 'string' && metadata.filepath) ||
    (typeof input?.filePath === 'string' && input.filePath) ||
    undefined

  if (typeof metadata.diff === 'string') {
    result.push({
      file: filePath || state.title || part.tool,
      patch: metadata.diff,
      ...statsFromFilediff(metadata.filediff),
    })
    return result
  }

  if (isRecord(metadata.filediff)) {
    const fd = metadata.filediff
    const patch = typeof fd.patch === 'string' ? fd.patch : undefined
    const before = typeof fd.before === 'string' ? fd.before : undefined
    const after = typeof fd.after === 'string' ? fd.after : undefined
    if (patch || before !== undefined || after !== undefined) {
      result.push({
        file: filePath || state.title || part.tool,
        patch,
        before,
        after,
        ...statsFromFilediff(fd),
      })
    }
  }

  return result
}

function statsFromFilediff(filediff: unknown): { additions?: number; deletions?: number } {
  if (!isRecord(filediff)) return {}
  return {
    additions: typeof filediff.additions === 'number' ? filediff.additions : undefined,
    deletions: typeof filediff.deletions === 'number' ? filediff.deletions : undefined,
  }
}

/** 取最近一轮（最后一条 user 消息起）的工具 part */
function toolPartsSinceLastUserMessage(messages: readonly TurnDiffMessage[]): ToolPart[] {
  let start = 0
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].info.role === 'user') {
      start = i
      break
    }
  }

  const parts: ToolPart[] = []
  for (let i = start; i < messages.length; i += 1) {
    for (const part of messages[i].parts) {
      if (isToolPart(part)) parts.push(part)
    }
  }
  return parts
}

/**
 * 从最近一轮的工具调用聚合变更文件。同一文件多次改动合并为一条，
 * 增删行数取合计，diff 预览优先用最后一次的 patch / before-after。
 */
export function collectTurnDiffsFromMessages(messages: readonly TurnDiffMessage[]): FileDiff[] {
  const byFile = new Map<string, FileDiff>()

  for (const part of toolPartsSinceLastUserMessage(messages)) {
    for (const entry of filesFromToolPart(part)) {
      const existing = byFile.get(entry.file)
      const patch = entry.patch
      const before = entry.before
      const after = entry.after
      const stats =
        entry.additions !== undefined || entry.deletions !== undefined
          ? { additions: entry.additions ?? 0, deletions: entry.deletions ?? 0 }
          : patch
            ? (() => {
                const pair = pairFromUnified(patch)
                return pair ? countLines(pair.before, pair.after) : { additions: 0, deletions: 0 }
              })()
            : before !== undefined && after !== undefined
              ? countLines(before, after)
              : { additions: 0, deletions: 0 }

      if (existing) {
        existing.additions += stats.additions
        existing.deletions += stats.deletions
        // 用最新一次改动覆盖预览内容
        if (patch) {
          existing.patch = patch
          existing.before = undefined
          existing.after = undefined
        } else if (before !== undefined && after !== undefined) {
          existing.patch = undefined
          existing.before = before
          existing.after = after
        }
        continue
      }

      byFile.set(entry.file, {
        file: entry.file,
        patch,
        before: patch ? undefined : before,
        after: patch ? undefined : after,
        additions: stats.additions,
        deletions: stats.deletions,
      })
    }
  }

  return [...byFile.values()]
}
