import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canUseNativeDirectoryPicker,
  canUseNativeFileIntegration,
  canUseSystemDirectoryPicker,
  isLocalServer,
} from './nativeFileIntegration'

const { isTauriMock, isTauriMobileMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(),
  isTauriMobileMock: vi.fn(),
}))

vi.mock('./tauri', () => ({
  isTauri: () => isTauriMock(),
  isTauriMobile: () => isTauriMobileMock(),
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
