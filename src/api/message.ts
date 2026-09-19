// ============================================
// Message API Functions
// 基于 @opencode-ai/sdk: /session/{sessionID}/message 相关接口
// ============================================

import { getSDKClient, unwrap } from './sdk'
import { resolveSessionTarget } from '../utils/sessionKey'
import { formatPathForApi } from '../utils/directoryUtils'
import type {
  ApiMessageWithParts,
  AgentPartInput,
  ApiAgentPart,
  ApiTextPart,
  ApiFilePart,
  Attachment,
  FilePartInput,
  RevertedMessage,
  SendMessageParams,
  SendMessageResponse,
  TextPartInput,
} from './types'

/** 判定是否为「传输层把响应体截断」导致的解析失败：
 * 大响应在 Tauri-plugin-http 上有 340KB 级截断的抖动，会抛未闭合字符串的 JSON 解析错误。
 * 这类错误是瞬态的，重试同一请求即可恢复。 */
function isTruncatedJsonError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return msg.includes('Unterminated string in JSON') || msg.includes('Unexpected end of JSON input')
}

/**
 * 大体积响应可能被传输层截断，做有限次重试。
 * 仅对「截断型」失败生效，其它错误立即抛出。
 */
async function getWithTruncationRetry<T>(fn: () => Promise<T>, retries = 3, delay = 400): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (!isTruncatedJsonError(error)) throw error
      if (import.meta.env.DEV) console.warn(`[Message] Truncated response, retry ${attempt + 1}/${retries}`)
      if (attempt < retries - 1) await new Promise(resolve => setTimeout(resolve, delay * (attempt + 1)))
    }
  }
  throw lastError
}

type PromptParams = Parameters<ReturnType<typeof getSDKClient>['session']['prompt']>[0]
type UserContentSource = {
  parts: Array<
    | ApiTextPart
    | ApiFilePart
    | ApiAgentPart
    | {
        type: string
      }
  >
}

function isTextUserContentPart(part: UserContentSource['parts'][number]): part is ApiTextPart {
  return part.type === 'text' && 'text' in part
}

function isFileUserContentPart(part: UserContentSource['parts'][number]): part is ApiFilePart {
  return part.type === 'file' && 'mime' in part && 'url' in part
}

function isAgentUserContentPart(part: UserContentSource['parts'][number]): part is ApiAgentPart {
  return part.type === 'agent' && 'name' in part
}

// ============================================
// Message Query
// ============================================

export interface SessionMessagePage {
  /** 本页消息，按时间升序 */
  messages: ApiMessageWithParts[]
  /** 继续向前翻页的游标（服务端 X-Next-Cursor）；缺省表示没有更早的消息 */
  nextCursor?: string
}

/**
 * 把一页消息裁剪成「渲染足够、体积最小」的投影。
 *
 * 只裁掉消息流渲染从不读取、却最占体积的字段：
 * - `info.summary.diffs`：整轮 patch 全文，单条可达 860KB。
 *   只有「本轮变更」视图用（getLastTurnDiff），它单独以 project:false 拉取完整数据。
 * - `tool.state.attachments`：工具结果里的内联附件（多为 data:image base64），
 *   单条可达 1MB，且没有任何渲染路径读取 state.attachments。
 *
 * 消息流真正会渲染的字段（tool.state.output/error、text、reasoning、file.url 等）
 * 一律原样保留，因此裁剪后 UI 无需回源即可完整显示。
 */
function projectMessageForStream(message: ApiMessageWithParts): ApiMessageWithParts {
  let info = message.info
  let parts = message.parts
  let changed = false

  const summary = (info as { summary?: { diffs?: unknown } }).summary
  if (summary?.diffs) {
    // 保留 title/body（大纲与标题仍需要），只去掉 diffs
    const { diffs: _diffs, ...restSummary } = summary
    info = { ...info, summary: restSummary } as ApiMessageWithParts['info']
    changed = true
  }

  const hasToolAttachments = parts.some(part => {
    const attachments = (part as { state?: { attachments?: unknown[] } }).state?.attachments
    return part.type === 'tool' && Array.isArray(attachments) && attachments.length > 0
  })
  if (hasToolAttachments) {
    parts = parts.map(part => {
      if (part.type !== 'tool') return part
      const state = (part as { state?: { attachments?: unknown[] } }).state
      if (!state?.attachments?.length) return part
      const { attachments: _attachments, ...restState } = state
      return { ...part, state: restState } as typeof part
    })
    changed = true
  }

  return changed ? { ...message, info, parts } : message
}

function projectPageMessages(messages: ApiMessageWithParts[]): ApiMessageWithParts[] {
  return messages.map(projectMessageForStream)
}

/**
 * 按游标分页获取 session 消息。
 *
 * 服务端 `limit` 语义是「最新 N 条」，不带 before 时每次只能拿到末尾一段。
 * 传 before（上一页最老一条的游标）时只返回该游标之前的 limit 条，
 * 因此上滑加载的传输量是 O(N) 而不是「limit 累加后重拉」的 O(N²)。
 *
 * `project` 默认开启，裁掉消息流不渲染的重负载字段（见 projectMessageForStream）。
 * 需要完整数据（如变更视图的 turn diff）时传 project:false。
 */
