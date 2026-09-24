import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getActiveServerIdMock } = vi.hoisted(() => ({
  getActiveServerIdMock: vi.fn(() => 'local'),
}))

vi.mock('./serverStore', () => ({
  serverStore: {
    getActiveServerId: () => getActiveServerIdMock(),
  },
}))

describe('multiServerStore focus sync', () => {
  beforeEach(() => {
    localStorage.clear()
    getActiveServerIdMock.mockReset()
    getActiveServerIdMock.mockReturnValue('local')
    vi.resetModules()
  })

  it('follows the active server while idle (no focused session)', async () => {
    // 回归：底部主机条切换只改 active，焦点停在旧服务器，导致「新建项目」
    // 打开旧服务器的目录选择器（选了 muse 还是显示 Windows 目录）。
    const { multiServerStore } = await import('./multiServerStore')
    // 焦点显式停在旧服务器（否则 getFocusedServerId 会兜底到 active，测不出问题）
    multiServerStore.setFocusedServerId('old-work')
    getActiveServerIdMock.mockReturnValue('remote-muse')

    multiServerStore.syncFocusToActiveServerWhenIdle(false)

    expect(multiServerStore.getFocusedServerId()).toBe('remote-muse')
  })

  it('keeps the focus pinned to the session server when a session is focused', async () => {
    const { multiServerStore } = await import('./multiServerStore')
    multiServerStore.setFocusedServerId('session-server')
    getActiveServerIdMock.mockReturnValue('remote-muse')

    multiServerStore.syncFocusToActiveServerWhenIdle(true)

    expect(multiServerStore.getFocusedServerId()).toBe('session-server')
  })
})
