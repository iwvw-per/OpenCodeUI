// ============================================
// 消息渲染纯逻辑
//
// 与 MessageRenderer.tsx 分离：该文件只导出组件，本文件放类型与纯函数，
// 满足 Fast Refresh 对「组件文件只导出组件」的要求。
// ============================================

import {
  isToolPart,
  isVisibleReasoningPart,
  isVisibleTextPart,
  type Message,
  type Part,
  type StepFinishPart,
  type ToolPart,
} from '../../types/message'

/**
 * 过程内容范围：
 * - all: 完整渲染
 * - process: 只渲染过程部分
 * - final: 只渲染尾部最终 text
 * - inline: 完整渲染（已在外层过程块内）
 */
export type ProcessContentScope = 'all' | 'process' | 'final' | 'inline'

export type RenderItem =
  | { type: 'single'; part: Part }
  | { type: 'tool-group'; parts: ToolPart[]; stepFinish?: StepFinishPart }

export type ProcessSplit = {
  processItems: RenderItem[]
  finalItems: RenderItem[]
  hasProcess: boolean
  hasFinal: boolean
}

/** parts[from..] 跳过基础设施和空内容后，下一个有意义的 part 是否为 tool */
function hasMoreToolsAhead(parts: Part[], from: number): boolean {
  for (let k = from; k < parts.length; k++) {
    const part = parts[k]
    if (part.type === 'step-start' || part.type === 'step-finish' || part.type === 'snapshot' || part.type === 'patch')
      continue
    if (part.type === 'text' && !isVisibleTextPart(part)) continue
    if (part.type === 'reasoning' && !isVisibleReasoningPart(part)) continue
    return part.type === 'tool'
  }
  return false
}

export function groupPartsForRender(parts: Part[]): RenderItem[] {
  const result: RenderItem[] = []
  let toolGroup: ToolPart[] = []
  let stepFinish: StepFinishPart | undefined

  const flushToolGroup = (sf?: StepFinishPart) => {
    if (toolGroup.length === 0) return
    result.push({ type: 'tool-group', parts: toolGroup, stepFinish: sf })
    toolGroup = []
    stepFinish = undefined
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]

    // 跳过不渲染的 parts
    if (part.type === 'step-start' || part.type === 'snapshot' || part.type === 'patch') continue
    if (part.type === 'text' && !isVisibleTextPart(part)) continue
    if (part.type === 'reasoning' && !isVisibleReasoningPart(part)) continue

    if (isToolPart(part)) {
      toolGroup.push(part)
    } else if (part.type === 'step-finish') {
      if (toolGroup.length > 0 && hasMoreToolsAhead(parts, i + 1)) {
        // 中间 step-finish：后面还有 tool，暂存不 flush
        stepFinish = part
      } else if (toolGroup.length > 0) {
        // 最后一个 step-finish，结束 tool group
        flushToolGroup(part)
      } else {
        result.push({ type: 'single', part })
      }
    } else {
      flushToolGroup(stepFinish)
      result.push({ type: 'single', part })
    }
  }

  flushToolGroup(stepFinish)
  return result
}

/**
 * 把 render items 拆成「过程」和「最终回答」。
 * 最终回答 = 消息中最后一段连续 text + 紧随的独立 step-finish。
 * reasoning / tool 永远进过程。
 */
export function splitProcessRenderItems(items: RenderItem[]): ProcessSplit {
  if (items.length === 0) {
    return { processItems: [], finalItems: [], hasProcess: false, hasFinal: false }
  }

  let lastTextIdx = -1
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.type === 'single' && item.part.type === 'text') {
      lastTextIdx = i
      break
    }
    if (item.type === 'single' && item.part.type === 'step-finish') continue
    break
  }

  if (lastTextIdx < 0) {
    return {
      processItems: items,
      finalItems: [],
      hasProcess: items.length > 0,
      hasFinal: false,
    }
  }

  let textRunStart = lastTextIdx
  while (textRunStart > 0) {
    const prev = items[textRunStart - 1]
    if (prev.type === 'single' && prev.part.type === 'text') {
      textRunStart -= 1
      continue
    }
    break
  }

  let textRunEnd = lastTextIdx
  while (textRunEnd + 1 < items.length) {
    const next = items[textRunEnd + 1]
    if (next.type === 'single' && next.part.type === 'step-finish') {
      textRunEnd += 1
      continue
    }
    break
  }

  const finalItems = items.slice(textRunStart, textRunEnd + 1)
  const before = items.slice(0, textRunStart)
  const after = items.slice(textRunEnd + 1)
  const afterProcess = after.filter(
    item => !(item.type === 'single' && item.part.type === 'step-finish'),
  )
  const afterStepFinish = after.filter(
    item => item.type === 'single' && item.part.type === 'step-finish',
  )
  const processItems = afterProcess.length > 0 ? [...before, ...afterProcess] : before
  const mergedFinal = afterStepFinish.length > 0 ? [...finalItems, ...afterStepFinish] : finalItems

  return {
    processItems,
    finalItems: mergedFinal,
    hasProcess: processItems.length > 0,
    hasFinal: mergedFinal.length > 0,
  }
}

/** 流式未完成时不拆 final：中间 text 后面还可能跟 tool */
export function messageStillStreamingProcess(message: Message): boolean {
  if (message.info.role !== 'assistant') return false
  return !!message.isStreaming || message.info.time.completed == null
}

/** 是否有可收进过程块的内容（tool / reasoning 等，不含尾部最终 text） */
export function messageHasProcessContent(message: Message): boolean {
  if (message.info.role !== 'assistant') return false
  if (messageStillStreamingProcess(message)) return true
  const items = groupPartsForRender(message.parts)
  if (items.length === 0) return false
  return splitProcessRenderItems(items).hasProcess
}

/** 是否有应留在折叠块外的最终 text（仅消息已结束后才拆） */
export function messageHasFinalContent(message: Message): boolean {
  if (message.info.role !== 'assistant') return false
  if (messageStillStreamingProcess(message)) return false
  return splitProcessRenderItems(groupPartsForRender(message.parts)).hasFinal
}
