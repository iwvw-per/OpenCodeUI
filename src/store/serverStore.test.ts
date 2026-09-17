import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

describe('serverStore clock calibration', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('derives calibrated now from a server timestamp and monotonic time', async () => {
    const { serverStore } = await import('./serverStore')
    const serverTimestamp = Date.parse('2026-04-22T15:00:00.000Z')
    const perfSpy = vi.spyOn(performance, 'now')

    perfSpy.mockReturnValueOnce(1_000)
    expect(
      serverStore.applyServerConnectedTimestamp(
        serverStore.getActiveServerId(),
        new Date(serverTimestamp).toISOString(),
      ),
    ).toBe(true)

    perfSpy.mockReturnValue(1_750)
    expect(serverStore.getActiveCalibratedNow()).toBe(serverTimestamp + 750)
  })

  it('ignores malformed timestamps', async () => {
    const { serverStore } = await import('./serverStore')

    expect(serverStore.applyServerConnectedTimestamp(serverStore.getActiveServerId(), 'not-a-date')).toBe(false)
    expect(serverStore.getActiveCalibratedNow()).toBeUndefined()
  })

  it('does not reuse calibration after switching to another server without calibration', async () => {
    const { serverStore } = await import('./serverStore')
    const perfSpy = vi.spyOn(performance, 'now')

    perfSpy.mockReturnValue(500)
    serverStore.applyServerConnectedTimestamp(serverStore.getActiveServerId(), '2026-04-22T15:00:00.000Z')

    const remote = serverStore.addServer({
      name: 'Remote',
      url: 'http://remote.test',
    })
    serverStore.setActiveServer(remote.id)

    expect(serverStore.getActiveCalibratedNow()).toBeUndefined()
  })
})

describe('serverStore local runtime URL', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('uses the detected local service URL without persisting it as the configured URL', async () => {
    const { serverStore } = await import('./serverStore')

    expect(serverStore.getActiveBaseUrl()).toBe('http://127.0.0.1:4096')

    expect(serverStore.setLocalServerRuntimeUrl('http://127.0.0.1:58231/')).toBe(true)

    expect(serverStore.getActiveBaseUrl()).toBe('http://127.0.0.1:58231')
    expect(serverStore.getLocalServerUrl()).toBe('http://127.0.0.1:58231')
    expect(serverStore.getStoredServers().find(server => server.id === 'local')?.url).toBe('http://127.0.0.1:4096')
  })

  it('notifies listeners when the active local runtime URL changes', async () => {
    const { serverStore } = await import('./serverStore')
    const listener = vi.fn()
    serverStore.onServerChange(listener)

    expect(serverStore.setLocalServerRuntimeUrl('http://127.0.0.1:58231')).toBe(true)

    expect(listener).toHaveBeenCalledWith('local', 'local-runtime-url')
  })

  it('does not notify active endpoint listeners when local URL changes while remote is active', async () => {
    const { serverStore } = await import('./serverStore')
    const remote = serverStore.addServer({ name: 'Remote', url: 'http://remote.test' })
    const listener = vi.fn()

    serverStore.setActiveServer(remote.id)
    listener.mockClear()
    serverStore.onServerChange(listener)

    expect(serverStore.setLocalServerRuntimeUrl('http://127.0.0.1:58231')).toBe(true)

    expect(serverStore.getActiveBaseUrl()).toBe('http://remote.test')
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('serverStore storage recovery', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
  })

  it.each(['{}', 'null', '"nope"', '[1,2,3]'])('falls back to the default server for corrupt storage %s', async stored => {
    localStorage.setItem('opencode-servers', stored)
    const { serverStore } = await import('./serverStore')

    expect(serverStore.getStoredServers().map(server => server.id)).toEqual(['local'])
  })

  it('drops entries missing required string fields', async () => {
    localStorage.setItem(
      'opencode-servers',
      JSON.stringify([
        { id: 'ok', name: 'OK', url: 'http://ok.test' },
        { id: '', name: 'Empty id', url: 'http://bad.test' },
        { id: 'no-name', url: 'http://bad.test' },
        { id: 'no-url', name: 'No URL' },
        null,
      ]),
    )
    const { serverStore } = await import('./serverStore')

    expect(serverStore.getStoredServers().map(server => server.id)).toEqual(['ok'])
  })
})

