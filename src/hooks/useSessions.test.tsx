import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventCallbacks } from '../types/api/event'
import { useSessions } from './useSessions'
import { layoutStore } from '../store/layoutStore'

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
} = vi.hoisted(() => ({
  getSessionsMock: vi.fn<AnyFn>(),
  createSessionMock: vi.fn<AnyFn>(),
  deleteSessionMock: vi.fn<AnyFn>(),
  subscribeToEventsMock: vi.fn<AnyFn>(),
  onServerChangeMock: vi.fn<AnyFn>(() => () => {}),
}))
let latestEventCallbacks: Partial<EventCallbacks> = {}
let latestServerChange: (() => void) | undefined

vi.mock('../api', () => ({
  getSessions: (...args: unknown[]) => getSessionsMock(...args),
  createSession: (...args: unknown[]) => createSessionMock(...args),
  deleteSession: (...args: unknown[]) => deleteSessionMock(...args),
  subscribeToEvents: (...args: unknown[]) => subscribeToEventsMock(...args),
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    onServerChange: (...args: unknown[]) => onServerChangeMock(...args),
    getActiveServerId: () => 'local',
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
    getSessionsMock.mockReset()
    createSessionMock.mockReset()
    deleteSessionMock.mockReset()
    subscribeToEventsMock.mockReset()
    onServerChangeMock.mockReset()
    getSessionsMock.mockResolvedValue([])
    createSessionMock.mockResolvedValue(makeSession('new'))
    deleteSessionMock.mockResolvedValue(true)
    latestEventCallbacks = {}
    latestServerChange = undefined
    subscribeToEventsMock.mockImplementation((callbacks: EventCallbacks) => {
      latestEventCallbacks = callbacks
      return vi.fn()
    })
    onServerChangeMock.mockImplementation((listener: () => void) => {
      latestServerChange = listener
      return vi.fn()
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    // 排序偏好是全局 store 状态，重置避免污染后续用例
    layoutStore.setSidebarSessionSort('updated', true)
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

    expect(getSessionsMock).toHaveBeenCalledWith(
      {
        roots: true,
        limit: 20,
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

  it('adds matching sessions from realtime events immediately', async () => {
    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    await act(async () => {
      latestEventCallbacks.onSessionCreated?.(makeSession('session-1'))
      latestEventCallbacks.onSessionCreated?.(makeSession('session-ignored', '/workspace/other'))
      latestEventCallbacks.onSessionCreated?.({ ...makeSession('session-child'), parentID: 'parent-1' })
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
      latestEventCallbacks.onSessionUpdated?.({ ...makeSession('session-b'), title: 'Renamed' })
    })

    // 内容更新了，但位置不动
    expect(result.current.sessions.map(session => session.id)).toEqual(['session-a', 'session-b', 'session-c'])
    expect(result.current.sessions[1].title).toBe('Renamed')
  })

  it('keeps the list stable when two sessions update alternately', async () => {
    getSessionsMock.mockResolvedValue([makeSession('session-a'), makeSession('session-b')])

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    // 并行会话的 session.updated 是交替到达的；早先的实现每次置顶，
    // 导致这两项在列表里来回跳
    await act(async () => {
      for (let i = 0; i < 4; i += 1) {
        latestEventCallbacks.onSessionUpdated?.(makeSession('session-a'))
        latestEventCallbacks.onSessionUpdated?.(makeSession('session-b'))
      }
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-a', 'session-b'])
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
      latestEventCallbacks.onSessionUpdated?.({
        ...makeSession('session-new'),
        time: { created: 2, updated: 200 },
      })
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-new', 'session-a'])
  })

  it('sorts fetched sessions by updated descending by default', async () => {
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

  it('re-sorts the existing list when the sort preference changes', async () => {
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

    // 切到正序：立即就地重排，不必等下次拉取
    await act(async () => {
      layoutStore.setSidebarSessionSort('updated', false)
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-old', 'session-new'])
  })

  it('sorts by created time when the preference says so', async () => {
    getSessionsMock.mockResolvedValue([
      { ...makeSession('session-a'), time: { created: 30, updated: 1 } },
      { ...makeSession('session-b'), time: { created: 10, updated: 2 } },
    ])

    await act(async () => {
      layoutStore.setSidebarSessionSort('created', false)
    })

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    // 按创建时间正序
    expect(result.current.sessions.map(session => session.id)).toEqual(['session-b', 'session-a'])
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
      latestServerChange?.()
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
})
