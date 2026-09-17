import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('preferences sync', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  async function seedAccount() {
    const { login } = await import('./aiagent')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/aiagent/auth/login')) {
        return new Response(JSON.stringify({ success: true, data: { token: 'tok-sync' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    return login('panel.example.com', 'salen', 'secret-pass-1')
  }

  it('collects syncable keys and skips the login session itself', async () => {
    localStorage.setItem('srv:inst_1:opencode-hidden-directories', '["/work/secret"]')
    localStorage.setItem('theme-preset', '"eucalyptus"')
    localStorage.setItem('opencode-aiagent-account', '{"token":"should-not-sync"}')
    localStorage.setItem('opencode-preferences-sync-meta', '{}')
    localStorage.setItem('unrelated-key', 'nope')

    const { collectLocalPreferences, isSyncableKey } = await import('./preferencesSync')
    const entries = collectLocalPreferences()

    expect(entries['srv:inst_1:opencode-hidden-directories']).toBe('["/work/secret"]')
    expect(entries['theme-preset']).toBe('"eucalyptus"')
    expect(entries['opencode-aiagent-account']).toBeUndefined()
    expect(entries['opencode-preferences-sync-meta']).toBeUndefined()
    expect(entries['unrelated-key']).toBeUndefined()
    expect(isSyncableKey('opencode-servers')).toBe(true)
    expect(isSyncableKey('opencode-aiagent-account')).toBe(false)
  })

  it('pushes a JSON-parsed payload and skips unchanged content', async () => {
    await seedAccount()
    localStorage.setItem('srv:inst_1:opencode-project-order', '["a","b"]')
    localStorage.setItem('theme-preset', '"sakura"')

    let sentBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT' && url.endsWith('/api/aiagent/preferences')) {
        sentBody = JSON.parse(String(init.body))
        return new Response(JSON.stringify({ success: true, data: { written: ['theme-preset'] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { pushPreferences } = await import('./preferencesSync')
    const written = await pushPreferences()
    expect(written).toBe(1)

    const values = (sentBody as unknown as { values: Record<string, unknown> }).values
    expect(values['srv:inst_1:opencode-project-order']).toEqual(['a', 'b'])
    expect(values['theme-preset']).toBe('sakura')
    expect(values['opencode-aiagent-account']).toBeUndefined()

    // 内容未变时第二次推送应短路，不再发请求。
    const callsBefore = fetchMock.mock.calls.length
    const second = await pushPreferences()
    expect(second).toBe(0)
    expect(fetchMock.mock.calls.length).toBe(callsBefore)
  })

  it('pulls server preferences into localStorage', async () => {
    const account = await seedAccount()
    const localToken = JSON.parse(localStorage.getItem('opencode-aiagent-account') || '{}').token

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/aiagent/preferences')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: [
              { key: 'srv:inst_1:opencode-hidden-directories', value: ['/work/secret'], updatedAt: '2026-01-01T00:00:00Z' },
              { key: 'theme-preset', value: 'ocean', updatedAt: '2026-01-01T00:00:00Z' },
              { key: 'opencode-aiagent-account', value: { token: 'must-be-ignored' }, updatedAt: '2026-01-01T00:00:00Z' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { pullPreferences } = await import('./preferencesSync')
    const written = await pullPreferences(account)
    expect(written).toBe(2)

    expect(localStorage.getItem('srv:inst_1:opencode-hidden-directories')).toBe('["/work/secret"]')
    // 字符串值按原始字符串写入（推送时已按需解析），不额外加引号。
    expect(localStorage.getItem('theme-preset')).toBe('ocean')
    // 服务端下发的登录会话键必须被忽略，本地已登录的凭证不能被覆盖。
    expect(JSON.parse(localStorage.getItem('opencode-aiagent-account') || '{}').token).toBe(localToken)
  })

  it('toggles the sync switch', async () => {
    const { isSyncEnabled, setSyncEnabled } = await import('./preferencesSync')
    expect(isSyncEnabled()).toBe(false)
    setSyncEnabled(true)
    expect(isSyncEnabled()).toBe(true)
    setSyncEnabled(false)
    expect(isSyncEnabled()).toBe(false)
  })

  it('records the error message when sync fails', async () => {
    await seedAccount()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: false, error: 'boom' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const { syncPreferences, getSyncMeta } = await import('./preferencesSync')
    await expect(syncPreferences()).rejects.toThrow()
    expect(getSyncMeta().lastError).toBeTruthy()
  })
})