export async function getSessionMessagePage(
  sessionId: string,
  limit?: number,
  before?: string,
  directory?: string,
  serverId?: string,
  options?: { project?: boolean },
): Promise<SessionMessagePage> {
  const target = resolveSessionTarget(sessionId, serverId)
  const project = options?.project ?? true
  return getWithTruncationRetry(async () => {
    const sdk = getSDKClient(target.serverId)
    const result = await sdk.session.messages({
      sessionID: target.sessionId,
      directory: formatPathForApi(directory, target.serverId),
      limit,
      before,
    })
    const messages = unwrap<ApiMessageWithParts[]>(result)
    const nextCursor = result.response?.headers?.get('X-Next-Cursor') ?? undefined
    return {
      messages: project ? projectPageMessages(messages) : messages,
      nextCursor: nextCursor || undefined,
    }
  })
}

/**
 * 获取 session 的消息列表（只取一页，忽略游标）
 */
export async function getSessionMessages(
  sessionId: string,
  limit?: number,
  directory?: string,
  serverId?: string,
  options?: { project?: boolean },
): Promise<ApiMessageWithParts[]> {
  const page = await getSessionMessagePage(sessionId, limit, undefined, directory, serverId, options)
  return page.messages
}

// ============================================
// Message Content Extraction
// ============================================

/**
 * 从 API 消息中提取用户消息内容（文本+附件）
 */
export function extractUserMessageContent(message: UserContentSource): RevertedMessage {
  const { parts } = message

  const textParts = parts.filter((part): part is ApiTextPart => isTextUserContentPart(part) && !part.synthetic)
  const text = textParts.map(p => p.text).join('\n')

  const attachments: Attachment[] = []

  const getSourcePath = (source: ApiFilePart['source']): string | undefined => {
    if (!source || !('path' in source)) return undefined
    return source.path
  }

  for (const part of parts) {
    if (isFileUserContentPart(part)) {
      const isFolder = part.mime === 'application/x-directory'
      const sourcePath = getSourcePath(part.source)
      attachments.push({
        id: part.id || crypto.randomUUID(),
        type: isFolder ? 'folder' : 'file',
        displayName: part.filename || sourcePath || 'file',
        url: part.url,
        mime: part.mime,
        relativePath: sourcePath,
        textRange: part.source?.text
          ? {
              value: part.source.text.value,
              start: part.source.text.start,
              end: part.source.text.end,
            }
          : undefined,
      })
    } else if (isAgentUserContentPart(part)) {
      attachments.push({
        id: part.id || crypto.randomUUID(),
        type: 'agent',
        displayName: part.name,
        agentName: part.name,
        textRange: part.source
          ? {
              value: part.source.value,
              start: part.source.start,
              end: part.source.end,
            }
          : undefined,
      })
    }
  }

  return { text, attachments }
}

// ============================================
// Send Message
// ============================================

/**
 * 构建 file:// URL
 */
function toFileUrl(path: string): string {
  if (!path) return ''

  if (path.startsWith('file://')) {
    return path
  }

  if (path.startsWith('data:')) {
    return path
  }

  const normalized = path.replace(/\\/g, '/')
  if (/^[a-zA-Z]:/.test(normalized)) {
    return `file:///${normalized}`
  }
  if (normalized.startsWith('/')) {
    return `file://${normalized}`
  }
  return `file:///${normalized}`
}

/**
 * 构建 SDK 发送消息所需的参数
 */
function buildPromptParams(params: SendMessageParams, serverId?: string): PromptParams {
  const { sessionId, text, attachments, model, agent, variant, directory } = params

  const parts: NonNullable<PromptParams['parts']> = []

  // 文本 part
  const textPart: TextPartInput = {
    type: 'text',
    text,
  }
  parts.push(textPart)

  // 附件 parts
  for (const attachment of attachments) {
    if (attachment.type === 'agent') {
      const agentPart: AgentPartInput = {
        type: 'agent',
        name: attachment.agentName || attachment.displayName,
        source: attachment.textRange
          ? {
              value: attachment.textRange.value,
              start: attachment.textRange.start,
              end: attachment.textRange.end,
            }
          : undefined,
      }
      parts.push(agentPart)
    } else {
      const fileUrl = toFileUrl(attachment.url || '')
      if (!fileUrl) {
        console.warn('Skipping attachment with empty URL:', attachment)
        continue
      }

      const filePart: FilePartInput = {
        type: 'file',
        mime: attachment.mime || (attachment.type === 'folder' ? 'application/x-directory' : 'text/plain'),
        url: fileUrl,
        filename: attachment.displayName,
        source: attachment.textRange
          ? {
              text: {
                value: attachment.textRange.value,
                start: attachment.textRange.start,
                end: attachment.textRange.end,
              },
              type: 'file',
              path: attachment.relativePath || attachment.displayName,
            }
          : undefined,
      }
      parts.push(filePart)
    }
  }

  return {
    sessionID: sessionId,
    directory: formatPathForApi(directory, serverId),
    parts,
    model,
    agent,
    variant,
  }
}

/**
 * 同步发送消息（等待完成）
 */
export async function sendMessage(params: SendMessageParams, serverId?: string): Promise<SendMessageResponse> {
  const target = resolveSessionTarget(params.sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return unwrap<SendMessageResponse>(await sdk.session.prompt(buildPromptParams({ ...params, sessionId: target.sessionId }, target.serverId)))
}

/**
 * 异步发送消息 — 立即返回，AI 响应通过 SSE 推送
 */
export async function sendMessageAsync(params: SendMessageParams, serverId?: string): Promise<void> {
  const target = resolveSessionTarget(params.sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  unwrap(await sdk.session.promptAsync(buildPromptParams({ ...params, sessionId: target.sessionId }, target.serverId)))
}
