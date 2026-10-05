// ============================================
// SSE Worker Client
//
// 每个 SSE 连接一个 connId，把原始字节交给 Worker 做解码/解析/合并，主线程只
// 接收已合并的事件。Worker 不可用（环境不支持、构造失败或运行中崩溃）时，
// pump 自动回退到主线程解析。
// ============================================

import type { GlobalEvent } from '../api/types'
import { createSseTextParser } from '../api/sse'
import { parseAndCoalesce } from '../api/sseEvents'

type EventsHandler = (events: GlobalEvent[]) => void

interface WorkerResponse {
  type: 'events'
  connId: string
  events: GlobalEvent[]
}

let worker: Worker | null = null
let workerFailed = false
const handlers = new Map<string, EventsHandler>()

function getWorker(): Worker | null {
  if (worker) return worker
  if (workerFailed) return null
  try {
    worker = new Worker(new URL('../workers/sseWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data
      if (msg.type !== 'events') return
      handlers.get(msg.connId)?.(msg.events)
    }
    worker.onerror = () => {
      // Worker 初始化/运行失败：标记不可用并销毁。已建立的 pump 在下一次 feed
      // 时通过 getWorker() 拿到 null，自动切到主线程解析，避免事件被静默丢弃。
      workerFailed = true
      worker?.terminate()
      worker = null
      handlers.clear()
    }
    return worker
  } catch {
    workerFailed = true
    return null
  }
}

/**
 * 注册一个连接的事件回调。返回投喂函数与清理函数。
 *
 * feed 接收原始字节；Worker 可用则转发（transfer 零拷贝），否则就地解析。
 * 每次 feed 都重新确认 Worker 状态，因此运行中崩溃也能无缝降级。
 */
export function createSseEventPump(
  connId: string,
  onEvents: EventsHandler,
): { feed: (bytes: Uint8Array) => void; reset: () => void } {
  let decoder = new TextDecoder()
  let parser = createSseTextParser()

  const w0 = getWorker()
  if (w0) handlers.set(connId, onEvents)

  return {
    feed(bytes: Uint8Array) {
      const w = getWorker()
      if (w) {
        // 复制到独立 ArrayBuffer 以便 transfer（原 bytes 可能被上游复用）
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        w.postMessage({ type: 'chunk', connId, bytes: buffer }, [buffer])
        return
      }
      // Worker 不可用（从未启动或已崩溃）：主线程解析
      handlers.delete(connId)
      const text = decoder.decode(bytes, { stream: true })
      if (!text) return
      const events = parseAndCoalesce(parser.push(text))
      if (events.length > 0) onEvents(events)
    },
    reset() {
      handlers.delete(connId)
      decoder = new TextDecoder()
      parser = createSseTextParser()
      getWorker()?.postMessage({ type: 'reset', connId })
    },
  }
}
