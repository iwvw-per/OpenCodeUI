import { afterEach, describe, expect, it, vi } from 'vitest'

const { isTauriMock, isTauriMobileMock, checkMock, relaunchMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(() => true),
  isTauriMobileMock: vi.fn(() => false),
  checkMock: vi.fn(),
  relaunchMock: vi.fn(),
}))

vi.mock('../utils/tauri', () => ({
  isTauri: () => isTauriMock(),
  isTauriMobile: () => isTauriMobileMock(),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: checkMock,
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: relaunchMock,
}))

import { DesktopUpdater, isDesktopUpdaterAvailable } from '../utils/desktopUpdater'

describe('isDesktopUpdaterAvailable', () => {
  afterEach(() => {
    isTauriMock.mockReset()
    isTauriMobileMock.mockReset()
    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(false)
  })

  it('is available on desktop Tauri only', () => {
    expect(isDesktopUpdaterAvailable()).toBe(true)

    isTauriMobileMock.mockReturnValue(true)
    expect(isDesktopUpdaterAvailable()).toBe(false)

    isTauriMock.mockReturnValue(false)
    isTauriMobileMock.mockReturnValue(false)
    expect(isDesktopUpdaterAvailable()).toBe(false)
  })
})

describe('DesktopUpdater', () => {
  afterEach(() => {
    checkMock.mockReset()
    relaunchMock.mockReset()
    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(false)
  })

  it('returns to idle when no update is available', async () => {
    checkMock.mockResolvedValue(null)
    const updater = new DesktopUpdater()

    await updater.installLatest()

    expect(updater.getSnapshot().phase).toBe('idle')
    expect(updater.getSnapshot().error).toBeNull()
  })

  it('reports download progress and reaches ready', async () => {
    const downloadAndInstall = vi.fn(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: 'Started', data: { contentLength: 100 } })
      onEvent({ event: 'Progress', data: { chunkLength: 40 } })
      onEvent({ event: 'Progress', data: { chunkLength: 60 } })
      onEvent({ event: 'Finished' })
    })
    checkMock.mockResolvedValue({ downloadAndInstall })

    const updater = new DesktopUpdater()
    const phases: string[] = []
    updater.subscribe(progress => phases.push(progress.phase))

    await updater.installLatest()

    const final = updater.getSnapshot()
    expect(final.phase).toBe('ready')
    expect(final.downloadedBytes).toBe(100)
    expect(final.totalBytes).toBe(100)
    expect(phases).toContain('downloading')
    expect(phases).toContain('installing')
  })

  it('captures errors without throwing', async () => {
    checkMock.mockRejectedValue(new Error('network down'))
    const updater = new DesktopUpdater()

    await updater.installLatest()

    expect(updater.getSnapshot().phase).toBe('error')
    expect(updater.getSnapshot().error).toBe('network down')
  })

  it('deduplicates concurrent install requests', async () => {
    let resolveInstall: (() => void) | undefined
    const downloadAndInstall = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveInstall = resolve
        }),
    )
    checkMock.mockResolvedValue({ downloadAndInstall })

    const updater = new DesktopUpdater()
    const first = updater.installLatest()
    const second = updater.installLatest()

    // 第二次调用必须复用同一个 in-flight promise，不再发起新的 check。
    await vi.waitFor(() => expect(checkMock).toHaveBeenCalledTimes(1))

    resolveInstall?.()
    await Promise.all([first, second])
    expect(downloadAndInstall).toHaveBeenCalledTimes(1)
  })
})
