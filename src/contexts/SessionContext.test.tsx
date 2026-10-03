import { act, render } from '@testing-library/react'
import { useContext, useEffect, type ContextType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventCallbacks } from '../types/api/event'
import { SessionContext } from './SessionContext.shared'
import { SessionProvider } from './SessionContext'
import { sessionListIndexStore } from '../store/sessionListIndexStore'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

const {
  getSessionsMock,
  createSessionMock,
  deleteSessionMock,
  subscribeToEventsMock,
  clearChildrenMock,
  clearFollowupQueueMock,
  setTodosMock,
  clearSessionRuntimeStateMock,
  sessionErrorHandlerMock,
  autoDetectPathStyleMock,
  onServerChangeMock,
  serverState,
} = vi.hoisted(() => ({
  getSessionsMock: vi.fn(),
  createSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  subscribeToEventsMock: vi.fn(),
  clearChildrenMock: vi.fn(),
  clearFollowupQueueMock: vi.fn(),
  setTodosMock: vi.fn(),
  clearSessionRuntimeStateMock: vi.fn(),
  sessionErrorHandlerMock: vi.fn(),
  autoDetectPathStyleMock: vi.fn(),
  onServerChangeMock: vi.fn(),
  serverState: { activeServerId: 'local', listeners: new Set<() => void>() },
}))
let latestEventCallbacks: Partial<EventCallbacks> = {}
let latestContext: ContextType<typeof SessionContext> = null

vi.mock('../api', () => ({
  getSessions: (...args: unknown[]) => getSessionsMock(...args),
  createSession: (...args: unknown[]) => createSessionMock(...args),
  deleteSession: (...args: unknown[]) => deleteSessionMock(...args),
  subscribeToEvents: (...args: unknown[]) => subscribeToEventsMock(...args),
}))

vi.mock('./useDirectory', () => ({
  useDirectory: () => ({ currentDirectory: '/workspace/demo' }),
}))

vi.mock('../store/childSessionStore', () => ({
  childSessionStore: {
    clearChildren: clearChildrenMock,
  },
}))

vi.mock('../store/followupQueueStore', () => ({
  followupQueueStore: {
    clearSession: clearFollowupQueueMock,
  },
}))

