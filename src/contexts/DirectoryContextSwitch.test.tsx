import { act, render } from '@testing-library/react'
import { useContext, useEffect, type ContextType } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectoryContext } from './DirectoryContext.shared'
import { DirectoryProvider } from './DirectoryContext'

/**
 * 用真实的内存版 serverStorage 模拟两台服务器的桶，
 * 以便验证「新建 → 切换服务器 → 切回」的完整路径。
 *
 * 这些状态必须在 vi.hoisted 中初始化：vi.mock 的工厂会被提升到文件顶部，
 * 工厂执行时普通 const 还没初始化（Cannot access before initialization）。
 */
const { buckets, serverChangeListeners, serverState, setJSONForMock, setJSONMock } = vi.hoisted(() => ({
  buckets: new Map<string, string>(),
  serverChangeListeners: [] as Array<(id: string, reason: string) => void>,
  serverState: { activeServerId: 'aiagent:inst_work' },
  setJSONForMock: vi.fn(),
  setJSONMock: vi.fn(),
}))


function makeKey(key: string, serverId?: string) {
  return `srv:${serverId ?? serverState.activeServerId}:${key}`
}

vi.mock('../utils', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils')>()
  return {
    ...actual,
    serverStorage: {
      get: (key: string) => buckets.get(makeKey(key)) ?? null,
      getJSON: <T,>(key: string) => {
        const raw = buckets.get(makeKey(key))
        return raw ? (JSON.parse(raw) as T) : null
      },
      set: (key: string, value: string) => {
        buckets.set(makeKey(key), value)
        setJSONMock(key, value)
      },
      setJSON: (key: string, value: unknown) => {
        buckets.set(makeKey(key), JSON.stringify(value))
        setJSONMock(key, value)
      },
      getFor: (key: string, serverId: string) => buckets.get(makeKey(key, serverId)) ?? null,
      getJSONFor: <T,>(key: string, serverId: string) => {
        const raw = buckets.get(makeKey(key, serverId))
        return raw ? (JSON.parse(raw) as T) : null
      },
      setFor: (key: string, value: string, serverId: string) => {
        buckets.set(makeKey(key, serverId), value)
      },
      setJSONFor: (key: string, value: unknown, serverId: string) => {
        buckets.set(makeKey(key, serverId), JSON.stringify(value))
        setJSONForMock(key, value, serverId)
      },
    },
  }
})

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => serverState.activeServerId,
    onServerChange: (fn: (id: string, reason: string) => void) => {
      serverChangeListeners.push(fn)
      return () => {
        const i = serverChangeListeners.indexOf(fn)
        if (i >= 0) serverChangeListeners.splice(i, 1)
      }
    },
  },
  LOCAL_SERVER_ID: 'local',
}))

vi.mock('../store/layoutStore', () => ({
  layoutStore: { setSidebarExpanded: vi.fn() },
  useLayoutStore: () => ({ sidebarExpanded: true }),
}))

vi.mock('../store/multiServerStore', () => ({
  multiServerStore: { getFocusedServerId: () => serverState.activeServerId },
  useMultiServerStore: () => ({}),
}))

vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({
    directory: undefined,
    setDirectory: vi.fn(),
    navigateToSession: vi.fn(),
    replaceSession: vi.fn(),
  }),
}))

vi.mock('../utils/tauri', () => ({ isTauri: () => false }))

describe('DirectoryContext across a server switch', () => {
  let latest: ContextType<typeof DirectoryContext> = null

  function Probe() {
    const value = useContext(DirectoryContext)
    useEffect(() => {
      latest = value
    }, [value])
    return null
  }

  beforeEach(() => {
    localStorage.clear()
    buckets.clear()
    serverChangeListeners.length = 0
    serverState.activeServerId = 'aiagent:inst_work'
    setJSONForMock.mockReset()
    setJSONMock.mockReset()
  })

  it('keeps a project added on server A after switching to B and back to A', async () => {
    render(
      <DirectoryProvider>
        <Probe />
      </DirectoryProvider>,
    )

    // 在 A 上新建项目
    await act(async () => {
      latest?.addDirectory('D:/Code/OnWork')
    })
    expect(latest?.savedDirectories.map(d => d.path)).toContain('D:/Code/OnWork')

    // 切到 B
    serverState.activeServerId = 'aiagent:inst_laptop'
    await act(async () => {
      serverChangeListeners.forEach(fn => fn('aiagent:inst_laptop', 'server-switch'))
    })
    // B 上应为空（各主机各看各的）
    expect(latest?.savedDirectories).toEqual([])

    // 切回 A
    serverState.activeServerId = 'aiagent:inst_work'
    await act(async () => {
      serverChangeListeners.forEach(fn => fn('aiagent:inst_work', 'server-switch'))
    })
    // A 上的项目必须还在
    expect(latest?.savedDirectories.map(d => d.path)).toEqual(['D:/Code/OnWork'])
  })

  it('does not write A data into B bucket during the switch', async () => {
    render(
      <DirectoryProvider>
        <Probe />
      </DirectoryProvider>,
    )

    await act(async () => {
      latest?.addDirectory('D:/Code/OnWork')
    })

    serverState.activeServerId = 'aiagent:inst_laptop'
    await act(async () => {
      serverChangeListeners.forEach(fn => fn('aiagent:inst_laptop', 'server-switch'))
    })

    // A 桶内容不受影响
    const workBucket = buckets.get('srv:aiagent:inst_work:opencode-saved-directories')
    expect(JSON.parse(workBucket || '[]').map((d: { path: string }) => d.path)).toEqual(['D:/Code/OnWork'])
    // B 桶没有被写入 A 的内容
    const laptopBucket = buckets.get('srv:aiagent:inst_laptop:opencode-saved-directories')
    expect(JSON.parse(laptopBucket || '[]')).toEqual([])
  })
})
