import { describe, expect, it, vi, beforeEach } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('../utils/tauri', () => ({
  isTauri: () => true,
  getDesktopPlatform: () => 'windows',
}))

describe('getDroppedPathsInfo', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue([])
  })

  it('passes through absolute paths from Windows, UNC and Unix', async () => {
    const { getDroppedPathsInfo } = await import('./tauriDragDrop')
    await getDroppedPathsInfo(['C:\\Users\\a\\file.txt', '\\\\server\\share\\dir', '/home/user/a.txt'])

    expect(invokeMock).toHaveBeenCalledTimes(1)
    const [, args] = invokeMock.mock.calls[0] as [string, { paths: string[] }]
    expect(args.paths).toEqual(['C:\\Users\\a\\file.txt', '\\\\server\\share\\dir', '/home/user/a.txt'])
  })

  it('drops relative and empty paths so the command cannot probe arbitrary paths', async () => {
    const { getDroppedPathsInfo } = await import('./tauriDragDrop')
    await getDroppedPathsInfo(['..\\..\\Windows\\System32', 'relative/file.txt', '', '   '])

    // 全部被过滤时应直接短路，不调用 Rust 侧命令
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('keeps only the absolute entries from a mixed batch', async () => {
    const { getDroppedPathsInfo } = await import('./tauriDragDrop')
    await getDroppedPathsInfo(['relative.txt', 'D:\\ok.txt'])

    const [, args] = invokeMock.mock.calls[0] as [string, { paths: string[] }]
    expect(args.paths).toEqual(['D:\\ok.txt'])
  })
})
