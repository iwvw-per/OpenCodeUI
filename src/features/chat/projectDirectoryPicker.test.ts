import { afterEach, describe, expect, it, vi } from 'vitest'
import { canUseNativeDirectoryPicker } from './projectDirectoryPicker'

const { isTauriMock, isTauriMobileMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(),
  isTauriMobileMock: vi.fn(),
}))

vi.mock('../../utils/tauri', () => ({
  isTauri: () => isTauriMock(),
  isTauriMobile: () => isTauriMobileMock(),
}))

describe('canUseNativeDirectoryPicker', () => {
  afterEach(() => {
    isTauriMock.mockReset()
    isTauriMobileMock.mockReset()
  })

  it('allows the native picker for the local server on desktop', () => {
    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(false)
    expect(canUseNativeDirectoryPicker('local')).toBe(true)
  })

  it('treats an unresolved focus as local', () => {
    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(false)
    expect(canUseNativeDirectoryPicker(null)).toBe(true)
    expect(canUseNativeDirectoryPicker(undefined)).toBe(true)
  })

  it('never uses the native picker for a remote server', () => {
    // 回归：远程主机上点「添加项目」曾弹出本机文件夹选择器，把本机路径当成
    // 远程项目的目录写入列表。远程必须走内置 ProjectDialog。
    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(false)
    expect(canUseNativeDirectoryPicker('aiagent:inst_cae79b5b7ab65caeee182d4c')).toBe(false)
  })

  it('never uses the native picker outside Tauri or on mobile', () => {
    isTauriMock.mockReturnValue(false)
    isTauriMobileMock.mockReturnValue(false)
    expect(canUseNativeDirectoryPicker('local')).toBe(false)

    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(true)
    expect(canUseNativeDirectoryPicker('local')).toBe(false)
  })
})
