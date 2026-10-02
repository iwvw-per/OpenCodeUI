import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolPartView } from './ToolPartView'
import type { ToolPart } from '../../../types/message'

const { getActiveCalibratedNowMock } = vi.hoisted(() => ({
  getActiveCalibratedNowMock: vi.fn<() => number | undefined>(() => undefined),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'toolPart.running') return 'Running'
      if (key === 'toolPart.failed') return 'Failed'
      if (key === 'toolPart.interrupted') return 'Interrupted'
      if (key === 'toolPart.maybeStuck') return 'Possibly stuck'
      if (key === 'toolPart.abortStuck') return 'Abort session'
      return key
    },
  }),
}))

vi.mock('../../../hooks', () => ({
  useDelayedRender: (show: boolean) => show,
  useDisclosureScrollLock: () => ({
    rootRef: () => undefined,
    headerRef: () => undefined,
    withScrollLock: (action: () => void) => action(),
  }),
  useCompositorExpand: (open: boolean) => ({
    contentRef: { current: null },
    layoutOpen: open,
    keepMounted: open,
    panelClassName: 'transition-[grid-template-rows] duration-300 ease-in-out',
  }),
}))

vi.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({
    inlineToolRequests: false,
    immersiveMode: false,
    compactInlinePermission: false,
  }),
}))

vi.mock('../../../store/serverStore', () => ({
  serverStore: {
    getActiveCalibratedNow: getActiveCalibratedNowMock,
    // store 模块在导入期会注册 onServerChange 订阅，
    // mock 必须提供这个函数，否则整个模块图加载失败。
    onServerChange: () => () => {},
    getActiveServerId: () => 'local',
  },
}))

vi.mock('../../chat/InlineToolRequestContext', () => ({
  useInlineToolRequests: () => ({
    pendingPermissions: [],
    pendingQuestions: [],
    onPermissionReply: vi.fn(),
    onQuestionReply: vi.fn(),
    onQuestionReject: vi.fn(),
    isReplying: false,
  }),
  findPermissionRequestForTool: () => undefined,
  findQuestionRequestForTool: () => undefined,
}))

vi.mock('../../chat/InlinePermission', () => ({
  InlinePermission: () => null,
}))

vi.mock('../../chat/InlineQuestion', () => ({
  InlineQuestion: () => null,
}))

vi.mock('../tools', () => ({
  getToolIcon: () => <span data-testid="tool-icon">icon</span>,
  getToolColorClass: () => 'tool-color-default',
  extractToolData: () => ({}),
  getToolConfig: () => undefined,
  DefaultRenderer: () => null,
  TodoRenderer: () => null,
  TaskRenderer: () => null,
  TaskAgentBadge: () => null,
  hasTodos: () => false,
}))

function createRunningToolPart(): ToolPart {
  return {
    id: 'tool-1',
    sessionID: 'session-1',
    messageID: 'message-1',
    type: 'tool',
    callID: 'call-1',
    tool: 'bash',
    state: {
      status: 'running',
      title: 'npm run build',
      time: { start: 7_500 },
    },
  }
}

describe('ToolPartView running duration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    getActiveCalibratedNowMock.mockReset()
    getActiveCalibratedNowMock.mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('falls back to local wall clock when calibration is unavailable', () => {
    render(<ToolPartView part={createRunningToolPart()} />)

    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('2.5s')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(screen.getByText('3.0s')).toBeInTheDocument()
  })

  it('uses calibrated server time for running tools when available', () => {
    getActiveCalibratedNowMock.mockReturnValue(11_000)

    render(<ToolPartView part={createRunningToolPart()} />)

    expect(screen.getByText('3.5s')).toBeInTheDocument()
  })

  it('clamps running duration to zero when calibrated time is earlier than start', () => {
    getActiveCalibratedNowMock.mockReturnValue(7_000)

    render(<ToolPartView part={createRunningToolPart()} />)

    expect(screen.getByText('0ms')).toBeInTheDocument()
  })

  it('rounds calibrated sub-second durations before rendering', () => {
    getActiveCalibratedNowMock.mockReturnValue(7_623.456)

    render(<ToolPartView part={createRunningToolPart()} />)

    expect(screen.getByText('123ms')).toBeInTheDocument()
  })

  it('uses shared item spacing on compact and descriptive roots', () => {
    const part = createRunningToolPart()
    const { container, rerender } = render(<ToolPartView part={part} compact />)
    expect(container.firstElementChild?.className).toContain('pt-1')

    rerender(<ToolPartView part={part} descriptive />)
    expect(container.firstElementChild?.className).toContain('pt-1')
  })

  it('shows an interrupted marker and duration for reconciled tool parts', () => {
    const part = createRunningToolPart()
    part.state = { ...part.state, status: 'interrupted', metadata: { interrupted: true }, time: { start: 7_500, end: 10_000 } }

    render(<ToolPartView part={part} />)

    expect(screen.getByText('Interrupted')).toBeInTheDocument()
    expect(screen.getByText('2.5s')).toBeInTheDocument()
  })

  it('shows a stuck hint with abort entry once a tool runs past the threshold', () => {
    getActiveCalibratedNowMock.mockReturnValue(7_500 + 60_000)

    render(<ToolPartView part={createRunningToolPart()} />)

    expect(screen.getByText('Possibly stuck')).toBeInTheDocument()
    expect(screen.getByLabelText('Abort session')).toBeInTheDocument()
  })

  it('does not show the stuck hint before the threshold', () => {
    getActiveCalibratedNowMock.mockReturnValue(7_500 + 30_000)

    render(<ToolPartView part={createRunningToolPart()} />)

    expect(screen.queryByText('Possibly stuck')).not.toBeInTheDocument()
  })
})

describe('ToolPartView task completion icon', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createTaskPart(status: 'running' | 'completed'): ToolPart {
    return {
      id: 'tool-task',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'tool',
      callID: 'call-task',
      tool: 'task',
      state:
        status === 'running'
          ? { status: 'running', title: 'explore', time: { start: 1 } }
          : { status: 'completed', title: 'explore', output: 'done', time: { start: 1, end: 2 } },
    }
  }

  it('shows the outlined check icon when a task is completed', () => {
    const { container } = render(<ToolPartView part={createTaskPart('completed')} />)

    // 完成态不再用通用工具图标，而是绿色空心圆对勾
    expect(screen.queryByTestId('tool-icon')).not.toBeInTheDocument()
    const svg = container.querySelector('svg')
    expect(svg?.querySelector('circle')).not.toBeNull()
    // 空心：svg 不填充
    expect(svg?.getAttribute('fill')).toBe('none')
  })

  it('keeps the tool icon (spinner) while the task is running', () => {
    render(<ToolPartView part={createTaskPart('running')} />)
    expect(screen.getByTestId('tool-icon')).toBeInTheDocument()
  })
})
