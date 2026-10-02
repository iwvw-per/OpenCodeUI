import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectLastUsedAt } from './useProjectLastUsedAt'

const getSessionsMock = vi.fn()
const subscribeToServerEventsMock = vi.fn()

vi.mock('../api', () => ({
  getSessions: (...args: unknown[]) => getSessionsMock(...args),
}))

vi.mock('../api/events', () => ({
  subscribeToServerEvents: (...args: unknown[]) => subscribeToServerEventsMock(...args),
}))

type SessionCallback = { onSessionCreated?: (s: unknown) => void; onSessionUpdated?: (s: unknown) => void }

let latestCallbacks: SessionCallback = {}

function makeSession(directory: string, updated: number, extra: Record<string, unknown> = {}) {
  return { id: `s-${updated}`, directory, time: { created: 1, updated }, ...extra }
}

describe('useProjectLastUsedAt', () => {
  beforeEach(() => {
    getSessionsMock.mockReset()
    subscribeToServerEventsMock.mockReset()
    latestCallbacks = {}
    subscribeToServerEventsMock.mockImplementation((_serverId: string, callbacks: SessionCallback) => {
      latestCallbacks = callbacks
      return vi.fn()
    })
    getSessionsMock.mockResolvedValue([])
  })

  it('seeds the map from an initial fetch', async () => {
    getSessionsMock.mockResolvedValue([makeSession('C:/repo', 100)])

    const { result } = renderHook(() => useProjectLastUsedAt('srv-seed', ['C:/repo']))

    await waitFor(() => expect(result.current['C:/repo']).toBe(100))
  })

  it('bumps a tracked directory in real time on session.updated without refetching', async () => {
    getSessionsMock.mockResolvedValue([makeSession('C:/repo', 100)])

    const { result } = renderHook(() => useProjectLastUsedAt('srv-bump', ['C:/repo']))
    await waitFor(() => expect(result.current['C:/repo']).toBe(100))

    const callsBefore = getSessionsMock.mock.calls.length

    act(() => {
      latestCallbacks.onSessionUpdated?.(makeSession('C:/repo', 500))
    })

    expect(result.current['C:/repo']).toBe(500)
    // 实时更新不应触发新的网络请求
    expect(getSessionsMock.mock.calls.length).toBe(callsBefore)
  })

  it('ignores sessions in untracked directories and archived sessions', async () => {
    getSessionsMock.mockResolvedValue([makeSession('C:/repo', 100)])

    const { result } = renderHook(() => useProjectLastUsedAt('srv-filter', ['C:/repo']))
    await waitFor(() => expect(result.current['C:/repo']).toBe(100))

    act(() => {
      latestCallbacks.onSessionUpdated?.(makeSession('C:/other', 999))
      latestCallbacks.onSessionUpdated?.(makeSession('C:/repo', 999, { time: { created: 1, updated: 999, archived: 5 } }))
    })

    expect(result.current['C:/repo']).toBe(100)
    expect(result.current['C:/other']).toBeUndefined()
  })

  it('ignores child sessions', async () => {
    getSessionsMock.mockResolvedValue([makeSession('C:/repo', 100)])

    const { result } = renderHook(() => useProjectLastUsedAt('srv-child', ['C:/repo']))
    await waitFor(() => expect(result.current['C:/repo']).toBe(100))

    act(() => {
      latestCallbacks.onSessionUpdated?.(makeSession('C:/repo', 800, { parentID: 'parent-1' }))
    })

    expect(result.current['C:/repo']).toBe(100)
  })

  it('does not lower an existing timestamp', async () => {
    getSessionsMock.mockResolvedValue([makeSession('C:/repo', 500)])

    const { result } = renderHook(() => useProjectLastUsedAt('srv-lower', ['C:/repo']))
    await waitFor(() => expect(result.current['C:/repo']).toBe(500))

    act(() => {
      latestCallbacks.onSessionUpdated?.(makeSession('C:/repo', 100))
    })

    expect(result.current['C:/repo']).toBe(500)
  })
})
