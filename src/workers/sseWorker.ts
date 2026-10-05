/// <reference lib="webworker" />

// ============================================
// SSE Worker (browser branch)
//
// 浏览器端的 SSE 走 fetch + ReadableStream，流式回复时 MESSAGE_PART_DELTA 极密集。
// 把「字节解码 + SSE 帧解析 + JSON.parse + delta 合并」整体搬到 Worker，主线程只
// 接收已合并的事件对象，避免解析抢占渲染主线程。桌面端这部分由 Rust 侧完成，
// 本 Worker 是网页端补齐的同一层。
// ============================================

import { createSseTextParser } from '../api/sse'
import { parseAndCoalesce } from '../api/sseEvents'
import type { GlobalEvent } from '../api/types'

interface ChunkMessage {
  type: 'chunk'
  connId: string
  bytes: ArrayBuffer
}

interface ResetMessage {
  type: 'reset'
  connId: string
}

type InboundMessage = ChunkMessage | ResetMessage

const decoders = new Map<string, TextDecoder>()
const parsers = new Map<string, ReturnType<typeof createSseTextParser>>()

function getState(connId: string) {
  let decoder = decoders.get(connId)
  if (!decoder) {
    decoder = new TextDecoder()
    decoders.set(connId, decoder)
  }
  let parser = parsers.get(connId)
  if (!parser) {
    parser = createSseTextParser()
    parsers.set(connId, parser)
  }
  return { decoder, parser }
}

function dropState(connId: string) {
  decoders.delete(connId)
  parsers.delete(connId)
}

self.onmessage = (event: MessageEvent<InboundMessage>) => {
  const msg = event.data
  if (msg.type === 'reset') {
    dropState(msg.connId)
    return
  }

  const { decoder, parser } = getState(msg.connId)
  const text = decoder.decode(new Uint8Array(msg.bytes), { stream: true })
  const events: GlobalEvent[] = text ? parseAndCoalesce(parser.push(text)) : []
  self.postMessage({ type: 'events', connId: msg.connId, events })
}
