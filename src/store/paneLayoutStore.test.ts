import { describe, expect, it } from 'vitest'
import { paneLayoutStore } from './paneLayoutStore'

describe('paneLayoutStore', () => {
  it('focuses the sibling subtree when closing the focused pane', () => {
    paneLayoutStore.reset()

    paneLayoutStore.setFocusedSession('session-a')
    const paneB = paneLayoutStore.splitPane('pane-1', 'horizontal', 'session-b')
    expect(paneB).toBe('pane-2')

    const paneC = paneLayoutStore.splitPane('pane-2', 'vertical', 'session-c')
    expect(paneC).toBe('pane-3')

    paneLayoutStore.focusPane('pane-3')
    paneLayoutStore.closePane('pane-3')

    expect(paneLayoutStore.getFocusedPaneId()).toBe('pane-2')
    expect(paneLayoutStore.getFocusedSessionId()).toBe('session-b')
  })

  it('finds a pane by its session id', () => {
    paneLayoutStore.reset()

    paneLayoutStore.setFocusedSession('session-a')
    paneLayoutStore.splitPane('pane-1', 'horizontal', 'session-b')

    expect(paneLayoutStore.findPaneBySession('session-a')?.id).toBe('pane-1')
    expect(paneLayoutStore.findPaneBySession('session-b')?.id).toBe('pane-2')
    expect(paneLayoutStore.findPaneBySession('session-missing')).toBeNull()
  })

  it('closes a subtask session pane only when tracked', () => {
    paneLayoutStore.reset()

    paneLayoutStore.setFocusedSession('session-a')
    paneLayoutStore.splitPane('pane-1', 'horizontal', 'subtask-1')

    expect(paneLayoutStore.closeSubtaskSession('subtask-1')).toBe(false)
    expect(paneLayoutStore.findPaneBySession('subtask-1')).not.toBeNull()

    paneLayoutStore.markSubtaskSession('subtask-1')
    expect(paneLayoutStore.isSubtaskSession('subtask-1')).toBe(true)
    expect(paneLayoutStore.closeSubtaskSession('subtask-1')).toBe(true)
    expect(paneLayoutStore.findPaneBySession('subtask-1')).toBeNull()
    expect(paneLayoutStore.isSubtaskSession('subtask-1')).toBe(false)
  })

  it('does not auto-close a subtask session occupying the only pane', () => {
    paneLayoutStore.reset()

    paneLayoutStore.setFocusedSession('subtask-1')
    paneLayoutStore.markSubtaskSession('subtask-1')

    expect(paneLayoutStore.closeSubtaskSession('subtask-1')).toBe(false)
    expect(paneLayoutStore.getFocusedSessionId()).toBe('subtask-1')
  })

  it('forgets subtask tracking when the pane is closed manually', () => {
    paneLayoutStore.reset()

    paneLayoutStore.setFocusedSession('session-a')
    paneLayoutStore.splitPane('pane-1', 'horizontal', 'subtask-1')
    paneLayoutStore.markSubtaskSession('subtask-1')

    paneLayoutStore.closePane('pane-2')

    expect(paneLayoutStore.isSubtaskSession('subtask-1')).toBe(false)
  })
})
