import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('./serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'server-a',
    subscribe: () => () => {},
  },
}))

const { childSessionStore } = await import('./childSessionStore')

function makeChild(id: string, parentID: string, title = 'child') {
  return {
    id,
    parentID,
    title,
    time: { created: 1, updated: 1 },
  } as never
}

describe('childSessionStore 状态落定', () => {
  beforeEach(() => {
    childSessionStore.clearAll()
  })

  it('重复注册不会把已 idle 的子代理冲回 running', () => {
    childSessionStore.registerChildSession(makeChild('c1', 'p1'))
    expect(childSessionStore.getSessionInfo('server-a::c1')?.status).toBe('running')

    childSessionStore.markIdle('server-a::c1')
    expect(childSessionStore.getSessionInfo('server-a::c1')?.status).toBe('idle')

    // 子代理结束后仍会收到 session.updated（标题更新等）
    childSessionStore.registerChildSession(makeChild('c1', 'p1', 'renamed'))
    expect(childSessionStore.getSessionInfo('server-a::c1')?.status).toBe('idle')
  })

  it('重复注册不会把已 error 的子代理冲回 running', () => {
    childSessionStore.registerChildSession(makeChild('c2', 'p1'))
    childSessionStore.markError('server-a::c2')
    childSessionStore.registerChildSession(makeChild('c2', 'p1'))

    expect(childSessionStore.getSessionInfo('server-a::c2')?.status).toBe('error')
  })

  it('注册前先到达的 idle 终态在注册时被消费', () => {
    // session.idle 与 session.created 乱序
    childSessionStore.markIdle('server-a::c3')
    childSessionStore.registerChildSession(makeChild('c3', 'p1'))

    expect(childSessionStore.getSessionInfo('server-a::c3')?.status).toBe('idle')
  })

  it('显式传入的 running 会覆盖已暂存的终态', () => {
    childSessionStore.markIdle('server-a::c4')
    childSessionStore.registerChildSession(makeChild('c4', 'p1'), 'server-a', 'running')

    expect(childSessionStore.getSessionInfo('server-a::c4')?.status).toBe('running')
  })

  it('已 running 的子代理仍可被正常标记为 idle', () => {
    childSessionStore.registerChildSession(makeChild('c5', 'p1'))
    childSessionStore.markIdle('server-a::c5')

    expect(childSessionStore.getSessionInfo('server-a::c5')?.status).toBe('idle')
  })

  it('markRunning 只复活已注册的子会话，不为父会话凭空建记录', () => {
    childSessionStore.markRunning('server-a::not-registered')

    expect(childSessionStore.getSessionInfo('server-a::not-registered')).toBeUndefined()
  })

  it('markRunning 可以把 idle 的子会话重新置为 running', () => {
    childSessionStore.registerChildSession(makeChild('c6', 'p1'))
    childSessionStore.markIdle('server-a::c6')
    childSessionStore.markRunning('server-a::c6')

    expect(childSessionStore.getSessionInfo('server-a::c6')?.status).toBe('running')
  })

  it('markRunning 不复活已 error 的子会话', () => {
    childSessionStore.registerChildSession(makeChild('c7', 'p1'))
    childSessionStore.markError('server-a::c7')
    childSessionStore.markRunning('server-a::c7')

    expect(childSessionStore.getSessionInfo('server-a::c7')?.status).toBe('error')
  })

  it('markRunning 会清掉暂存的终态，避免后续注册又被拉回 idle', () => {
    childSessionStore.registerChildSession(makeChild('c8', 'p1'))
    childSessionStore.markIdle('server-a::c8')
    childSessionStore.markRunning('server-a::c8')
    childSessionStore.registerChildSession(makeChild('c8', 'p1'))

    expect(childSessionStore.getSessionInfo('server-a::c8')?.status).toBe('running')
  })
})
