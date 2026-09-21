import { beforeEach, describe, expect, it, vi } from 'vitest'

const SYNC_STAMPS_KEY = 'opencode-preferences-sync-stamps'
const TOMBSTONES_KEY = 'opencode-preferences-sync-tombstones'

const GLOBAL_WHITELIST = [
  'chat-wide-mode',
  'code-word-wrap',
  'collapse-user-messages',
  'descriptive-tool-steps',
  'desktop-collapsed-input-dock',
  'diff-style',
  'external-file-drop-mode',
  'font-scale',
  'glass-effect',
  'i18nextLng',
  'process-collapse-enabled',
  'queue-followup-messages',
  'reasoning-display-mode',
  'render-user-markdown',
  'sidebar-width',
  'step-finish-display',
  'theme-custom-css',
  'theme-mode',
  'theme-preset',
]

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

  function stubPreferencesFetch(
    items: unknown,
    onPut?: (url: string, body: Record<string, unknown>) => void,
  ) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        onPut?.(url, body)
        return new Response(JSON.stringify({ success: true, data: { written: Object.keys(body.values ?? {}) } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/api/aiagent/preferences')) {
        return new Response(JSON.stringify({ success: true, data: items }), {
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
    return fetchMock
  }

  it('admits every globally whitelisted key', async () => {
    const { isSyncableKey } = await import('./preferencesSync')
    for (const key of GLOBAL_WHITELIST) {
      expect(isSyncableKey(key), key).toBe(true)
    }
  })

  it('admits the opencode: and opencode- prefixes', async () => {
    const { isSyncableKey } = await import('./preferencesSync')

    expect(isSyncableKey('opencode:notifications')).toBe(true)
    expect(isSyncableKey('opencode:sound-settings')).toBe(true)
    expect(isSyncableKey('opencode:toast-enabled')).toBe(true)
    expect(isSyncableKey('opencode:update-check')).toBe(true)

    expect(isSyncableKey('opencode-keybindings')).toBe(true)
    expect(isSyncableKey('opencode-panel-layout')).toBe(true)
    expect(isSyncableKey('opencode-sidebar-session-sort')).toBe(true)
    expect(isSyncableKey('opencode-work-status-enabled')).toBe(true)
    expect(isSyncableKey('opencode-bottom-panel-height')).toBe(true)
    expect(isSyncableKey('opencode-right-panel-width')).toBe(true)
    expect(isSyncableKey('opencode-pinned-sessions')).toBe(true)
    expect(isSyncableKey('opencode-pinned-messages')).toBe(true)
  })

  it('admits srv:aiagent: preferences but rejects path and stats keys', async () => {
    const { isSyncableKey } = await import('./preferencesSync')

    expect(isSyncableKey('srv:aiagent:inst_1:model-variant-prefs')).toBe(true)
    expect(isSyncableKey('srv:aiagent:inst_1:opencode-detected-path-style')).toBe(true)
    expect(isSyncableKey('srv:aiagent:inst_1:opencode-hidden-directories')).toBe(true)
    expect(isSyncableKey('srv:aiagent:inst_1:opencode-saved-directories')).toBe(true)
    expect(isSyncableKey('srv:aiagent:inst_1:opencode-auto-approve-enabled')).toBe(true)
    expect(isSyncableKey('srv:aiagent:inst_1:opencode-path-mode')).toBe(true)
    expect(isSyncableKey('srv:aiagent:inst_1:selected-agent:pane-1')).toBe(true)
    expect(isSyncableKey('srv:aiagent:inst_1:selected-model-key')).toBe(true)
    expect(isSyncableKey('srv:aiagent:inst_1:session-model-selection')).toBe(true)
    expect(isSyncableKey('srv:aiagent:inst_1:hidden-model-keys')).toBe(true)

    expect(isSyncableKey('srv:aiagent:inst_1:last-directory')).toBe(false)
    expect(isSyncableKey('srv:aiagent:inst_1:model-usage-stats')).toBe(false)
    expect(isSyncableKey('srv:aiagent:inst_1:opencode-recent-projects')).toBe(false)
  })

  it('rejects credentials, machine-local keys and other srv buckets', async () => {
    const { isSyncableKey } = await import('./preferencesSync')

    expect(isSyncableKey('webRcloneAuth')).toBe(false)
    expect(isSyncableKey('tileboard_cache_x')).toBe(false)
    expect(isSyncableKey('ai-draw-nexus-chat-storage')).toBe(false)
    expect(isSyncableKey('dashboard_api_stats_cache_v1')).toBe(false)
    expect(isSyncableKey('debug-err')).toBe(false)
    expect(isSyncableKey('unrelated-key')).toBe(false)

    expect(isSyncableKey('opencode-aiagent-account')).toBe(false)
    expect(isSyncableKey('opencode-preferences-sync-meta')).toBe(false)
    expect(isSyncableKey('opencode-preferences-sync-stamps')).toBe(false)
    expect(isSyncableKey('opencode-preferences-sync-tombstones')).toBe(false)

    expect(isSyncableKey('opencode-servers')).toBe(false)
    expect(isSyncableKey('opencode-active-server')).toBe(false)
    expect(isSyncableKey('opencode-binary-path')).toBe(false)
    expect(isSyncableKey('opencode-auto-start-service')).toBe(false)
    expect(isSyncableKey('opencode-service-env-vars')).toBe(false)
    expect(isSyncableKey('opencode-terminal-layout')).toBe(false)

    expect(isSyncableKey('srv:local:opencode-hidden-directories')).toBe(false)
    expect(isSyncableKey('srv:server-1:opencode-pinned-sessions')).toBe(false)
    expect(isSyncableKey('last-directory')).toBe(false)
    expect(isSyncableKey('selected-project-id')).toBe(false)
    expect(isSyncableKey('model-usage-stats')).toBe(false)
  })

  it('collects only whitelisted keys from localStorage', async () => {
    localStorage.setItem('font-scale', '0.1')
    localStorage.setItem('theme-preset', '"eucalyptus"')
    localStorage.setItem('i18nextLng', 'zh-CN')
    localStorage.setItem('opencode:notifications', '{"enabled":true}')
    localStorage.setItem('opencode-keybindings', '{}')
    localStorage.setItem('srv:aiagent:inst_1:selected-agent:pane-1', '"build"')
    localStorage.setItem('opencode-servers', '[{"url":"http://localhost"}]')
    localStorage.setItem('opencode-active-server', 'aiagent:inst_1')
    localStorage.setItem('opencode-aiagent-account', '{"token":"should-not-sync"}')
    localStorage.setItem('srv:aiagent:inst_1:last-directory', 'D:/work')
    localStorage.setItem('srv:local:opencode-hidden-directories', '["/secret"]')
    localStorage.setItem('webRcloneAuth', 'Basic c2FsZW46c3NsbjUwMTQu')
    localStorage.setItem('unrelated-key', 'nope')

    const { collectLocalPreferences } = await import('./preferencesSync')
    const entries = collectLocalPreferences()

    expect(entries['font-scale']).toBe('0.1')
    expect(entries['theme-preset']).toBe('"eucalyptus"')
    expect(entries['i18nextLng']).toBe('zh-CN')
    expect(entries['opencode:notifications']).toBeDefined()
    expect(entries['opencode-keybindings']).toBeDefined()
    expect(entries['srv:aiagent:inst_1:selected-agent:pane-1']).toBeDefined()

    expect(entries['opencode-servers']).toBeUndefined()
    expect(entries['opencode-active-server']).toBeUndefined()
    expect(entries['opencode-aiagent-account']).toBeUndefined()
    expect(entries['srv:aiagent:inst_1:last-directory']).toBeUndefined()
    expect(entries['srv:local:opencode-hidden-directories']).toBeUndefined()
    expect(entries['webRcloneAuth']).toBeUndefined()
    expect(entries['unrelated-key']).toBeUndefined()
  })

  it('pushes with lastWriteWins and per-key timestamps', async () => {
    await seedAccount()
    localStorage.setItem('diff-style', '"markers"')
    localStorage.setItem('theme-preset', '"sakura"')

    let putUrl = ''
    let sentBody: Record<string, unknown> | null = null
    const fetchMock = stubPreferencesFetch([], (url, body) => {
      putUrl = url
      sentBody = body
    })

    const { pushPreferences } = await import('./preferencesSync')
    const written = await pushPreferences()
    expect(written).toBe(2)
    expect(putUrl).toContain('lastWriteWins=1')

    const values = sentBody as unknown as { values: Record<string, unknown> }
    const updatedAt = sentBody as unknown as { updatedAt: Record<string, string> }
    expect(values.values['diff-style']).toEqual('markers')
    expect(values.values['theme-preset']).toBe('sakura')
    expect(values.values['opencode-aiagent-account']).toBeUndefined()
    expect(Object.keys(updatedAt.updatedAt).sort()).toEqual(['diff-style', 'theme-preset'])

    const firstDiffStamp = updatedAt.updatedAt['diff-style']

    const callsBefore = fetchMock.mock.calls.length
    localStorage.setItem('theme-preset', '"ocean"')
    const second = await pushPreferences()
    expect(second).toBe(2)
    expect(fetchMock.mock.calls.length).toBe(callsBefore + 1)

    const secondStamps = (sentBody as unknown as { updatedAt: Record<string, string> }).updatedAt
    expect(secondStamps['diff-style']).toBe(firstDiffStamp)
    expect(secondStamps['theme-preset']).not.toBe(updatedAt.updatedAt['theme-preset'])

    const afterChange = fetchMock.mock.calls.length
    const third = await pushPreferences()
    expect(third).toBe(0)
    expect(fetchMock.mock.calls.length).toBe(afterChange)
  })

  it('uses the current time for every key on the first sync', async () => {
    await seedAccount()
    localStorage.setItem('font-scale', '0.2')

    let sentBody: Record<string, unknown> | null = null
    stubPreferencesFetch([], (_url, body) => {
      sentBody = body
    })

    const { pushPreferences } = await import('./preferencesSync')
    await pushPreferences()

    const stamps = (sentBody as unknown as { updatedAt: Record<string, string> }).updatedAt
    expect(stamps['font-scale']).toBeTruthy()
    expect(Number.isNaN(Date.parse(stamps['font-scale']))).toBe(false)
  })

  it('does not overwrite a newer local value with an older server value', async () => {
    const account = await seedAccount()
    localStorage.setItem('font-scale', '0.5')
    localStorage.setItem(
      SYNC_STAMPS_KEY,
      JSON.stringify({ stamps: { 'font-scale': '2030-01-01T00:00:00.000Z' }, known: {} }),
    )

    stubPreferencesFetch([
      { key: 'font-scale', value: '0.1', updatedAt: '2020-01-01T00:00:00.000Z' },
      { key: 'theme-preset', value: 'ocean', updatedAt: '2030-01-01T00:00:00.000Z' },
    ])

    const { pullPreferences } = await import('./preferencesSync')
    const written = await pullPreferences(account)
    expect(written).toBe(1)
    expect(localStorage.getItem('font-scale')).toBe('0.5')
    expect(localStorage.getItem('theme-preset')).toBe('ocean')
  })

  it('pulls server preferences into localStorage', async () => {
    const account = await seedAccount()
    const localToken = JSON.parse(localStorage.getItem('opencode-aiagent-account') || '{}').token

    stubPreferencesFetch([
      { key: 'font-scale', value: '0.1', updatedAt: '2030-01-01T00:00:00Z' },
      { key: 'theme-preset', value: 'ocean', updatedAt: '2030-01-01T00:00:00Z' },
      { key: 'opencode-aiagent-account', value: { token: 'must-be-ignored' }, updatedAt: '2030-01-01T00:00:00Z' },
      { key: 'opencode-servers', value: [{ url: 'http://evil' }], updatedAt: '2030-01-01T00:00:00Z' },
      { key: 'srv:local:opencode-hidden-directories', value: ['/other'], updatedAt: '2030-01-01T00:00:00Z' },
    ])

    const { pullPreferences } = await import('./preferencesSync')
    const written = await pullPreferences(account)
    expect(written).toBe(2)

    expect(localStorage.getItem('font-scale')).toBe('0.1')
    expect(localStorage.getItem('theme-preset')).toBe('ocean')
    expect(JSON.parse(localStorage.getItem('opencode-aiagent-account') || '{}').token).toBe(localToken)
    expect(localStorage.getItem('opencode-servers')).toBeNull()
    expect(localStorage.getItem('srv:local:opencode-hidden-directories')).toBeNull()
  })

  it('merges pinned sessions as a deduplicated union', async () => {
    const account = await seedAccount()
    localStorage.setItem(
      'opencode-pinned-sessions',
      JSON.stringify([{ sessionId: 'local-1', directory: '/local', title: 'Local' }]),
    )

    stubPreferencesFetch([
      {
        key: 'opencode-pinned-sessions',
        value: [
          { sessionId: 'server-1', directory: '/server', title: 'Server' },
          { sessionId: 'local-1', directory: '/server', title: 'Server copy' },
        ],
        updatedAt: '2030-01-01T00:00:00Z',
      },
    ])

    const { pullPreferences } = await import('./preferencesSync')
    await pullPreferences(account)

    const merged = JSON.parse(localStorage.getItem('opencode-pinned-sessions') || '[]')
    expect(merged.map((entry: { sessionId: string }) => entry.sessionId)).toEqual(['server-1', 'local-1'])
    expect(merged[1].title).toBe('Server copy')
  })

  it('merges per-server pinned sessions and saved directories as a union', async () => {
    const account = await seedAccount()
    localStorage.setItem(
      'srv:aiagent:inst_1:opencode-pinned-sessions',
      JSON.stringify([{ sessionId: 'local-1', directory: '/local', title: 'Local' }]),
    )
    localStorage.setItem(
      'srv:aiagent:inst_1:opencode-saved-directories',
      JSON.stringify([{ path: '/a', name: 'A', addedAt: 1 }]),
    )

    stubPreferencesFetch([
      {
        key: 'srv:aiagent:inst_1:opencode-pinned-sessions',
        value: [
          { sessionId: 'server-1', directory: '/server', title: 'Server' },
          { sessionId: 'local-1', directory: '/server', title: 'Server copy' },
        ],
        updatedAt: '2030-01-01T00:00:00Z',
      },
      {
        key: 'srv:aiagent:inst_1:opencode-saved-directories',
        value: [
          { path: '/a', name: 'A server', addedAt: 5 },
          { path: '/b', name: 'B', addedAt: 2 },
        ],
        updatedAt: '2030-01-01T00:00:00Z',
      },
    ])

    const { pullPreferences } = await import('./preferencesSync')
    await pullPreferences(account)

    const pinned = JSON.parse(localStorage.getItem('srv:aiagent:inst_1:opencode-pinned-sessions') || '[]')
    expect(pinned.map((entry: { sessionId: string }) => entry.sessionId)).toEqual(['server-1', 'local-1'])

    const saved = JSON.parse(localStorage.getItem('srv:aiagent:inst_1:opencode-saved-directories') || '[]')
    expect(saved.map((entry: { path: string }) => entry.path)).toEqual(['/a', '/b'])
    expect(saved[0].name).toBe('A server')
  })

  it('keeps hidden directories on whole-key last-write-wins instead of union', async () => {
    const account = await seedAccount()
    localStorage.setItem('srv:aiagent:inst_1:opencode-hidden-directories', JSON.stringify(['/local-only']))
    localStorage.setItem(
      SYNC_STAMPS_KEY,
      JSON.stringify({
        stamps: { 'srv:aiagent:inst_1:opencode-hidden-directories': '2020-01-01T00:00:00.000Z' },
        known: {},
      }),
    )

    stubPreferencesFetch([
      {
        key: 'srv:aiagent:inst_1:opencode-hidden-directories',
        value: ['/server-only'],
        updatedAt: '2030-01-01T00:00:00Z',
      },
    ])

    const { pullPreferences } = await import('./preferencesSync')
    await pullPreferences(account)

    expect(JSON.parse(localStorage.getItem('srv:aiagent:inst_1:opencode-hidden-directories') || '[]')).toEqual([
      '/server-only',
    ])
  })

  it('blocks a deleted entry from being resurrected through the union', async () => {
    const account = await seedAccount()
    localStorage.setItem(
      'opencode-pinned-sessions',
      JSON.stringify([{ sessionId: 'keep', directory: '/keep', title: 'Keep' }]),
    )
    localStorage.setItem(TOMBSTONES_KEY, JSON.stringify({ 'opencode-pinned-sessions': { dead: Date.now() } }))

    stubPreferencesFetch([
      {
        key: 'opencode-pinned-sessions',
        value: [
          { sessionId: 'dead', directory: '/dead', title: 'Dead' },
          { sessionId: 'keep', directory: '/keep', title: 'Keep' },
        ],
        updatedAt: '2030-01-01T00:00:00Z',
      },
    ])

    const { pullPreferences } = await import('./preferencesSync')
    await pullPreferences(account)

    const merged = JSON.parse(localStorage.getItem('opencode-pinned-sessions') || '[]')
    expect(merged.map((entry: { sessionId: string }) => entry.sessionId)).toEqual(['keep'])
  })

  it('blocks a per-server deleted entry from being resurrected', async () => {
    const account = await seedAccount()
    const key = 'srv:aiagent:inst_1:opencode-pinned-sessions'
    localStorage.setItem(key, JSON.stringify([{ sessionId: 'keep', directory: '/keep', title: 'Keep' }]))
    localStorage.setItem(TOMBSTONES_KEY, JSON.stringify({ [key]: { dead: Date.now() } }))

    stubPreferencesFetch([
      {
        key,
        value: [
          { sessionId: 'dead', directory: '/dead', title: 'Dead' },
          { sessionId: 'keep', directory: '/keep', title: 'Keep' },
        ],
        updatedAt: '2030-01-01T00:00:00Z',
      },
    ])

    const { pullPreferences } = await import('./preferencesSync')
    await pullPreferences(account)

    const merged = JSON.parse(localStorage.getItem(key) || '[]')
    expect(merged.map((entry: { sessionId: string }) => entry.sessionId)).toEqual(['keep'])
  })

  it('drops expired tombstones', async () => {
    const account = await seedAccount()
    localStorage.setItem('opencode-pinned-sessions', JSON.stringify([]))
    localStorage.setItem(
      TOMBSTONES_KEY,
      JSON.stringify({ 'opencode-pinned-sessions': { expired: Date.now() - 31 * 24 * 60 * 60 * 1000 } }),
    )

    stubPreferencesFetch([
      {
        key: 'opencode-pinned-sessions',
        value: [{ sessionId: 'expired', directory: '/e', title: 'E' }],
        updatedAt: '2030-01-01T00:00:00Z',
      },
    ])

    const { pullPreferences } = await import('./preferencesSync')
    await pullPreferences(account)

    const merged = JSON.parse(localStorage.getItem('opencode-pinned-sessions') || '[]')
    expect(merged.map((entry: { sessionId: string }) => entry.sessionId)).toEqual(['expired'])
  })

  it('records a tombstone when an entry is removed locally', async () => {
    await seedAccount()
    const snapshot = JSON.stringify({
      'opencode-pinned-sessions': JSON.stringify([
        { sessionId: 'a', directory: '/a', title: 'A' },
        { sessionId: 'b', directory: '/b', title: 'B' },
      ]),
    })
    localStorage.setItem(SYNC_STAMPS_KEY, JSON.stringify({ stamps: {}, known: { __snapshot__: snapshot } }))
    localStorage.setItem(
      'opencode-pinned-sessions',
      JSON.stringify([{ sessionId: 'a', directory: '/a', title: 'A' }]),
    )

    let sentBody: Record<string, unknown> | null = null
    stubPreferencesFetch([], (_url, body) => {
      sentBody = body
    })

    const { pushPreferences } = await import('./preferencesSync')
    await pushPreferences()

    const tombstones = JSON.parse(localStorage.getItem(TOMBSTONES_KEY) || '{}')
    expect(tombstones['opencode-pinned-sessions'].b).toBeTypeOf('number')
    expect(tombstones['opencode-pinned-sessions'].a).toBeUndefined()
    const values = (sentBody as unknown as { values: Record<string, unknown> }).values
    expect(values['opencode-pinned-sessions']).toEqual([{ sessionId: 'a', directory: '/a', title: 'A' }])
  })

  it('records a tombstone when the last entry is removed and the key disappears', async () => {
    await seedAccount()
    const key = 'srv:aiagent:inst_1:opencode-pinned-sessions'
    const snapshot = JSON.stringify({
      [key]: JSON.stringify([{ sessionId: 'only', directory: '/only', title: 'Only' }]),
    })
    localStorage.setItem(SYNC_STAMPS_KEY, JSON.stringify({ stamps: {}, known: { __snapshot__: snapshot } }))
    localStorage.removeItem(key)

    stubPreferencesFetch([], () => {})

    const { pushPreferences } = await import('./preferencesSync')
    await pushPreferences()

    const tombstones = JSON.parse(localStorage.getItem(TOMBSTONES_KEY) || '{}')
    expect(tombstones[key].only).toBeTypeOf('number')
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

  it('skips values over the server per-value limit instead of failing the batch', async () => {
    // 服务端单值上限 256 KB，超限返回 413 且整批失败；采集阶段就应剔除超限键。
    const { collectLocalPreferences, withinValueLimit } = await import('./preferencesSync')

    const huge = 'x'.repeat(257 * 1024)
    localStorage.setItem('font-scale', '0.1')
    localStorage.setItem('theme-custom-css', huge)

    expect(withinValueLimit(huge)).toBe(false)
    expect(withinValueLimit('small')).toBe(true)

    const entries = collectLocalPreferences()
    expect(entries['font-scale']).toBe('0.1')
    expect(entries['theme-custom-css']).toBeUndefined()
  })

  it('keeps the request body under the server 1MB limit', async () => {
    await seedAccount()
    // 服务端 decodeJSON 用 io.LimitReader(1MB) 读取，超限时会在 JSON 中途截断并
    // 报 "invalid JSON body"（掩盖真实原因）。这里构造一个整体超限的载荷，
    // 断言实际发出的请求体仍在 1MB 内。
    const big = 'y'.repeat(240 * 1024)
    localStorage.setItem('font-scale', '0.1')
    localStorage.setItem('theme-custom-css', big)
    localStorage.setItem('opencode-keybindings', JSON.stringify({ k: big }))
    localStorage.setItem('sidebar-width', big)
    localStorage.setItem('i18nextLng', 'zh-CN')

    let sentBody = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/api/aiagent/auth/login')) {
          return new Response(JSON.stringify({ success: true, data: { token: 'tok-sync' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.includes('/api/aiagent/preferences') && init?.method === 'PUT') {
          sentBody = String(init.body)
        }
        return new Response(JSON.stringify({ success: true, data: { written: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const { login } = await import('./aiagent')
    const account = await login('panel.example.com', 'salen', 'secret-pass-1')
    const { pushPreferences } = await import('./preferencesSync')
    await pushPreferences(account, true)

    expect(sentBody.length).toBeGreaterThan(0)
    const bytes = new TextEncoder().encode(sentBody).length
    expect(bytes).toBeLessThanOrEqual(1024 * 1024)

    // 小键必须在裁剪后留下，不能被整体丢弃。
    expect(JSON.parse(sentBody).values['i18nextLng']).toBe('zh-CN')
  })

  it('does not send an empty payload when no key is syncable', async () => {
    // 服务端拒绝空 values（400 "values required"），客户端应在本地短路。
    let putCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/api/aiagent/auth/login')) {
          return new Response(JSON.stringify({ success: true, data: { token: 'tok-sync' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (init?.method === 'PUT') putCalls += 1
        return new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const { login } = await import('./aiagent')
    const account = await login('panel.example.com', 'salen', 'secret-pass-1')
    const { pushPreferences } = await import('./preferencesSync')
    const written = await pushPreferences(account, true)

    expect(written).toBe(0)
    expect(putCalls).toBe(0)
  })
})
