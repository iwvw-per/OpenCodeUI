import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventCallbacks } from '../types/api/event'
import { useSessions } from './useSessions'
import { sessionListIndexStore } from '../store/sessionListIndexStore'
import { sessionActivityStore } from '../store/sessionActivityStore'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any
const {
  getSessionsMock,
  createSessionMock,
  deleteSessionMock,
  subscribeToEventsMock,
  onServerChangeMock,
  serverState,
} = vi.hoisted(() => ({
  getSessionsMock: vi.fn<AnyFn>(),
  createSessionMock: vi.fn<AnyFn>(),
  deleteSessionMock: vi.fn<AnyFn>(),
  subscribeToEventsMock: vi.fn<AnyFn>(),
  onServerChangeMock: vi.fn<AnyFn>(() => () => {}),
  serverState: { activeServerId: 'local', listeners: new Set<() => void>() },
}))
let latestEventCallbacks: Partial<EventCallbacks> = {}

vi.mock('../api', () => ({
  getSessions: (...args: unknown[]) => getSessionsMock(...args),
  createSession: (...args: unknown[]) => createSessionMock(...args),
  deleteSession: (...args: unknown[]) => deleteSessionMock(...args),
  subscribeToEvents: (...args: unknown[]) => subscribeToEventsMock(...args),
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    onServerChange: (...args: unknown[]) => onServerChangeMock(...args),
    getActiveServerId: () => serverState.activeServerId,
    subscribe: (fn: () => void) => {
      serverState.listeners.add(fn)
      return () => serverState.listeners.delete(fn)
    },
  },
}))

function makeSession(id: string, directory = '/workspace/demo') {
  return {
    id,
    slug: id,
    projectID: 'project-1',
    directory,
    title: `Session ${id}`,
    version: '1',
    time: {
      created: 1,
      updated: 2,
    },
  }
}

