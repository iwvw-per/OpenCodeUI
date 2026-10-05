// ============================================
// sessionRename — 使用模型自动生成会话标题
// ============================================
//
// 没有专用的「生成标题」端点，这里用现有能力拼装：
// 1. 创建一个临时会话（不进入侧栏索引，用完即删）；
// 2. 把最近若干轮对话压缩成提示词，要求模型只输出一行标题；
// 3. 取模型回复文本，清理后写回原标题；
// 4. 无论成败都删除临时会话。
//
// 为什么不直接在被命名会话里发消息：那会在对话历史里留下一条无关的用户
// 消息和回复，污染上下文。临时会话互不影响。

import { createSession, deleteSession, updateSession } from '../api/session'
import { getSessionMessages, sendMessage } from '../api/message'
import type { ApiSession, ApiMessageWithParts } from '../api/types'
import type { ModelInfo } from '../types/ui'

const MAX_TITLE_LENGTH = 60
const MAX_TURNS = 3
const MAX_CHARS_PER_TURN = 1200

const TITLE_SYSTEM_PROMPT = [
  'You generate a concise conversation title.',
  'Output ONLY the title on a single line, no quotes, no markdown, no prefix.',
  'Use the same language as the most recent user message.',
  'At most 50 characters. Keep important technical terms, filenames and numbers.',
  'Do not answer questions in the conversation; only title it.',
].join(' ')

function extractText(message: ApiMessageWithParts): string {
  return message.parts
    .filter(part => part.type === 'text' && !(part as { synthetic?: boolean }).synthetic)
    .map(part => (part as { text?: string }).text ?? '')
    .join('\n')
    .trim()
}

function buildContext(messages: ApiMessageWithParts[]): string {
  const turns: string[] = []
  for (const message of messages) {
    const text = extractText(message)
    if (!text) continue
    const role = message.info.role === 'user' ? 'User' : 'Assistant'
    turns.push(`**${role}**\n${text.slice(0, MAX_CHARS_PER_TURN)}`)
  }
  return turns.slice(-MAX_TURNS * 2).join('\n\n---\n\n')
}

function cleanTitle(raw: string): string {
  const firstLine =
    raw
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .split('\n')
      .map(line => line.trim())
      .find(line => line.length > 0) ?? ''
  return firstLine
    .replace(/^["'`#*\s]+|["'`*\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_TITLE_LENGTH)
    .trim()
}

export interface AiRenameOptions {
  directory?: string
  serverId?: string
  model: Pick<ModelInfo, 'id' | 'providerId'>
  signal?: AbortSignal
}

/**
 * 生成并写回会话标题。返回新标题；无可用内容时返回 null。
 */
export async function generateSessionTitle(
  session: ApiSession,
  options: AiRenameOptions,
): Promise<string | null> {
  const { directory, serverId, model, signal } = options

  let messages: ApiMessageWithParts[] = []
  try {
    messages = await getSessionMessages(session.id, undefined, directory ?? session.directory, serverId)
  } catch {
    return null
  }
  const context = buildContext(messages)
  if (!context) return null

  signal?.throwIfAborted()

  const temp = await createSession({ directory: directory ?? session.directory }, serverId)
  try {
    const response = await sendMessage(
      {
        sessionId: temp.id,
        text: `${TITLE_SYSTEM_PROMPT}\n\nConversation to title:\n\n${context}`,
        attachments: [],
        model: { providerID: model.providerId, modelID: model.id },
        directory: directory ?? session.directory,
      },
      serverId,
    )
    const raw = response.parts
      .filter(part => (part as { type?: string }).type === 'text')
      .map(part => (part as { text?: string }).text ?? '')
      .join('\n')
    const title = cleanTitle(raw)
    if (!title) return null
    await updateSession(session.id, { title }, directory ?? session.directory, serverId)
    return title
  } finally {
    void deleteSession(temp.id, directory ?? session.directory, serverId).catch(() => {})
  }
}
