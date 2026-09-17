import { beforeEach, describe, expect, it } from 'vitest'
import { paneControllerStore, type PaneControllerState } from './paneControllerStore'

function makeController(paneId: string, overrides: Partial<PaneControllerState> = {}): PaneControllerState {
  return {
    paneId,
    sessionId: null,
    effectiveDirectory: `/repo/${paneId}`,
    isStreaming: false,
    newSession: () => {},
    archiveSession: () => {},
    previousSession: () => {},
    nextSession: () => {},
    toggleAgent: () => {},
    copyLastResponse: () => {},
    cancelMessage: () => {},
    openModelSelector: () => {},
    toggleFullAuto: () => {},
    ...overrides,
  }
}

describe('paneControllerStore snapshot stability', () => {
  beforeEach(() => {
    paneControllerStore.removeController('p1')
    paneControllerStore.removeController('p2')
  })

  it('reuses the snapshot array reference when a controller is unchanged', () => {
    const controller = makeController('p1')
    paneControllerStore.setController('p1', controller)

    const first = paneControllerStore.getControllers()
    paneControllerStore.setController('p1', controller)
    const second = paneControllerStore.getControllers()

    expect(second).toBe(first)
  })

  it('rebuilds the snapshot on real change without exposing a stale array', () => {
    paneControllerStore.setController('p1', makeController('p1'))
    const first = paneControllerStore.getControllers()

    paneControllerStore.setController('p2', makeController('p2'))
    const second = paneControllerStore.getControllers()

    expect(second).not.toBe(first)
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(2)
    expect(second.map(c => c.paneId)).toEqual(['p1', 'p2'])
  })

  it('keeps the snapshot stable for unrelated reads', () => {
    paneControllerStore.setController('p1', makeController('p1'))
    const first = paneControllerStore.getControllers()
    const second = paneControllerStore.getControllers()

    expect(second).toBe(first)
  })
})
