import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionNavigationContext } from '../../../../contexts/SessionNavigationContext'
import { TaskHeader } from './TaskRenderer'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function renderHeader(options: { sessionId?: string; openSessionInSplit?: (sessionId: string, directory?: string) => boolean } = { sessionId: 'child-session' }) {
  const sessionId = options.sessionId
  const navigateToSession = vi.fn()
  const onToggle = vi.fn()

  render(
    <SessionNavigationContext.Provider
      value={{
        navigateToSession,
        openSessionInSplit: options.openSessionInSplit,
        currentSessionId: 'parent-session',
        currentDirectory: 'E:\\workspace',
      }}
    >
      <TaskHeader
        agentType="explore"
        description="Inspect the renderer"
        status="completed"
        expanded={false}
        onToggle={onToggle}
        sessionId={sessionId}
      />
    </SessionNavigationContext.Provider>,
  )

  return { navigateToSession, onToggle }
}

describe('TaskHeader', () => {
  it('opens the child session from the jump button', () => {
    const { navigateToSession, onToggle } = renderHeader()

    fireEvent.click(screen.getByRole('button', { name: 'task.openSession' }))

    expect(navigateToSession).toHaveBeenCalledWith('child-session', 'E:\\workspace')
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('also opens the child session from the agent badge', () => {
    const { navigateToSession, onToggle } = renderHeader()

    fireEvent.click(screen.getByRole('button', { name: 'explore' }))

    expect(navigateToSession).toHaveBeenCalledWith('child-session', 'E:\\workspace')
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('uses the title row to toggle details', () => {
    const { navigateToSession, onToggle } = renderHeader()
    const rowButton = screen.getByRole('button', { name: /Inspect the renderer/ })

    fireEvent.click(rowButton)

    expect(onToggle).toHaveBeenCalledOnce()
    expect(navigateToSession).not.toHaveBeenCalled()
  })

  it('hides the jump button until a child session exists', () => {
    const { onToggle } = renderHeader({ sessionId: undefined })

    expect(screen.queryByRole('button', { name: 'task.openSession' })).not.toBeInTheDocument()
    expect(screen.getByText('explore').tagName).toBe('SPAN')
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('prefers opening in split view when the pane handler accepts', () => {
    const openSessionInSplit = vi.fn(() => true)
    const { navigateToSession } = renderHeader({ sessionId: 'child-session', openSessionInSplit })

    fireEvent.click(screen.getByRole('button', { name: 'task.openSession' }))

    expect(openSessionInSplit).toHaveBeenCalledWith('child-session', 'E:\\workspace')
    expect(navigateToSession).not.toHaveBeenCalled()
  })

  it('falls back to in-pane navigation when split is unavailable', () => {
    const openSessionInSplit = vi.fn(() => false)
    const { navigateToSession } = renderHeader({ sessionId: 'child-session', openSessionInSplit })

    fireEvent.click(screen.getByRole('button', { name: 'task.openSession' }))

    expect(openSessionInSplit).toHaveBeenCalledWith('child-session', 'E:\\workspace')
    expect(navigateToSession).toHaveBeenCalledWith('child-session', 'E:\\workspace')
  })
})
