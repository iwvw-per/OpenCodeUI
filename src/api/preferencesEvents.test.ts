import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'opencode-aiagent-account'

/** 构造一个可手工推送 SSE 帧的流式 Response。 */
function makeSseResponse() {
  let controller: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  const encoder = new TextEncoder()
  return {
    response: new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    push(chunk: string) {
      controller.enqueue(encoder.encode(chunk))
    },
    close() {
      controller.close()
    },
  }
}

describe('preferences events (SSE client)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  async function seedAccount() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        domain: 'https://panel.example.com',
        username: 'salen',
        token: 'tok-events',
        loginAt: Date.now(),
      }),
    )
    const { readAccount } = await import('./aiagent')
    return readAccount()
  }

  it('parses a preferences event from the stream', async () => {
    const account = await seedAccount()
    const sse = makeSseResponse()
    vi.stubGlobal('fetch', vi.fn(async () => sse.response))

    const events: unknown[] = []
    const { subscribePreferenceEvents } = await import('./preferencesEvents')
    const sub = subscribePreferenceEvents({ onEvent: event => events.push(event) }, account)

    // 先给流一点时间被读取，再推事件。
    await new Promise(resolve => setTimeout(resolve, 10))
    sse.push('event: hello\ndata: {"connected":true}\n\n')
    sse.push('event: preferences\ndata: {"type":"preferences.changed","keys":["theme-preset"],"updatedAt":"2030-01-01T00:00:00Z"}\n\n')
    await new Promise(resolve => setTimeout(resolve, 30))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'preferences.changed', keys: ['theme-preset'] })
    sub.close()
  })

  it('handles CRLF framing and multiple events in one chunk', async () => {
    const account = await seedAccount()
    const sse = makeSseResponse()
    vi.stubGlobal('fetch', vi.fn(async () => sse.response))

    const events: Array<{ keys: string[] }> = []
    const { subscribePreferenceEvents } = await import('./preferencesEvents')
    const sub = subscribePreferenceEvents({ onEvent: e => events.push(e) }, account)

    await new Promise(resolve => setTimeout(resolve, 10))
    sse.push(
      'event: preferences\r\ndata: {"keys":["a"]}\r\n\r\n' + 'event: preferences\r\ndata: {"keys":["b"]}\r\n\r\n',
    )
    await new Promise(resolve => setTimeout(resolve, 30))

    expect(events.map(e => e.keys[0])).toEqual(['a', 'b'])
    sub.close()
  })

  it('ignores keepalive comments and non-preferences events', async () => {
    const account = await seedAccount()
    const sse = makeSseResponse()
    vi.stubGlobal('fetch', vi.fn(async () => sse.response))

    const events: unknown[] = []
    const { subscribePreferenceEvents } = await import('./preferencesEvents')
    const sub = subscribePreferenceEvents({ onEvent: e => events.push(e) }, account)

    await new Promise(resolve => setTimeout(resolve, 10))
    sse.push(': keepalive\n\n')
    sse.push('event: something-else\ndata: {"keys":["x"]}\n\n')
    await new Promise(resolve => setTimeout(resolve, 30))

    expect(events).toHaveLength(0)
    sub.close()
  })

  it('skips malformed event payloads without breaking the stream', async () => {
    const account = await seedAccount()
    const sse = makeSseResponse()
    vi.stubGlobal('fetch', vi.fn(async () => sse.response))

    const events: unknown[] = []
    const { subscribePreferenceEvents } = await import('./preferencesEvents')
    const sub = subscribePreferenceEvents({ onEvent: e => events.push(e) }, account)

    await new Promise(resolve => setTimeout(resolve, 10))
    sse.push('event: preferences\ndata: not-json\n\n')
    sse.push('event: preferences\ndata: {"keys":[]}\n\n')
    sse.push('event: preferences\ndata: {"keys":["ok"]}\n\n')
    await new Promise(resolve => setTimeout(resolve, 30))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ keys: ['ok'] })
    sub.close()
  })

  it('sends the bearer token in the Authorization header', async () => {
    const account = await seedAccount()
    const sse = makeSseResponse()
    const seen: Record<string, string> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers || {})
        seen.url = String(input)
        seen.auth = headers.get('Authorization') || ''
        seen.accept = headers.get('Accept') || ''
        return sse.response
      }),
    )

    const { subscribePreferenceEvents } = await import('./preferencesEvents')
    const sub = subscribePreferenceEvents({ onEvent: () => {} }, account)
    await new Promise(resolve => setTimeout(resolve, 20))

    // 令牌走请求头而不是 URL：URL 会进服务端访问日志。
    expect(seen.url).toBe('https://panel.example.com/api/aiagent/preferences/events')
    expect(seen.auth).toBe('Bearer tok-events')
    expect(seen.accept).toBe('text/event-stream')
    sub.close()
  })

  it('does not connect when there is no account', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { subscribePreferenceEvents } = await import('./preferencesEvents')
    const sub = subscribePreferenceEvents({ onEvent: () => {} }, null)
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(fetchMock).not.toHaveBeenCalled()
    sub.close()
  })

  it('reports connection state and stops after close', async () => {
    const account = await seedAccount()
    const sse = makeSseResponse()
    vi.stubGlobal('fetch', vi.fn(async () => sse.response))

    const states: boolean[] = []
    const { subscribePreferenceEvents } = await import('./preferencesEvents')
    const sub = subscribePreferenceEvents({ onEvent: () => {}, onStateChange: s => states.push(s) }, account)

    await new Promise(resolve => setTimeout(resolve, 20))
    expect(states).toContain(true)

    sub.close()
    expect(states[states.length - 1]).toBe(false)
  })

  it('normalizes payloads defensively', async () => {
    const { normalizePreferenceChange } = await import('./preferencesEvents')

    expect(normalizePreferenceChange(null)).toBeNull()
    expect(normalizePreferenceChange({ keys: [] })).toBeNull()
    expect(normalizePreferenceChange({ keys: 'nope' })).toBeNull()
    expect(normalizePreferenceChange({ keys: ['a', 1, '', null] })).toEqual({
      type: 'preferences.changed',
      keys: ['a'],
      updatedAt: '',
    })
    expect(normalizePreferenceChange({ type: 'x', keys: ['a'], updatedAt: 't' })).toEqual({
      type: 'x',
      keys: ['a'],
      updatedAt: 't',
    })
  })
})
