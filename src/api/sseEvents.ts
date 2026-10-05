// ============================================
// SSE event parsing & coalescing (shared, dependency-free)
//
// 这段逻辑同时被主线程（events.ts 的 Tauri 分支与降级路径）和 Web Worker
// （workers/sseWorker.ts）使用，因此不能引入任何会拉起 React / store 的依赖，
// 只依赖纯常量与类型。
//
// 为什么需要 Worker：浏览器分支的 SSE 走 fetch + ReadableStream，流式回复时
// MESSAGE_PART_DELTA 极密集，decode + JSON.parse + coalesce 全部落在主线程，
// 与渲染抢时间。桌面端这部分在 Rust 侧完成，网页端用 Worker 补齐同一层。
// ============================================

import type { GlobalEvent } from './types'
import { EventTypes } from '../types/api/event'

export function isGlobalEvent(value: unknown): value is GlobalEvent {
  if (!isRecord(value)) return false
  if (typeof value.directory !== 'string') return false
  if (!isRecord(value.payload)) return false
  if (typeof value.payload.type !== 'string') return false
  return 'properties' in value.payload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

export function parseGlobalEvent(raw: string): GlobalEvent | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return isGlobalEvent(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * 同一批次内相同 (messageID, partID, field) 的 delta 合并为一个事件；
 * message.part.updated 到达后丢弃该 part 的在途 delta。
 */
export function coalesceEvents(events: GlobalEvent[]): GlobalEvent[] {
  if (events.length <= 1) return events

  const result: GlobalEvent[] = []
  const deltaIndexByKey = new Map<string, number>()
  const staleIndices = new Set<number>()

  for (const event of events) {
    const payload = event.payload

    if (payload.type === EventTypes.MESSAGE_PART_DELTA) {
      const p = payload.properties as {
        sessionID: string
        messageID: string
        partID: string
        field: string
        delta: string
      }
      const key = `${p.sessionID}\0${p.messageID}\0${p.partID}\0${p.field}`
      const idx = deltaIndexByKey.get(key)
      if (idx !== undefined && !staleIndices.has(idx)) {
        ;((result[idx].payload as { properties: { delta: string } }).properties).delta += p.delta
        continue
      }
      result.push(event)
      deltaIndexByKey.set(key, result.length - 1)
      continue
    }

    if (payload.type === EventTypes.MESSAGE_PART_UPDATED) {
      const props = payload.properties as {
        sessionID?: string
        part?: { id?: string; sessionID?: string; messageID?: string }
      }
      const sid = props.sessionID ?? props.part?.sessionID
      const mid = props.part?.messageID
      const pid = props.part?.id
      if (sid && mid && pid) {
        const prefix = `${sid}\0${mid}\0${pid}\0`
        for (const [key, idx] of deltaIndexByKey) {
          if (key.startsWith(prefix)) {
            staleIndices.add(idx)
            deltaIndexByKey.delete(key)
          }
        }
      }
    }

    result.push(event)
  }

  if (staleIndices.size > 0) {
    return result.filter((_, idx) => !staleIndices.has(idx))
  }
  return result
}

/** 解析一批 SSE data 行，做投影合并后返回可用事件。 */
export function parseAndCoalesce(rawEvents: string[]): GlobalEvent[] {
  const parsed: GlobalEvent[] = []
  for (const raw of rawEvents) {
    const event = parseGlobalEvent(raw)
    if (event) parsed.push(event)
  }
  return coalesceEvents(parsed)
}
