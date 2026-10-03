import type { ApiMessage, ApiMessageWithParts, ApiPart } from '../api/types'
import type { Message, MessageInfo, Part, UserMessageInfo } from '../types/message'
import { isUserMessage } from '../types/message'

type ApiMessageEnvelope = ApiMessageWithParts | { message: ApiMessageWithParts['info']; parts: ApiMessageWithParts['parts'] }

function getEnvelopeInfo(apiMessage: ApiMessageEnvelope): ApiMessageWithParts['info'] {
  return 'info' in apiMessage ? apiMessage.info : apiMessage.message
}

export function toUIMessage(apiMessage: ApiMessageEnvelope): Message {
  const message: Message = {
    info: getEnvelopeInfo(apiMessage) as MessageInfo,
    parts: apiMessage.parts as Part[],
    isStreaming: false,
  }
  // 轻量投影响应：主机 Agent 剥掉了 reasoning 与工具大输出，只留对话与元数据壳，
  // 并附上 lightweight 统计。标记为压缩态，展开折叠块时再回拉完整 parts。
  const lightweight = (apiMessage as { lightweight?: { reasoningCount?: number; stepCount?: number } }).lightweight
  if (lightweight) {
    message.isCompressed = true
    message.compressedStats = {
      reasoningCount: lightweight.reasoningCount ?? 0,
      stepCount: lightweight.stepCount ?? 0,
    }
  }
  return message
}

export function toUIMessageInfo(apiMessage: ApiMessage): MessageInfo {
  return apiMessage as MessageInfo
}

export function toUIPart(apiPart: ApiPart): Part {
  return apiPart as Part
}

export function toApiMessageWithParts(message: Pick<Message, 'info' | 'parts'>): ApiMessageWithParts {
  return {
    info: message.info as ApiMessageWithParts['info'],
    parts: message.parts as ApiMessageWithParts['parts'],
  }
}

export function isUserUIMessage(message: Message): message is Message & { info: UserMessageInfo } {
  return isUserMessage(message.info)
}
