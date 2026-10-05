// ============================================
// sessionExport — 会话导出为 Markdown
// ============================================
//
// 从服务端拉取完整消息（含子会话递归），拼装为可读的 Markdown 文档。
// 用于「导出 Markdown」右键动作：保存重要对话、分享给他人、归档。
//
// 设计取舍：
// - 只导出对话主体（user / assistant 文本、思考、工具调用摘要），不导出
//   内部 UI 状态（revert、压缩标记等）。
// - 工具输出可能极大，默认截断到 MAX_TOOL_OUTPUT，避免导出文件动辄数 MB。
// - 子会话以二级标题分节追加，标注父子关系。

import { getSessionChildren } from '../api/session'
import { getSessionMessages } from '../api/message'
import type { ApiMessageWithParts, ApiSession } from '../api/types'
import { saveData } from './downloadUtils'

/** 单个工具输出在导出中保留的最大字符数 */
const MAX_TOOL_OUTPUT = 4000
/** 单个文本/思考 part 保留的最大字符数 */
const MAX_TEXT_PART = 20000
/** 递归导出的最大子会话深度，防止异常数据下的无限递归 */
const MAX_CHILD_DEPTH = 5

interface ExportOptions {
  directory?: string
  serverId?: string
  /** 是否递归导出子会话，默认 true */
  includeChildren?: boolean
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n\n... (truncated ${text.length - max} chars)`
}

function formatTime(ms: number | undefined): string {
  if (!ms) return ''
  try {
    return new Date(ms).toISOString()
  } catch {
    return ''
  }
}

function sanitizeFileName(name: string): string {
  const cleaned = Array.from(name)
    .map(ch => (ch.charCodeAt(0) < 0x20 || '<>:"/\\|?*'.includes(ch) ? '_' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'session'
}

/** 提取消息中的纯文本，用于标题兜底 */
function messageText(message: ApiMessageWithParts): string {
  return message.parts
    .filter(part => part.type === 'text' && !(part as { synthetic?: boolean }).synthetic)
    .map(part => (part as { text?: string }).text ?? '')
    .join('\n')
    .trim()
}

function renderParts(message: ApiMessageWithParts, lines: string[]): void {
  for (const part of message.parts) {
    const record = part as Record<string, unknown>
    const type = record.type as string

    if (type === 'text') {
      const text = String(record.text ?? '')
      if (!text.trim()) continue
      if (record.synthetic) {
        lines.push('<details><summary>context</summary>', '', truncate(text, MAX_TEXT_PART), '', '</details>', '')
      } else {
        lines.push(truncate(text, MAX_TEXT_PART), '')
      }
    } else if (type === 'reasoning') {
      const text = String(record.text ?? '')
      if (!text.trim()) continue
      lines.push('<details><summary>reasoning</summary>', '', truncate(text, MAX_TEXT_PART), '', '</details>', '')
    } else if (type === 'tool') {
      const state = (record.state ?? {}) as Record<string, unknown>
      const toolName = String(record.tool ?? 'tool')
      const status = String(state.status ?? '')
      const input = state.input ? JSON.stringify(state.input, null, 2) : ''
      const output = typeof state.output === 'string' ? state.output : ''
      const error = typeof state.error === 'string' ? state.error : ''
      lines.push(`**Tool: ${toolName}** (${status})`, '')
      if (input) lines.push('```json', truncate(input, MAX_TOOL_OUTPUT), '```', '')
      if (output) lines.push('```', truncate(output, MAX_TOOL_OUTPUT), '```', '')
      if (error) lines.push('```', truncate(error, MAX_TOOL_OUTPUT), '```', '')
    } else if (type === 'file') {
      const filename = String(record.filename ?? record.url ?? 'file')
      lines.push(`> Attachment: ${filename}`, '')
    }
  }
}

async function renderSession(
  session: ApiSession,
  options: ExportOptions,
  depth: number,
  lines: string[],
): Promise<void> {
  const heading = depth === 0 ? '#' : '#'.repeat(Math.min(depth + 1, 6))
  const title = session.title?.trim() || session.id.slice(0, 12)
  lines.push(`${heading} ${title}`, '')
  lines.push(`- Session ID: \`${session.id}\``)
  if (session.directory) lines.push(`- Directory: \`${session.directory}\``)
  const created = formatTime(session.time?.created)
  const updated = formatTime(session.time?.updated)
  if (created) lines.push(`- Created: ${created}`)
  if (updated) lines.push(`- Updated: ${updated}`)
  lines.push('')

  let messages: ApiMessageWithParts[] = []
  try {
    messages = await getSessionMessages(session.id, undefined, options.directory ?? session.directory, options.serverId)
  } catch {
    lines.push('> (failed to load messages)', '')
  }

  for (const message of messages) {
    const role = message.info.role === 'user' ? 'User' : 'Assistant'
    lines.push(`### ${role}`, '')
    renderParts(message, lines)
  }

  if (options.includeChildren !== false && depth < MAX_CHILD_DEPTH) {
    let children: ApiSession[] = []
    try {
      children = await getSessionChildren(session.id, options.directory ?? session.directory, options.serverId)
    } catch {
      children = []
    }
    for (const child of children) {
      lines.push('---', '')
      await renderSession(child, options, depth + 1, lines)
    }
  }
}

/** 生成会话 Markdown 文本（不含写盘） */
export async function buildSessionMarkdown(session: ApiSession, options: ExportOptions = {}): Promise<string> {
  const lines: string[] = []
  await renderSession(session, options, 0, lines)
  return lines.join('\n').replace(/\n{3,}/g, '\n\n')
}

/** 导出会话为 Markdown 文件并触发保存 */
export async function exportSessionAsMarkdown(session: ApiSession, options: ExportOptions = {}): Promise<void> {
  const markdown = await buildSessionMarkdown(session, options)
  const title = session.title?.trim() || session.id.slice(0, 12)
  const fileName = `${sanitizeFileName(title)}.md`
  saveData(new TextEncoder().encode(markdown), fileName, 'text/markdown;charset=utf-8')
}

/** 由会话标题与首条用户消息生成文件名，供导出图片等场景复用 */
export function sessionExportFileName(session: ApiSession): string {
  return sanitizeFileName(session.title?.trim() || session.id.slice(0, 12))
}

export { messageText }
