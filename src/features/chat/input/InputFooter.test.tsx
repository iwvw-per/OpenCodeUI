import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InputFooter } from './InputFooter'

// 只打桩数据来源，渲染与分支判断用真实实现
const useTodosMock = vi.fn()
const useTodoStatsMock = vi.fn()
const useCurrentTaskMock = vi.fn()
const useTokenRateMock = vi.fn()

vi.mock('../../../store', async () => {
  const actual = await vi.importActual<typeof import('../../../store')>('../../../store')
  return {
    ...actual,
    useTodos: () => useTodosMock(),
    useTodoStats: () => useTodoStatsMock(),
    useCurrentTask: () => useCurrentTaskMock(),
  }
})

vi.mock('../../../hooks/useTokenRate', () => ({
  useTokenRate: (...args: unknown[]) => useTokenRateMock(...args),
}))

vi.mock('../../../api/session', () => ({
  getSessionTodos: vi.fn().mockResolvedValue([]),
}))

describe('InputFooter token rate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTodosMock.mockReturnValue([])
    useTodoStatsMock.mockReturnValue({ completed: 0, total: 0 })
    useCurrentTaskMock.mockReturnValue(null)
    useTokenRateMock.mockReturnValue({ tokensPerSec: 0, hasData: false })
  })

  it('shows the token rate when there are no todos', () => {
    useTodosMock.mockReturnValue([])
    useTokenRateMock.mockReturnValue({ tokensPerSec: 123.4, hasData: true })

    render(<InputFooter paneId="pane-1" sessionId="session-1" />)

    expect(screen.getByText('123 tok/s')).toBeInTheDocument()
  })

  it('shows the token rate alongside the todo progress when todos exist', () => {
    useTodosMock.mockReturnValue([{ id: 'todo-1', content: 'Do a thing', status: 'in_progress' }])
    useTodoStatsMock.mockReturnValue({ completed: 1, total: 3 })
    useCurrentTaskMock.mockReturnValue('Do a thing')
    useTokenRateMock.mockReturnValue({ tokensPerSec: 42.6, hasData: true })

    render(<InputFooter paneId="pane-1" sessionId="session-1" />)

    expect(screen.getByText('43 tok/s')).toBeInTheDocument()
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })

  it('does not render the todo progress block when there are no todos', () => {
    useTodosMock.mockReturnValue([])
    useTodoStatsMock.mockReturnValue({ completed: 0, total: 0 })
    useTokenRateMock.mockReturnValue({ tokensPerSec: 5, hasData: true })

    render(<InputFooter paneId="pane-1" sessionId="session-1" />)

    expect(screen.queryByText('0/0')).not.toBeInTheDocument()
  })

  it('renders zero when there is no completed turn yet', () => {
    useTokenRateMock.mockReturnValue({ tokensPerSec: 0, hasData: false })

    render(<InputFooter paneId="pane-1" sessionId="session-1" />)

    expect(screen.getByText('0 tok/s')).toBeInTheDocument()
  })

  it('formats rates below ten with one decimal', () => {
    useTokenRateMock.mockReturnValue({ tokensPerSec: 2.34, hasData: true })

    render(<InputFooter paneId="pane-1" sessionId="session-1" />)

    expect(screen.getByText('2.3 tok/s')).toBeInTheDocument()
  })
})
