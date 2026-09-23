import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionManager } from './useSessionManager'
import { HISTORY_LOAD_BATCH_SIZE, INITIAL_MESSAGE_LIMIT } from '../constants'

const {
  getSessionMock,
  getSessionMessagePageMock,
  messageStoreMock,
  sessionErrorHandlerMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getSessionMessagePageMock: vi.fn(),
  messageStoreMock: {
    getSessionState: vi.fn(),
    setLoadState: vi.fn(),
    setLoadError: vi.fn(),
    setMessages: vi.fn(),
    updateSessionMetadata: vi.fn(),
    prependMessages: vi.fn(),
    setRevertState: vi.fn(),
  },
  sessionErrorHandlerMock: vi.fn(),
}))

vi.mock('../api', () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
  getSessionMessagePage: (...args: unknown[]) => getSessionMessagePageMock(...args),
  revertMessage: vi.fn(),
  unrevertSession: vi.fn(),
  extractUserMessageContent: vi.fn(),
}))

vi.mock('../store', () => ({
  messageStore: messageStoreMock,
}))

vi.mock('../utils', () => ({
  sessionErrorHandler: (...args: unknown[]) => sessionErrorHandlerMock(...args),
}))

describe('useSessionManager', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    getSessionMessagePageMock.mockReset()
    messageStoreMock.getSessionState.mockReset()
    messageStoreMock.setLoadState.mockReset()
    messageStoreMock.setLoadError.mockReset()
    messageStoreMock.setMessages.mockReset()
    messageStoreMock.updateSessionMetadata.mockReset()
    messageStoreMock.prependMessages.mockReset()
    messageStoreMock.setRevertState.mockReset()
    sessionErrorHandlerMock.mockReset()

    messageStoreMock.getSessionState.mockReturnValue(null)
    getSessionMock.mockResolvedValue({ id: 'session-1', directory: '/workspace/demo' })
    getSessionMessagePageMock.mockResolvedValue({ messages: [] })
  })

  it('reports missing route sessions when loading returns not found', async () => {
    const onSessionMissing = vi.fn()
    const notFoundError = Object.assign(new Error('session not found'), { status: 404 })
    getSessionMock.mockRejectedValue(notFoundError)
    getSessionMessagePageMock.mockRejectedValue(notFoundError)

    renderHook(() =>
      useSessionManager({
        sessionId: 'missing-session',
        directory: '/workspace/demo',
        onSessionMissing,
      }),
    )

    await waitFor(() => {
      expect(onSessionMissing).toHaveBeenCalledWith('missing-session')
    })

    expect(messageStoreMock.setLoadState).toHaveBeenCalledWith('missing-session', 'loading')
    expect(messageStoreMock.setLoadError).toHaveBeenCalledWith(
      'missing-session',
      expect.objectContaining({ name: 'APIError' }),
    )
  })

  it('loads history with the store cursor instead of re-fetching all messages', async () => {
    const apiMessage = {
      info: { id: 'message-0', role: 'user', time: { created: 1 } },
      parts: [],
    }
    messageStoreMock.getSessionState.mockReturnValue({
      messages: [{ info: { id: 'message-1', role: 'user', time: { created: 2 } }, parts: [] }],
      directory: '/workspace/demo',
      hasMoreHistory: true,
      historyCursor: 'cursor-1',
    })
    getSessionMessagePageMock.mockResolvedValue({ messages: [apiMessage], nextCursor: 'cursor-2' })

    const { result } = renderHook(() =>
      useSessionManager({ sessionId: 'session-1', directory: '/workspace/demo' }),
    )

    await act(async () => {
      await result.current.loadMoreHistory()
    })

    expect(getSessionMessagePageMock).toHaveBeenCalledWith(
      'session-1',
      HISTORY_LOAD_BATCH_SIZE,
      'cursor-1',
      '/workspace/demo',
      expect.anything(),
    )
    expect(messageStoreMock.prependMessages).toHaveBeenCalledWith('session-1', [apiMessage], true, 'cursor-2')
  })

  it('falls back to limit-based paging when the server returns no cursor', async () => {
    const apiMessage = {
      info: { id: 'message-0', role: 'user', time: { created: 1 } },
      parts: [],
    }
    messageStoreMock.getSessionState.mockReturnValue({
      messages: [{ info: { id: 'message-1', role: 'user', time: { created: 2 } }, parts: [] }],
      directory: '/workspace/demo',
      hasMoreHistory: true,
      historyCursor: undefined,
    })
    // 旧版 serve 忽略 before：请求多少就返回多少（这里是满载），但没有游标
    const legacyLimit = Math.max(INITIAL_MESSAGE_LIMIT, 1) + HISTORY_LOAD_BATCH_SIZE
    getSessionMessagePageMock.mockResolvedValue({
      messages: Array.from({ length: legacyLimit }, () => apiMessage),
    })

    const { result } = renderHook(() =>
      useSessionManager({ sessionId: 'session-1', directory: '/workspace/demo' }),
    )

    await act(async () => {
      await result.current.loadMoreHistory()
    })

    expect(getSessionMessagePageMock).toHaveBeenCalledWith(
      'session-1',
      legacyLimit,
      undefined,
      '/workspace/demo',
      expect.anything(),
    )
    expect(messageStoreMock.prependMessages).toHaveBeenCalledWith('session-1', expect.any(Array), true, undefined)
  })

  it('does not request history when the session is already at the earliest message', async () => {
    messageStoreMock.getSessionState.mockReturnValue({
      messages: [{ info: { id: 'message-1', role: 'user', time: { created: 2 } }, parts: [] }],
      loadState: 'loaded',
      isStale: false,
      directory: '/workspace/demo',
      hasMoreHistory: false,
      historyCursor: undefined,
    })

    const { result } = renderHook(() =>
      useSessionManager({ sessionId: 'session-1', directory: '/workspace/demo' }),
    )

    await act(async () => {
      await result.current.loadMoreHistory()
    })

    expect(getSessionMessagePageMock).not.toHaveBeenCalled()
  })

  it('keeps showing existing messages while force-refreshing a loaded session', async () => {
    // 重连/host 切换后的 force 刷新不应把 loadState 打回 loading：
    // ChatPane 用 loadState === 'loaded' 决定是否挂载 ChatArea，一旦回落，
    // 已渲染的对话会被卸载、闪一次全屏 loading、再重挂，滚动位置丢失。
    messageStoreMock.getSessionState.mockReturnValue({
      messages: [{ info: { id: 'message-1', role: 'user', time: { created: 2 } }, parts: [] }],
      loadState: 'loaded',
      isStale: false,
      isStreaming: false,
      directory: '/workspace/demo',
      hasMoreHistory: false,
      historyCursor: undefined,
    })
    getSessionMessagePageMock.mockResolvedValue({
      messages: [{ info: { id: 'message-1', role: 'user', time: { created: 2 } }, parts: [] }],
    })

    const { result } = renderHook(() =>
      useSessionManager({ sessionId: 'session-1', directory: '/workspace/demo' }),
    )

    messageStoreMock.setLoadState.mockClear()

    await act(async () => {
      await result.current.loadSession('session-1', { force: true })
    })

    expect(messageStoreMock.setLoadState).not.toHaveBeenCalledWith('session-1', 'loading')
    expect(messageStoreMock.setMessages).toHaveBeenCalled()
  })

  it('still shows the loading state when the session has no displayed messages yet', async () => {
    messageStoreMock.getSessionState.mockReturnValue(null)
    getSessionMessagePageMock.mockResolvedValue({ messages: [] })

    const { result } = renderHook(() =>
      useSessionManager({ sessionId: 'session-1', directory: '/workspace/demo' }),
    )

    await act(async () => {
      await result.current.loadSession('session-2')
    })

    expect(messageStoreMock.setLoadState).toHaveBeenCalledWith('session-2', 'loading')
  })
})
