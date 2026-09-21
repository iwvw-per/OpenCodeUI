import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'opencode-aiagent-account'
const SYNC_ENABLED_KEY = 'opencode-preferences-sync-enabled'

describe('preferences sync engine (SSE wiring)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
    vi.resetModules()
    vi.useRealTimers()
  })

  function seedAccountAndEnable() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        domain: 'https://panel.example.com',
        username: 'salen',
        token: 'tok-engine',
        loginAt: Date.now(),
      }),
    )
    localStorage.setItem(SYNC_ENABLED_KEY, '1')
  }

  /** 可控的 SSE 流 + 记录请求次数。preferences 是 GET 返回的服务端偏好。 */
  function stubFetch(preferences: unknown[] = []) {
    let controller: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
    })
    const encoder = new TextEncoder()
    let putCount = 0
    let preferenceGetCount = 0

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT') {
        putCount += 1
        return new Response(JSON.stringify({ success: true, data: { written: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.endsWith('/api/aiagent/preferences/events')) {
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }
      // 偏好列表 GET（拉取侧）
      preferenceGetCount += 1
      return new Response(JSON.stringify({ success: true, data: preferences }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    return {
      fetchMock,
      pushEvent: (payload: string) => controller.enqueue(encoder.encode(`event: preferences\ndata: ${payload}\n\n`)),
      putCount: () => putCount,
      preferenceGetCount: () => preferenceGetCount,
    }
  }

  it('opens the SSE subscription on start and closes it on stop', async () => {
    seedAccountAndEnable()
    const sse = stubFetch()

    const { startPreferencesSync, stopPreferencesSync } = await import('./preferencesSyncEngine')
    await startPreferencesSync()
    await new Promise(resolve => setTimeout(resolve, 20))

    const eventCalls = sse.fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/preferences/events'))
    expect(eventCalls.length).toBeGreaterThan(0)

    stopPreferencesSync()
    await new Promise(resolve => setTimeout(resolve, 10))
    // 关闭后不应再建立新连接
    const afterStop = sse.fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/preferences/events')).length
    await new Promise(resolve => setTimeout(resolve, 30))
    const afterWait = sse.fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/preferences/events')).length
    expect(afterWait).toBe(afterStop)
  })

  it('triggers an immediate pull when a syncable key changes remotely', async () => {
    seedAccountAndEnable()
    const sse = stubFetch([
      {
        key: 'srv:aiagent:inst_1:opencode-saved-directories',
        value: [{ path: 'D:/Code/API-Monitor', name: 'API-Monitor', addedAt: 1 }],
        updatedAt: '2030-01-01T00:00:00Z',
      },
    ])

    const { startPreferencesSync, stopPreferencesSync } = await import('./preferencesSyncEngine')
    await startPreferencesSync()
    await new Promise(resolve => setTimeout(resolve, 20))

    const before = sse.preferenceGetCount()
    // 命中白名单的键：应在 debounce 后触发一次拉取（不必等 15 秒轮询）。
    sse.pushEvent(
      '{"type":"preferences.changed","keys":["srv:aiagent:inst_1:opencode-saved-directories"],"updatedAt":"2030-01-01T00:00:00Z"}',
    )
    await new Promise(resolve => setTimeout(resolve, 2600))

    expect(sse.preferenceGetCount()).toBeGreaterThan(before)
    // 服务端的值被拉下来并写入本地
    const saved = JSON.parse(localStorage.getItem('srv:aiagent:inst_1:opencode-saved-directories') || '[]')
    expect(saved.map((entry: { path: string }) => entry.path)).toEqual(['D:/Code/API-Monitor'])
    stopPreferencesSync()
  })

  it('ignores remote changes for non-syncable keys', async () => {
    seedAccountAndEnable()
    const sse = stubFetch()

    const { startPreferencesSync, stopPreferencesSync } = await import('./preferencesSyncEngine')
    await startPreferencesSync()
    await new Promise(resolve => setTimeout(resolve, 20))

    const before = sse.preferenceGetCount()
    // 本机专属键（不在白名单）：不应触发额外拉取。
    sse.pushEvent('{"type":"preferences.changed","keys":["opencode-active-server"],"updatedAt":"2030-01-01T00:00:00Z"}')
    await new Promise(resolve => setTimeout(resolve, 2600))

    expect(sse.preferenceGetCount()).toBe(before)
    stopPreferencesSync()
  })

  it('does not open SSE when sync is disabled', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ domain: 'https://panel.example.com', username: 'salen', token: 'tok', loginAt: Date.now() }),
    )
    const sse = stubFetch()

    const { startPreferencesSync } = await import('./preferencesSyncEngine')
    await startPreferencesSync()
    await new Promise(resolve => setTimeout(resolve, 20))

    const eventCalls = sse.fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/preferences/events'))
    expect(eventCalls).toHaveLength(0)
  })
})
