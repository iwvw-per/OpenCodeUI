import { beforeEach, describe, expect, it, vi } from 'vitest'

const SYNC_STAMPS_KEY = 'opencode-preferences-sync-stamps'

describe('preferences pull notifies UI subscribers', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  async function seedAccount() {
    const { login } = await import('./aiagent')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/api/aiagent/auth/login')) {
          return new Response(JSON.stringify({ success: true, data: { token: 'tok' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
    return login('panel.example.com', 'salen', 'secret-pass-1')
  }

  it('notifies subscribers when a pull actually writes local values', async () => {
    // 回归：同步引擎直接写 localStorage，若不显式通知，DirectoryContext 的
    // savedDirectories 停在初始化快照，界面看起来「同步没生效」。
    const account = await seedAccount()
    const { subscribePerServerStorageVersion } = await import('../utils/perServerStorage')

    let notified = 0
    subscribePerServerStorageVersion(() => {
      notified += 1
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (init?.method === 'PUT') {
          return new Response(JSON.stringify({ success: true, data: { written: [] } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.includes('/api/aiagent/preferences')) {
          return new Response(
            JSON.stringify({
              success: true,
              data: [
                {
                  key: 'srv:aiagent:inst_work:opencode-saved-directories',
                  value: [{ path: 'D:/Code/API-Monitor', name: 'API-Monitor', addedAt: 1 }],
                  updatedAt: '2030-01-01T00:00:00Z',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    localStorage.setItem(SYNC_STAMPS_KEY, JSON.stringify({ stamps: {}, known: {} }))

    const { pullPreferences } = await import('./preferencesSync')
    const written = await pullPreferences(account)

    expect(written).toBeGreaterThan(0)
    expect(notified).toBeGreaterThan(0)
    // 数据确实落到了 localStorage
    const saved = JSON.parse(localStorage.getItem('srv:aiagent:inst_work:opencode-saved-directories') || '[]')
    expect(saved[0].path).toBe('D:/Code/API-Monitor')
  })

  it('does not notify when a pull writes nothing', async () => {
    const account = await seedAccount()
    const { subscribePerServerStorageVersion } = await import('../utils/perServerStorage')

    let notified = 0
    subscribePerServerStorageVersion(() => {
      notified += 1
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const { pullPreferences } = await import('./preferencesSync')
    const written = await pullPreferences(account)

    expect(written).toBe(0)
    expect(notified).toBe(0)
  })
})
