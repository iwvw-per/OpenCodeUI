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

  it('preserves a known timestamp when a later refetch of that directory fails', async () => {
    // 首次：A 成功、B 失败 → A 有时间戳
    getSessionsMock.mockImplementation((params: { directory: string }) =>
      params.directory === 'C:/a' ? Promise.resolve([makeSession('C:/a', 100)]) : Promise.reject(new Error('net')),
    )

    const { result, rerender } = renderHook(({ w }) => useProjectLastUsedAt('srv-preserve', w), {
      initialProps: { w: ['C:/a', 'C:/b'] },
    })
    await waitFor(() => expect(result.current['C:/a']).toBe(100))
    expect(result.current['C:/b']).toBeUndefined()

    // 重新触发一次加载（worktree 列表变化）时 A 也失败：不应把已知值抹掉
    getSessionsMock.mockRejectedValue(new Error('net'))
    rerender({ w: ['C:/a', 'C:/c'] })
    await act(async () => {
      await new Promise(r => setTimeout(r, 30))
    })

    expect(result.current['C:/a']).toBe(100)
  })

  it('does not cache a failed lookup (allows retry instead of 60s blank)', async () => {
    let calls = 0
    getSessionsMock.mockImplementation(() => {
      calls += 1
      return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve([makeSession('C:/a', 777)])
    })

    const { result, rerender } = renderHook(({ w }) => useProjectLastUsedAt('srv-retry', w), {
      initialProps: { w: ['C:/a'] },
    })
    await waitFor(() => expect(getSessionsMock).toHaveBeenCalledTimes(1))

    // 重新挂载/触发（同 key）应重新请求，而不是命中「失败缓存」跳过
    rerender({ w: ['C:/b'] })
    rerender({ w: ['C:/a'] })
    await waitFor(() => expect(result.current['C:/a']).toBe(777))
  })
})