describe('useSessions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 索引是模块级长驻 store：不清会跨用例串数据
    sessionListIndexStore.reset()
    serverState.activeServerId = 'local'
    getSessionsMock.mockReset()
    createSessionMock.mockReset()
    deleteSessionMock.mockReset()
    subscribeToEventsMock.mockReset()
    onServerChangeMock.mockReset()
    getSessionsMock.mockResolvedValue([])
    createSessionMock.mockResolvedValue(makeSession('new'))
    deleteSessionMock.mockResolvedValue(true)
    latestEventCallbacks = {}
    subscribeToEventsMock.mockImplementation((callbacks: EventCallbacks) => {
      latestEventCallbacks = callbacks
      return vi.fn()
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    // 锚点是全局 store 状态，重置避免污染后续用例
    sessionActivityStore.reset()
  })

  it('waits for enabled before fetching', async () => {
    const { rerender } = renderHook(({ enabled }) => useSessions({ directory: '/workspace/demo', enabled }), {
      initialProps: { enabled: false },
    })

    expect(getSessionsMock).not.toHaveBeenCalled()

    rerender({ enabled: true })

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    // limit 比 pageSize 多 1：多取一条用于判断是否还有更多
    expect(getSessionsMock).toHaveBeenCalledWith(
      {
        roots: true,
        limit: 21,
        directory: '/workspace/demo',
      },
      undefined,
    )
  })

  it('passes the scoped directory when removing a session', async () => {
    getSessionsMock.mockResolvedValue([makeSession('session-1')])

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(result.current.sessions).toHaveLength(1)

    await act(async () => {
      await result.current.remove('session-1')
    })

    expect(deleteSessionMock).toHaveBeenCalledWith('session-1', '/workspace/demo', undefined)
  })

  it('reflects realtime created sessions routed into the index', async () => {
    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    // 非搜索态的增量由 useGlobalEvents 统一写入索引，这里直接驱动 store 模拟
    await act(async () => {
      sessionListIndexStore.applySessionChanged('local', makeSession('session-1'))
      sessionListIndexStore.applySessionChanged('local', makeSession('session-ignored', '/workspace/other'))
      sessionListIndexStore.applySessionChanged('local', { ...makeSession('session-child'), parentID: 'parent-1' })
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-1'])
  })

  it('updates a session in place without changing its position', async () => {
    getSessionsMock.mockResolvedValue([makeSession('session-a'), makeSession('session-b'), makeSession('session-c')])

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-a', 'session-b', 'session-c'])

    await act(async () => {
      sessionListIndexStore.applySessionChanged('local', { ...makeSession('session-b'), title: 'Renamed' })
    })

    // 内容更新了，但位置不动
    expect(result.current.sessions.map(session => session.id)).toEqual(['session-a', 'session-b', 'session-c'])
    expect(result.current.sessions[1].title).toBe('Renamed')
  })

  it('inserts a session that is not in the list yet at its sorted position', async () => {
    getSessionsMock.mockResolvedValue([{ ...makeSession('session-a'), time: { created: 1, updated: 100 } }])

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    // 默认按更新时间倒序：更新的会话排在最前
    await act(async () => {
      sessionListIndexStore.applySessionChanged('local', {
        ...makeSession('session-new'),
        time: { created: 2, updated: 200 },
      })
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-new', 'session-a'])
  })

  it('sorts fetched sessions by anchor time descending (newest first)', async () => {
    getSessionsMock.mockResolvedValue([
      { ...makeSession('session-old'), time: { created: 1, updated: 10 } },
      { ...makeSession('session-new'), time: { created: 2, updated: 30 } },
      { ...makeSession('session-mid'), time: { created: 3, updated: 20 } },
    ])

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(result.current.sessions.map(session => session.id)).toEqual([
      'session-new',
      'session-mid',
      'session-old',
    ])
  })

  it('re-sorts the existing list when a session anchor is raised', async () => {
    getSessionsMock.mockResolvedValue([
      { ...makeSession('session-old'), time: { created: 1, updated: 10 } },
      { ...makeSession('session-new'), time: { created: 2, updated: 30 } },
    ])

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-new', 'session-old'])

    // 旧会话收到更新的用户消息锚点：立即置顶，不必等下次拉取
    await act(async () => {
      sessionActivityStore.recordActivity('session-old', 99)
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-old', 'session-new'])
  })

  it('ignores a stale anchor that is older than the recorded one', async () => {
    getSessionsMock.mockResolvedValue([
      { ...makeSession('session-old'), time: { created: 1, updated: 10 } },
      { ...makeSession('session-new'), time: { created: 2, updated: 30 } },
    ])

    await act(async () => {
      sessionActivityStore.recordActivity('session-old', 99)
    })

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-old', 'session-new'])

    // 迟到的旧锚点不应把顺序降回去
    await act(async () => {
      sessionActivityStore.recordActivity('session-old', 5)
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-old', 'session-new'])
  })

  it('does not report hasMore when the server returns exactly the page size', async () => {
    // pageSize=2：服务端只有 2 条，返回 2 条（= pageSize）。
    // 旧实现用 data.length >= limit 判断，会误判为「还有更多」，
    // 于是多出一个点了没反应的「展开更多会话」按钮。
    getSessionsMock.mockResolvedValue([makeSession('session-a'), makeSession('session-b')])

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo', pageSize: 2 }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-a', 'session-b'])
    expect(result.current.hasMore).toBe(false)
  })

  it('reports hasMore and trims the extra probe row when more exist', async () => {
    // pageSize=2，服务端有 3 条：多取的第 3 条只用于判断，不进列表
    getSessionsMock.mockResolvedValue([
      makeSession('session-a'),
      makeSession('session-b'),
      makeSession('session-c'),
    ])

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo', pageSize: 2 }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-a', 'session-b'])
    expect(result.current.hasMore).toBe(true)
  })

  it('queues a reconnect refresh while a newer request is still in flight', async () => {
    const firstRequest = createDeferred<ReturnType<typeof makeSession>[]>()
    const secondRequest = createDeferred<ReturnType<typeof makeSession>[]>()
    const thirdRequest = createDeferred<ReturnType<typeof makeSession>[]>()

    getSessionsMock
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise)
      .mockImplementationOnce(() => thirdRequest.promise)

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    act(() => {
      result.current.setSearch('branch')
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })

    await act(async () => {
      firstRequest.resolve([makeSession('session-1')])
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      latestEventCallbacks.onReconnected?.('network')
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      secondRequest.resolve([makeSession('session-2')])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(3)

    await act(async () => {
      thirdRequest.resolve([makeSession('session-3')])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-3'])
  })

  it('retries the initial fetch after a startup failure', async () => {
    getSessionsMock
      .mockRejectedValueOnce(new Error('service not ready'))
      .mockResolvedValueOnce([makeSession('session-1')])

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runOnlyPendingTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(2)
    expect(result.current.sessions.map(session => session.id)).toEqual(['session-1'])
  })

  it('refetches on server endpoint changes even while the old request is in flight', async () => {
    const staleRequest = createDeferred<ReturnType<typeof makeSession>[]>()
    const freshRequest = createDeferred<ReturnType<typeof makeSession>[]>()

    getSessionsMock
      .mockImplementationOnce(() => staleRequest.promise)
      .mockImplementationOnce(() => freshRequest.promise)

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      // 切换活动服务器：index 按 serverId 分桶，新桶为空 → 触发拉取
      serverState.activeServerId = 'remote'
      serverState.listeners.forEach(fn => fn())
      await Promise.resolve()
    })

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      freshRequest.resolve([makeSession('fresh')])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['fresh'])

    await act(async () => {
      staleRequest.resolve([makeSession('stale')])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['fresh'])
  })

  it('keeps the existing list visible while a reconnect refresh is in flight', async () => {
    const pending = createDeferred<ReturnType<typeof makeSession>[]>()
    getSessionsMock.mockResolvedValueOnce([makeSession('session-1')]).mockImplementationOnce(() => pending.promise)

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-1'])

    await act(async () => {
      latestEventCallbacks.onReconnected?.('network')
      await Promise.resolve()
    })

    // 静默刷新：请求在途时旧列表仍在屏上，且没有打回 loading
    expect(result.current.sessions.map(session => session.id)).toEqual(['session-1'])
    expect(result.current.isLoading).toBe(false)

    await act(async () => {
      pending.resolve([makeSession('session-2')])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-2'])
  })

  describe('multi-directory aggregation', () => {
    const DIRS = ['/repo/root', '/repo/worktree-a', '/repo/worktree-b']

    it('fetches every directory and merges results sorted by anchor', async () => {
      getSessionsMock.mockImplementation((params: { directory?: string }) => {
        if (params.directory === '/repo/root') {
          return Promise.resolve([{ ...makeSession('root-1'), directory: '/repo/root', time: { created: 1, updated: 30 } }])
        }
        if (params.directory === '/repo/worktree-a') {
          return Promise.resolve([{ ...makeSession('a-1'), directory: '/repo/worktree-a', time: { created: 2, updated: 20 } }])
        }
        return Promise.resolve([{ ...makeSession('b-1'), directory: '/repo/worktree-b', time: { created: 3, updated: 10 } }])
      })

      const { result } = renderHook(() => useSessions({ directories: DIRS }))

      await act(async () => {
        vi.runAllTimers()
        await Promise.resolve()
      })

      expect(getSessionsMock).toHaveBeenCalledTimes(3)
      // 每个目录各拉一次，均带多取一条的 limit
      for (const dir of DIRS) {
        expect(getSessionsMock).toHaveBeenCalledWith(
          expect.objectContaining({ directory: dir, limit: 21 }),
          undefined,
        )
      }
      // 合并后按锚点时间倒序
      expect(result.current.sessions.map(session => session.id)).toEqual(['root-1', 'a-1', 'b-1'])
    })

    it('deduplicates sessions that appear in more than one directory', async () => {
      const shared = { ...makeSession('shared'), directory: '/repo/root' }
      getSessionsMock.mockImplementation((params: { directory?: string }) =>
        Promise.resolve(params.directory === '/repo/root' ? [shared] : [shared]),
      )

      const { result } = renderHook(() => useSessions({ directories: ['/repo/root', '/repo/worktree-a'] }))

      await act(async () => {
        vi.runAllTimers()
        await Promise.resolve()
      })

      expect(result.current.sessions.map(session => session.id)).toEqual(['shared'])
    })

    it('reports hasMore when any directory has more than the page size', async () => {
      getSessionsMock.mockImplementation((params: { directory?: string }) => {
        if (params.directory === '/repo/root') {
          return Promise.resolve([makeSession('r1'), makeSession('r2'), makeSession('r3')])
        }
        return Promise.resolve([makeSession('a1')])
      })

      const { result } = renderHook(() =>
        useSessions({ directories: ['/repo/root', '/repo/worktree-a'], pageSize: 2 }),
      )

      await act(async () => {
        vi.runAllTimers()
        await Promise.resolve()
      })

      expect(result.current.hasMore).toBe(true)
      // root 只保留 pageSize 条，多取的那条不进列表
      expect(result.current.sessions.map(session => session.id).sort()).toEqual(['a1', 'r1', 'r2'])
    })

    it('routes realtime created sessions into the correct directory bucket', async () => {
      getSessionsMock.mockResolvedValue([])

      const { result } = renderHook(() => useSessions({ directories: DIRS }))

      await act(async () => {
        vi.runAllTimers()
        await Promise.resolve()
      })

      await act(async () => {
        sessionListIndexStore.applySessionChanged('local', {
          ...makeSession('wt-a'),
          directory: '/repo/worktree-a',
        })
        sessionListIndexStore.applySessionChanged('local', {
          ...makeSession('outside'),
          directory: '/repo/elsewhere',
        })
      })

      expect(result.current.sessions.map(session => session.id)).toEqual(['wt-a'])
    })
  })
})