describe('serverStore health check', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks a valid OpenCode health response as online', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ healthy: true, version: '1.16.0' }))
    const { serverStore } = await import('./serverStore')

    const health = await serverStore.checkHealth('local')

    expect(health.status).toBe('online')
    expect(health.version).toBe('1.16.0')
  })

  it('rejects HTML responses even when the status is 200', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('<!doctype html><title>OpenCode</title>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )
    const { serverStore } = await import('./serverStore')

    const health = await serverStore.checkHealth('local')

    expect(health.status).toBe('error')
    expect(health.error).toMatch(/HTML/)
  })

  it('rejects JSON that is not an OpenCode health response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { serverStore } = await import('./serverStore')

    const health = await serverStore.checkHealth('local')

    expect(health.status).toBe('error')
    expect(health.error).toBe('Not an OpenCode server')
  })

  it('reports unauthorized credentials separately', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ name: 'Unauthorized' }, { status: 401 }))
    const { serverStore } = await import('./serverStore')

    const health = await serverStore.checkHealth('local')

    expect(health.status).toBe('unauthorized')
  })

  it('sends the bearer token when the server only has a token and no password', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ healthy: true, version: '1.18.30' }))
    const { serverStore } = await import('./serverStore')
    const server = serverStore.addServerWithId('aiagent:inst_1', {
      name: '笔电',
      url: 'http://panel.test/api/aiagent/gw/inst_1',
      auth: { username: 'salen', password: '', token: 'token-abc' },
    })

    const health = await serverStore.checkHealth(server.id)

    expect(health.status).toBe('online')
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token-abc')
  })

  it('does not let stale health checks overwrite newer results', async () => {
    const staleResponse = createDeferred<Response>()
    vi.mocked(fetch)
      .mockImplementationOnce(() => staleResponse.promise)
      .mockResolvedValueOnce(jsonResponse({ healthy: true, version: '1.16.0' }))

    const { serverStore } = await import('./serverStore')

    const staleCheck = serverStore.checkHealth('local')
    const freshHealth = await serverStore.checkHealth('local')

    expect(freshHealth.status).toBe('online')
    expect(serverStore.getHealth('local')?.status).toBe('online')

    staleResponse.resolve(
      new Response('<!doctype html><title>OpenCode</title>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )
    const staleHealth = await staleCheck

    expect(staleHealth.status).toBe('error')
    expect(serverStore.getHealth('local')?.status).toBe('online')
  })
})

describe('serverStore enable/disable', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to enabled when the field is absent', async () => {
    const { serverStore } = await import('./serverStore')
    // 默认 Local 没有写 enabled 字段，应视为启用
    expect(serverStore.isServerEnabled('local')).toBe(true)
    expect(serverStore.getEnabledServers().map(s => s.id)).toContain('local')
  })

  it('disabling a non-active server keeps the active one untouched', async () => {
    const { serverStore } = await import('./serverStore')
    const extra = serverStore.addServer({ name: 'Remote', url: 'http://example.com' })
    const activeBefore = serverStore.getActiveServerId()

    expect(serverStore.setServerEnabled(extra.id, false)).toBe(true)
    expect(serverStore.isServerEnabled(extra.id)).toBe(false)
    expect(serverStore.getActiveServerId()).toBe(activeBefore)
  })

  it('excludes disabled servers from the enabled set', async () => {
    const { serverStore } = await import('./serverStore')
    const extra = serverStore.addServer({ name: 'Remote', url: 'http://example.com' })
    serverStore.setServerEnabled(extra.id, false)

    const ids = serverStore.getEnabledServers().map(s => s.id)
    expect(ids).not.toContain(extra.id)
  })

  it('auto-switches to an enabled server when the active one is disabled', async () => {
    const { serverStore } = await import('./serverStore')
    const extra = serverStore.addServer({ name: 'Remote', url: 'http://example.com' })
    serverStore.setActiveServer('local')

    expect(serverStore.setServerEnabled('local', false)).toBe(true)
    // 活动指针必须离开被停用的服务器，否则 getActiveServerId 的兜底
    // 会一直返回它，而连接集合已排除，形成「活动但无连接」的空转
    expect(serverStore.getActiveServerId()).toBe(extra.id)
    expect(serverStore.isServerEnabled(extra.id)).toBe(true)
  })

  it('refuses to disable the last enabled server', async () => {
    const { serverStore } = await import('./serverStore')
    // 只剩 Local 一台时拒绝停用，避免面板没有可用后端
    serverStore.setActiveServer('local')
    const onlyServer = serverStore.getServers().length === 1
    expect(onlyServer).toBe(true)

    expect(serverStore.setServerEnabled('local', false)).toBe(false)
    expect(serverStore.isServerEnabled('local')).toBe(true)
  })

  it('allows re-enabling and returns true for a no-op toggle', async () => {
    const { serverStore } = await import('./serverStore')
    const extra = serverStore.addServer({ name: 'Remote', url: 'http://example.com' })

    expect(serverStore.setServerEnabled(extra.id, true)).toBe(true)
    serverStore.setServerEnabled(extra.id, false)
    expect(serverStore.setServerEnabled(extra.id, true)).toBe(true)
    expect(serverStore.isServerEnabled(extra.id)).toBe(true)
  })
})
