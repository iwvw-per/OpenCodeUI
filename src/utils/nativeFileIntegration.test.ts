import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canOpenDirectoryNatively,
  canUseNativeDirectoryPicker,
  canUseNativeFileIntegration,
  canUseSystemDirectoryPicker,
  isLocalServer,
} from './nativeFileIntegration'

const { isTauriMock, isTauriMobileMock, invokeMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(),
  isTauriMobileMock: vi.fn(),
  invokeMock: vi.fn(),
}))

vi.mock('./tauri', () => ({
  isTauri: () => isTauriMock(),
  isTauriMobile: () => isTauriMobileMock(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
}))

describe('isLocalServer', () => {
  it('treats an unresolved target as local', () => {
    expect(isLocalServer(null)).toBe(true)
    expect(isLocalServer(undefined)).toBe(true)
    expect(isLocalServer('local')).toBe(true)
  })

  it('rejects a remote server id', () => {
    expect(isLocalServer('aiagent:inst_cae79b5b7ab65caeee182d4c')).toBe(false)
  })
})

describe('canUseNativeFileIntegration', () => {
  afterEach(() => {
    isTauriMock.mockReset()
    isTauriMobileMock.mockReset()
  })

  it('allows native integration for the local server on desktop', () => {
    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(false)
    expect(canUseNativeFileIntegration('local')).toBe(true)
  })

  it('never uses native integration for a remote server', () => {
    // 回归：远程主机上点「添加项目」曾弹出本机文件夹选择器、「打开项目目录」
    // 曾用本机资源管理器打开远程路径。远程路径在本机不存在，必须走应用内功能。
    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(false)
    expect(canUseNativeFileIntegration('aiagent:inst_cae79b5b7ab65caeee182d4c')).toBe(false)
  })

  it('never uses native integration outside Tauri or on mobile', () => {
    isTauriMock.mockReturnValue(false)
    isTauriMobileMock.mockReturnValue(false)
    expect(canUseNativeFileIntegration('local')).toBe(false)

    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(true)
    expect(canUseNativeFileIntegration('local')).toBe(false)
  })
})

describe('canUseNativeDirectoryPicker', () => {
  afterEach(() => {
    isTauriMock.mockReset()
    isTauriMobileMock.mockReset()
  })

  it('mirrors the native-integration gate', () => {
    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(false)
    expect(canUseNativeDirectoryPicker('local')).toBe(true)
    expect(canUseNativeDirectoryPicker('aiagent:inst_1')).toBe(false)
  })
})

describe('canUseSystemDirectoryPicker', () => {
  afterEach(() => {
    isTauriMock.mockReset()
    isTauriMobileMock.mockReset()
  })

  it('allows the picker on desktop regardless of the focused server', () => {
    // 用户主要连云端服务器：焦点几乎总是远程，仍应能打开系统选择器。
    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(false)
    expect(canUseSystemDirectoryPicker()).toBe(true)
  })

  it('never allows the picker outside the desktop client', () => {
    isTauriMock.mockReturnValue(false)
    isTauriMobileMock.mockReturnValue(false)
    expect(canUseSystemDirectoryPicker()).toBe(false)

    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(true)
    expect(canUseSystemDirectoryPicker()).toBe(false)
  })
})

describe('canOpenDirectoryNatively', () => {
  afterEach(() => {
    isTauriMock.mockReset()
    isTauriMobileMock.mockReset()
    invokeMock.mockReset()
  })

  it('always allows the local server on desktop without consulting the host', async () => {
    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(false)
    await expect(canOpenDirectoryNatively('local', '/repo')).resolves.toBe(true)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('opens a remote server path natively when the directory exists on this machine', async () => {
    // 回归：AI Agent 实例可能就跑在本机。此前只凭 serverId 判定，导致这类实例
    // 点「打开项目目录」不再用资源管理器打开，而是改为展开侧栏文件树。
    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(false)
    invokeMock.mockResolvedValue(true)
    await expect(canOpenDirectoryNatively('aiagent:inst_local', 'C:/repo')).resolves.toBe(true)
    expect(invokeMock).toHaveBeenCalledWith('is_local_directory', { path: 'C:/repo' })
  })

  it('falls back to the in-app tree when the remote path does not exist locally', async () => {
    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(false)
    invokeMock.mockResolvedValue(false)
    await expect(canOpenDirectoryNatively('aiagent:inst_remote', '/srv/app')).resolves.toBe(false)
  })

  it('falls back to the in-app tree when the host predates the command', async () => {
    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(false)
    invokeMock.mockRejectedValue(new Error('command not found'))
    await expect(canOpenDirectoryNatively('aiagent:inst_remote', '/srv/app')).resolves.toBe(false)
  })

  it('never opens natively outside the desktop client', async () => {
    isTauriMock.mockReturnValue(false)
    isTauriMobileMock.mockReturnValue(false)
    await expect(canOpenDirectoryNatively('local', '/repo')).resolves.toBe(false)
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
