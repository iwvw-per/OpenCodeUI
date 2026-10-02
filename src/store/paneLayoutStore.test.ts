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

  it('equalizes split ratios when adding a third pane', () => {
    paneLayoutStore.reset()

    paneLayoutStore.setFocusedSession('session-a')
    const paneB = paneLayoutStore.splitPane('pane-1', 'horizontal', 'session-b')!
    // 二分屏：应各占 0.5
    let root = paneLayoutStore.getRoot()
    expect(root.type).toBe('split')
    if (root.type === 'split') expect(root.ratio).toBeCloseTo(0.5)

    // 三分屏：root 的 first 是 1 个叶子、second 是 2 个叶子的子树，
    // 等分后 root.ratio = 1/3、子树 ratio = 0.5，三个 pane 视觉宽度都是 1/3
    paneLayoutStore.splitPane(paneB, 'vertical', 'session-c')
    root = paneLayoutStore.getRoot()
    expect(root.type).toBe('split')
    if (root.type === 'split') {
      expect(root.ratio).toBeCloseTo(1 / 3)
      if (root.second.type === 'split') expect(root.second.ratio).toBeCloseTo(0.5)
    }
  })

  it('equalizes split ratios via splitPaneToSide', () => {
    paneLayoutStore.reset()

    paneLayoutStore.setFocusedSession('session-a')
    const paneB = paneLayoutStore.splitPaneToSide('pane-1', 'right', 'session-b')!

    paneLayoutStore.splitPaneToSide(paneB, 'bottom', 'session-c')

    const root = paneLayoutStore.getRoot()
    expect(root.type).toBe('split')
    if (root.type === 'split') {
      expect(root.ratio).toBeCloseTo(1 / 3)
    }
  })

  it('re-equalizes ratios after closing a pane', () => {
    paneLayoutStore.reset()

    paneLayoutStore.setFocusedSession('session-a')
    const paneB = paneLayoutStore.splitPane('pane-1', 'horizontal', 'session-b')!
    paneLayoutStore.splitPane(paneB, 'vertical', 'session-c')

    // 先人为拖拽一个不均的比例
    const root = paneLayoutStore.getRoot()
    if (root.type === 'split') paneLayoutStore.setRatio(root.id, 0.8)
    if (root.type === 'split') expect(root.ratio).not.toBeCloseTo(0.5)

    // 关闭一个 pane 后应恢复等分（二分屏各 0.5）
    paneLayoutStore.closePane('pane-3')
    const next = paneLayoutStore.getRoot()
    expect(next.type).toBe('split')
    if (next.type === 'split') expect(next.ratio).toBeCloseTo(0.5)
  })

  it('does not equalize on manual ratio drag alone', () => {
    paneLayoutStore.reset()

    paneLayoutStore.setFocusedSession('session-a')
    paneLayoutStore.splitPane('pane-1', 'horizontal', 'session-b')

    const root = paneLayoutStore.getRoot()
    if (root.type === 'split') paneLayoutStore.setRatio(root.id, 0.3)

    const after = paneLayoutStore.getRoot()
    if (after.type === 'split') expect(after.ratio).toBeCloseTo(0.3)
  })
})