vi.mock('../store/todoStore', () => ({
  todoStore: {
    setTodos: setTodosMock,
  },
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

// 只替换需要打桩的部分
vi.mock('../utils', () => ({
  sessionErrorHandler: (...args: unknown[]) => sessionErrorHandlerMock(...args),
  normalizeToForwardSlash: (value?: string) => value,
  isSameDirectory: (left?: string, right?: string) => left === right,
  autoDetectPathStyle: (...args: unknown[]) => autoDetectPathStyleMock(...args),
}))

vi.mock('../utils/sessionLifecycle', () => ({
  clearSessionRuntimeState: (...args: unknown[]) => clearSessionRuntimeStateMock(...args),
}))

function SessionContextProbe() {
  const context = useContext(SessionContext)

  useEffect(() => {
    latestContext = context
  }, [context])

  return null
}

describe('SessionProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 索引是模块级长驻 store：不清会跨用例串数据
    sessionListIndexStore.reset()
    latestContext = null
    latestEventCallbacks = {}
    getSessionsMock.mockReset()
    createSessionMock.mockReset()
    deleteSessionMock.mockReset()
    subscribeToEventsMock.mockReset()
    clearChildrenMock.mockReset()
    clearFollowupQueueMock.mockReset()
    setTodosMock.mockReset()
    clearSessionRuntimeStateMock.mockReset()
    sessionErrorHandlerMock.mockReset()
    autoDetectPathStyleMock.mockReset()
    onServerChangeMock.mockReset()
    serverState.activeServerId = 'local'
    serverState.listeners.clear()
    subscribeToEventsMock.mockImplementation((callbacks: EventCallbacks) => {
      latestEventCallbacks = callbacks
      return vi.fn()
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('queues a reconnect refresh while the latest request is still pending', async () => {
    const firstRequest = createDeferred<Array<{ id: string; directory: string }>>()
    const secondRequest = createDeferred<Array<{ id: string; directory: string }>>()
    const thirdRequest = createDeferred<Array<{ id: string; directory: string }>>()

    getSessionsMock
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise)
      .mockImplementationOnce(() => thirdRequest.promise)

    render(
      <SessionProvider>
        <SessionContextProbe />
      </SessionProvider>,
    )

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(latestContext).not.toBeNull()

    act(() => {
      latestContext!.setSearch('branch')
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })

    await act(async () => {
      firstRequest.resolve([{ id: 'session-1', directory: '/workspace/demo' }])
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      latestEventCallbacks.onReconnected?.('network')
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      secondRequest.resolve([{ id: 'session-2', directory: '/workspace/demo' }])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(3)

    await act(async () => {
      thirdRequest.resolve([{ id: 'session-3', directory: '/workspace/demo' }])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(latestContext?.sessions.map(session => session.id)).toEqual(['session-3'])
  })

  it('retries the initial session list fetch after a startup failure', async () => {
    getSessionsMock
      .mockRejectedValueOnce(new Error('service not ready'))
      .mockResolvedValueOnce([{ id: 'session-1', directory: '/workspace/demo' }])

    render(
      <SessionProvider>
        <SessionContextProbe />
      </SessionProvider>,
    )

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
    expect(latestContext?.sessions.map(session => session.id)).toEqual(['session-1'])
  })

  it('removes deleted sessions from context and clears runtime state', async () => {
    getSessionsMock.mockResolvedValue([
      { id: 'session-1', directory: '/workspace/demo' },
      { id: 'session-2', directory: '/workspace/demo' },
    ])

    render(
      <SessionProvider>
        <SessionContextProbe />
      </SessionProvider>,
    )

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(latestContext?.sessions.map(session => session.id)).toEqual(['session-1', 'session-2'])

    await act(async () => {
      latestEventCallbacks.onSessionDeleted?.('session-1')
      // 非搜索态的成员删除由 useGlobalEvents 写入索引
      sessionListIndexStore.applyDeleted('local', 'session-1')
    })

    expect(clearSessionRuntimeStateMock).toHaveBeenCalledWith('session-1')
    expect(latestContext?.sessions.map(session => session.id)).toEqual(['session-2'])
  })

  it('updates a session in place without changing its position', async () => {
    getSessionsMock.mockResolvedValue([
      { id: 'session-1', directory: '/workspace/demo', title: 'One' },
      { id: 'session-2', directory: '/workspace/demo', title: 'Two' },
      { id: 'session-3', directory: '/workspace/demo', title: 'Three' },
    ])

    render(
      <SessionProvider>
        <SessionContextProbe />
      </SessionProvider>,
    )

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(latestContext?.sessions.map(session => session.id)).toEqual(['session-1', 'session-2', 'session-3'])

    await act(async () => {
      sessionListIndexStore.applySessionChanged('local', {
        id: 'session-2',
        slug: 'session-2',
        projectID: 'project-1',
        directory: '/workspace/demo',
        title: 'Two updated',
        version: '1',
        time: { created: 1, updated: 2 },
      } as never)
    })

    // 内容更新了，但位置不动（并行会话交替更新时列表不能来回跳）
    expect(latestContext?.sessions.map(session => session.id)).toEqual(['session-1', 'session-2', 'session-3'])
    expect(latestContext?.sessions[1].title).toBe('Two updated')
  })

  it('refetches on server endpoint changes even while the old request is in flight', async () => {
    const staleRequest = createDeferred<Array<{ id: string; directory: string }>>()
    const freshRequest = createDeferred<Array<{ id: string; directory: string }>>()

    getSessionsMock
      .mockImplementationOnce(() => staleRequest.promise)
      .mockImplementationOnce(() => freshRequest.promise)

    render(
      <SessionProvider>
        <SessionContextProbe />
      </SessionProvider>,
    )

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
      freshRequest.resolve([{ id: 'fresh', directory: '/workspace/demo' }])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(latestContext?.sessions.map(session => session.id)).toEqual(['fresh'])

    await act(async () => {
      staleRequest.resolve([{ id: 'stale', directory: '/workspace/demo' }])
      await Promise.resolve()
      await Promise.resolve()
    })

    // 晚归的旧响应不应覆盖新数据
    expect(latestContext?.sessions.map(session => session.id)).toEqual(['fresh'])
  })})
