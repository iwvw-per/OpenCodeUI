import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateStore, compareVersions, hasUpdateAvailable, shouldShowUpdateToast } from './updateStore'

describe('updateStore helpers', () => {
  it('compares versions with optional v prefix', () => {
    expect(compareVersions('v0.5.2', '0.5.1')).toBeGreaterThan(0)
    expect(compareVersions('0.5.1', 'v0.5.1')).toBe(0)
    expect(compareVersions('0.5', '0.5.1')).toBeLessThan(0)
  })

  it('detects whether an update toast should be shown', () => {
    const baseState = {
      currentVersion: '0.5.1',
      latestRelease: {
        version: '0.5.2',
        tagName: 'v0.5.2',
        url: 'https://example.com',
        publishedAt: null,
        name: null,
      },
      lastCheckedAt: Date.now(),
      dismissedVersion: null,
      hiddenToastVersion: null,
      checking: false,
      error: null,
    }

    expect(hasUpdateAvailable(baseState)).toBe(true)
    expect(shouldShowUpdateToast(baseState)).toBe(true)
    expect(shouldShowUpdateToast({ ...baseState, hiddenToastVersion: '0.5.2' })).toBe(false)
    expect(shouldShowUpdateToast({ ...baseState, dismissedVersion: '0.5.2' })).toBe(false)
  })
})

describe('UpdateStore', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('loads the latest release and persists dismissal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: 'v0.5.2',
          html_url: 'https://github.com/lehhair/OpenCodeUI/releases/tag/v0.5.2',
          published_at: '2026-04-15T00:00:00Z',
          name: 'OpenCodeUI v0.5.2',
        }),
      }),
    )

    const store = new UpdateStore('0.5.1')
    await store.checkForUpdates({ force: true })

    expect(store.getSnapshot().latestRelease?.version).toBe('0.5.2')
    expect(hasUpdateAvailable(store.getSnapshot())).toBe(true)

    store.dismissCurrentVersion()

    expect(store.getSnapshot().dismissedVersion).toBe('0.5.2')
    expect(shouldShowUpdateToast(store.getSnapshot())).toBe(false)
    expect(localStorage.getItem('opencode:update-check')).toContain('0.5.2')
  })
})

describe('importUpdateSettingsBackup', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('updates in-memory state and notifies subscribers', async () => {
    vi.resetModules()
    const { updateStore, importUpdateSettingsBackup, exportUpdateSettingsBackup } = await import('./updateStore')

    let notifications = 0
    const unsubscribe = updateStore.subscribe(() => {
      notifications += 1
    })

    importUpdateSettingsBackup({
      latestRelease: {
        version: '9.9.9',
        tagName: 'v9.9.9',
        url: 'https://example.com/9.9.9',
        publishedAt: null,
        name: null,
      },
      lastCheckedAt: 1700000000000,
      dismissedVersion: '9.9.9',
    })

    expect(updateStore.getSnapshot().latestRelease?.version).toBe('9.9.9')
    expect(updateStore.getSnapshot().lastCheckedAt).toBe(1700000000000)
    expect(updateStore.getSnapshot().dismissedVersion).toBe('9.9.9')
    expect(notifications).toBeGreaterThan(0)
    // 再次导出必须反映导入值，而不是旧内存状态
    expect(exportUpdateSettingsBackup().latestRelease?.version).toBe('9.9.9')

    unsubscribe()
  })
})
