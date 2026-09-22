import { beforeEach, describe, expect, it, vi } from 'vitest'

const SYNC_STAMPS_KEY = 'opencode-preferences-sync-stamps'
const KEY = 'srv:aiagent:inst_work:opencode-saved-directories'

describe('preferences sync round trip (local edit vs pull)', () => {
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

  function stubServer(serverValue: unknown, onPut?: (values: Record<string, unknown>) => void) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as { values: Record<string, unknown> }
          onPut?.(body.values)
          return new Response(JSON.stringify({ success: true, data: { written: Object.keys(body.values) } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.includes('/api/aiagent/preferences')) {
          return new Response(
            JSON.stringify({
              success: true,
              data:
                serverValue === null
                  ? []
                  : [{ key: KEY, value: serverValue, updatedAt: '2030-01-01T00:00:00Z' }],
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
  }

  it('keeps a locally added project that the server has not seen yet', async () => {
    // 回归：本地新增、尚未推送时 pull，若把「本地有、服务端没有」当成删除，
    // 新增的项目会在 pull 阶段被自己删掉（表现为「新建的项目没同步、还消失了」）。
    const account = await seedAccount()
    localStorage.setItem(KEY, JSON.stringify([{ path: 'D:/Code/NewProject', name: 'NewProject', addedAt: 5 }]))
    localStorage.setItem(SYNC_STAMPS_KEY, JSON.stringify({ stamps: {}, known: {} }))

    stubServer(null) // 服务端还没有这个键

    const { pullPreferences } = await import('./preferencesSync')
    await pullPreferences(account)

    const after = JSON.parse(localStorage.getItem(KEY) || '[]')
    expect(after.map((e: { path: string }) => e.path)).toEqual(['D:/Code/NewProject'])
  })

  it('does not resurrect a locally removed project during pull', async () => {
    // 回归：本地删除后 pull，若服务端值直接参与并集，被删的条目会复活；
    // 复活后 push 阶段就看不到「删除」这个事实，墓碑记不上，删除被永久恢复。
    const account = await seedAccount()
    const entry = { path: 'D:/Code/Removed', name: 'Removed', addedAt: 1 }
    // 快照（上次同步）里有它，本地已删除
    localStorage.setItem(
      SYNC_STAMPS_KEY,
      JSON.stringify({ stamps: {}, known: { __snapshot__: JSON.stringify({ [KEY]: JSON.stringify([entry]) }) } }),
    )
    localStorage.setItem(KEY, JSON.stringify([]))

    stubServer([entry])

    const { pullPreferences } = await import('./preferencesSync')
    await pullPreferences(account)

    const after = JSON.parse(localStorage.getItem(KEY) || '[]')
    expect(after).toEqual([])
  })

  it('records the deletion and pushes it through on the following push', async () => {
    const account = await seedAccount()
    const entry = { path: 'D:/Code/Removed', name: 'Removed', addedAt: 1 }
    localStorage.setItem(
      SYNC_STAMPS_KEY,
      JSON.stringify({ stamps: {}, known: { __snapshot__: JSON.stringify({ [KEY]: JSON.stringify([entry]) }) } }),
    )
    localStorage.setItem(KEY, JSON.stringify([]))

    let pushed: Record<string, unknown> = {}
    stubServer([entry], values => {
      pushed = values
    })

    const { pullPreferences, pushPreferences } = await import('./preferencesSync')
    await pullPreferences(account)
    await pushPreferences(account, true)

    // 推送上去的是空数组（删除意图已表达），服务端 upsert 后即删除
    expect(pushed[KEY]).toEqual([])
  })

  it('still applies a genuine remote deletion', async () => {
    // 别的端删除后，本端 pull 应跟随删除（不能为了不误杀新增而丢掉真删除）。
    const account = await seedAccount()
    const entry = { path: 'D:/Code/Gone', name: 'Gone', addedAt: 1 }
    localStorage.setItem(KEY, JSON.stringify([entry]))
    localStorage.setItem(
      SYNC_STAMPS_KEY,
      JSON.stringify({ stamps: {}, known: { __snapshot__: JSON.stringify({ [KEY]: JSON.stringify([entry]) }) } }),
    )

    stubServer([]) // 服务端已无该条目

    const { pullPreferences } = await import('./preferencesSync')
    await pullPreferences(account)

    const after = JSON.parse(localStorage.getItem(KEY) || '[]')
    expect(after).toEqual([])
  })
})
