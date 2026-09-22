import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SyncStatusRow, syncStatusView, formatSyncedAt } from './SyncStatusRow'
import type { SyncState } from '../../../api/preferencesSyncEngine'

const STORAGE_KEY = 'opencode-aiagent-account'
const SYNC_ENABLED_KEY = 'opencode-preferences-sync-enabled'

const NOW = Date.UTC(2026, 8, 22, 10, 0, 0)

describe('syncStatusView', () => {
  it('maps syncing to the loader state', () => {
    expect(syncStatusView({ status: 'syncing', lastSyncedAt: 0 }, NOW)).toEqual({
      kind: 'syncing',
      label: '正在同步…',
      title: '正在同步…',
    })
  })

  it('maps error to a failed state carrying the reason', () => {
    const view = syncStatusView({ status: 'error', lastSyncedAt: 0, error: 'boom' }, NOW)
    expect(view.kind).toBe('error')
    expect(view.label).toBe('同步失败')
    expect(view.title).toContain('boom')
  })

  it('maps a fresh sync to 已同步 · 刚刚', () => {
    const view = syncStatusView({ status: 'synced', lastSyncedAt: NOW - 5_000 }, NOW)
    expect(view.kind).toBe('synced')
    expect(view.label).toBe('已同步 · 刚刚')
  })

  it('maps an older sync to a relative time', () => {
    expect(formatSyncedAt(NOW - 5 * 60_000, NOW)).toBe('5 分钟前')
    expect(formatSyncedAt(NOW - 3 * 60 * 60_000, NOW)).toBe('3 小时前')
  })

  it('maps never-synced to 待同步', () => {
    const view = syncStatusView({ status: 'idle', lastSyncedAt: 0 }, NOW)
    expect(view.kind).toBe('synced')
    expect(view.label).toBe('待同步')
  })
})

describe('SyncStatusRow', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  function seedLoggedInAndEnabled() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ domain: 'https://p.example.com', username: 'u', token: 't', loginAt: Date.now() }),
    )
    localStorage.setItem(SYNC_ENABLED_KEY, '1')
  }

  it('renders nothing when sync is disabled', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ domain: 'https://p.example.com', username: 'u', token: 't', loginAt: Date.now() }),
    )
    const { container } = render(<SyncStatusRow showLabels />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when not logged in', () => {
    localStorage.setItem(SYNC_ENABLED_KEY, '1')
    const { container } = render(<SyncStatusRow showLabels />)
    expect(container.firstChild).toBeNull()
  })

  it('shows a success indicator when logged in and enabled', () => {
    seedLoggedInAndEnabled()
    render(<SyncStatusRow showLabels />)
    const row = screen.getByTitle(/待同步|已同步/)
    expect(row.innerHTML).toContain('success')
  })

  it('hides the label text when the sidebar is collapsed', () => {
    seedLoggedInAndEnabled()
    const { container } = render(<SyncStatusRow showLabels={false} />)
    const label = container.querySelector('span[style*="opacity: 0"]')
    expect(label).toBeTruthy()
  })

  it('accepts a SyncState shape from the engine', () => {
    // 类型契约：引擎新增字段时这里会先报错，避免 UI 静默不同步。
    const state: SyncState = { status: 'synced', lastSyncedAt: Date.now() }
    expect(syncStatusView(state).kind).toBe('synced')
  })
})
