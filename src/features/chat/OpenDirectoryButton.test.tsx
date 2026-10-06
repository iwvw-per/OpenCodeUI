import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenDirectoryButton } from './OpenDirectoryButton'

const { canOpenMock, openWithMock } = vi.hoisted(() => ({
  canOpenMock: vi.fn(),
  openWithMock: vi.fn(),
}))

vi.mock('../../utils/nativeFileIntegration', () => ({
  canOpenDirectoryNatively: (...args: unknown[]) => canOpenMock(...args),
  openDirectoryWith: (...args: unknown[]) => openWithMock(...args),
}))

const STORAGE_KEY = 'opencode-open-directory-target'

describe('OpenDirectoryButton', () => {
  beforeEach(() => {
    localStorage.clear()
    canOpenMock.mockReset()
    openWithMock.mockReset()
    canOpenMock.mockResolvedValue(true)
    openWithMock.mockResolvedValue(undefined)
  })

  it('opens with the file manager by default when the directory is local', async () => {
    render(<OpenDirectoryButton directory="C:/repo" serverId="local" onOpenInApp={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /打开项目目录|Open project directory/i }))

    await waitFor(() => {
      expect(openWithMock).toHaveBeenCalledWith('C:/repo', 'file_manager')
    })
  })

  it('falls back to the in-app tree when the directory is not local', async () => {
    canOpenMock.mockResolvedValue(false)
    const onOpenInApp = vi.fn()
    render(<OpenDirectoryButton directory="/srv/app" serverId="aiagent:inst_remote" onOpenInApp={onOpenInApp} />)

    fireEvent.click(screen.getByRole('button', { name: /打开项目目录|Open project directory/i }))

    await waitFor(() => {
      expect(onOpenInApp).toHaveBeenCalledTimes(1)
    })
    expect(openWithMock).not.toHaveBeenCalled()
  })

  it('selecting VS Code from the menu persists the choice and opens with it', async () => {
    render(<OpenDirectoryButton directory="C:/repo" serverId="local" onOpenInApp={vi.fn()} />)

    // 等探测完成、下拉出现
    const chevron = await screen.findByRole('button', { name: /选择打开方式|Choose how to open/i })
    fireEvent.click(chevron)
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'VS Code' }))

    await waitFor(() => {
      expect(openWithMock).toHaveBeenCalledWith('C:/repo', 'vscode')
    })
    expect(localStorage.getItem(STORAGE_KEY)).toBe('vscode')
  })

  it('honours the persisted target on the primary button', async () => {
    localStorage.setItem(STORAGE_KEY, 'terminal')
    render(<OpenDirectoryButton directory="C:/repo" serverId="local" onOpenInApp={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /打开项目目录|Open project directory/i }))

    await waitFor(() => {
      expect(openWithMock).toHaveBeenCalledWith('C:/repo', 'terminal')
    })
  })

  it('does not offer the dropdown when the directory is not local', async () => {
    canOpenMock.mockResolvedValue(false)
    render(<OpenDirectoryButton directory="/srv/app" serverId="aiagent:inst_remote" onOpenInApp={vi.fn()} />)

    await waitFor(() => {
      expect(canOpenMock).toHaveBeenCalled()
    })
    expect(screen.queryByRole('button', { name: /选择打开方式|Choose how to open/i })).not.toBeInTheDocument()
  })

  it('closes the menu when clicking outside', async () => {
    render(<OpenDirectoryButton directory="C:/repo" serverId="local" onOpenInApp={vi.fn()} />)

    const chevron = await screen.findByRole('button', { name: /选择打开方式|Choose how to open/i })
    fireEvent.click(chevron)
    expect(await screen.findByRole('menuitemradio', { name: 'VS Code' })).toBeInTheDocument()

    fireEvent.mouseDown(document.body)

    await waitFor(() => {
      expect(screen.queryByRole('menuitemradio', { name: 'VS Code' })).not.toBeInTheDocument()
    })
  })

  it('closes the menu on Escape', async () => {
    render(<OpenDirectoryButton directory="C:/repo" serverId="local" onOpenInApp={vi.fn()} />)

    const chevron = await screen.findByRole('button', { name: /选择打开方式|Choose how to open/i })
    fireEvent.click(chevron)
    expect(await screen.findByRole('menuitemradio', { name: 'VS Code' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('menuitemradio', { name: 'VS Code' })).not.toBeInTheDocument()
    })
  })
})
