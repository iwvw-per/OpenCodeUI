import { beforeEach, describe, expect, it, vi } from 'vitest'

const TOMBSTONES_KEY = 'opencode-preferences-sync-tombstones'
const SYNC_STAMPS_KEY = 'opencode-preferences-sync-stamps'
const KEY = 'srv:aiagent:inst_work:opencode-saved-directories'

// 用贴近真实的时间戳：墓碑有 30 天 TTL，1970 年的时间戳会被直接过期丢弃，
// 那样测出来的「通过」是假象。
const T0 = Date.now() - 60_000

describe('re-adding a project that has a tombstone', () => {
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
          return new Response(JSON.stringify({ success: true, data: { token: 'tok' } }), { status: 200 })
        }
        return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
      }),
    )
    return login('panel.example.com', 'salen', 'secret-pass-1')
  }

  function stubServer(initial: unknown[]) {
    let serverValue = initial
    const puts: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as { values: Record<string, unknown> }
          puts.push(body.values)
          if (KEY in body.values) serverValue = body.values[KEY] as unknown[]
          return new Response(JSON.stringify({ success: true, data: { written: Object.keys(body.values) } }), {
            status: 200,
          })
        }
        if (url.includes('/api/aiagent/preferences')) {
          return new Response(
            JSON.stringify({
              success: true,
              data: serverValue.length ? [{ key: KEY, value: serverValue, updatedAt: new Date().toISOString() }] : [],
            }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
      }),
    )
    return { puts, serverValue: () => serverValue }
  }

  async function setup() {
    const account = await seedAccount()
    const { serverStore } = await import('../store/serverStore')
    serverStore.addServerWithId('aiagent:inst_work', { name: 'work', url: 'https://p.example.com/gw/inst_work' })
    serverStore.setActiveServer('aiagent:inst_work')
    return account
  }

  it('keeps a project the user re-added after deleting it', async () => {
    // 用户删掉项目 → 记墓碑；随后重新添加同一路径（addedAt 晚于墓碑）。
    // 若墓碑不清除，push 会过滤掉该条目并回写本地，项目立刻消失
    // —— 表现为「新建项目无法保存，删除却能同步」。
    const account = await setup()
    const A = { path: 'D:/Code/API-Monitor', name: 'API-Monitor', addedAt: T0 }
    const P = { path: 'D:/Code/QK70005', name: 'QK70005', addedAt: T0 + 10_000 }

    localStorage.setItem(TOMBSTONES_KEY, JSON.stringify({ [KEY]: { [P.path]: T0 + 5_000 } }))
    localStorage.setItem(
      SYNC_STAMPS_KEY,
      JSON.stringify({ stamps: {}, known: { __snapshot__: JSON.stringify({ [KEY]: JSON.stringify([A]) }) } }),
    )
    localStorage.setItem(KEY, JSON.stringify([A, P]))

    const srv = stubServer([A])
    const { syncPreferences } = await import('./preferencesSync')
    await syncPreferences(account, true)

    const after = JSON.parse(localStorage.getItem(KEY) || '[]')
    expect(after.map((e: { path: string }) => e.path)).toContain('D:/Code/QK70005')
    expect((srv.serverValue() as Array<{ path: string }>).map(e => e.path)).toContain('D:/Code/QK70005')

    const tombs = JSON.parse(localStorage.getItem(TOMBSTONES_KEY) || '{}')
    expect(tombs[KEY]?.['D:/Code/QK70005']).toBeUndefined()
  })

  it('still honours a tombstone for an item the user has NOT re-added', async () => {
    // 反例：墓碑之后没有再添加（addedAt 早于墓碑），必须继续过滤，
    // 不能因为修复「重新添加」而让已删条目复活。
    const account = await setup()
    const A = { path: 'D:/Code/API-Monitor', name: 'API-Monitor', addedAt: T0 }
    const Dead = { path: 'D:/Code/Dead', name: 'Dead', addedAt: T0 }

    localStorage.setItem(TOMBSTONES_KEY, JSON.stringify({ [KEY]: { [Dead.path]: T0 + 5_000 } }))
    localStorage.setItem(
      SYNC_STAMPS_KEY,
      JSON.stringify({ stamps: {}, known: { __snapshot__: JSON.stringify({ [KEY]: JSON.stringify([A]) }) } }),
    )
    localStorage.setItem(KEY, JSON.stringify([A, Dead]))

    const srv = stubServer([A, Dead])
    const { syncPreferences } = await import('./preferencesSync')
    await syncPreferences(account, true)

    const after = JSON.parse(localStorage.getItem(KEY) || '[]')
    expect(after.map((e: { path: string }) => e.path)).not.toContain('D:/Code/Dead')
    // 墓碑仍在（30 天 TTL 内继续生效）
    const tombs = JSON.parse(localStorage.getItem(TOMBSTONES_KEY) || '{}')
    expect(tombs[KEY]?.['D:/Code/Dead']).toBeGreaterThan(0)
    // 也不应把它推给服务端
    expect((srv.serverValue() as Array<{ path: string }>).map(e => e.path)).not.toContain('D:/Code/Dead')
  })

  it('keeps a freshly added project when no tombstone exists', async () => {
    const account = await setup()
    const P = { path: 'D:/Code/BrandNew', name: 'BrandNew', addedAt: Date.now() }
    localStorage.setItem(SYNC_STAMPS_KEY, JSON.stringify({ stamps: {}, known: {} }))
    localStorage.setItem(KEY, JSON.stringify([P]))

    const srv = stubServer([])
    const { syncPreferences } = await import('./preferencesSync')
    await syncPreferences(account, true)

    expect(JSON.parse(localStorage.getItem(KEY) || '[]').map((e: { path: string }) => e.path)).toEqual([
      'D:/Code/BrandNew',
    ])
    expect((srv.serverValue() as Array<{ path: string }>).map(e => e.path)).toEqual(['D:/Code/BrandNew'])
  })
})
