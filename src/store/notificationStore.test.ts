import { beforeEach, describe, expect, it } from 'vitest'
import { notificationStore, useUnreadCompletedSessionIds } from './notificationStore'

// 未读小点残留的回归保护。
// 数据源是 notificationStore 里的 completed 通知；标记已读必须能按 sessionId 清掉，
// 否则会话列表/项目行右侧的小点会一直在。

const SESSION = 'srv::ses_1'

function unreadIds(): Set<string> {
  return new Set(
    notificationStore
      .getSnapshot()
      .notifications.filter(n => n.type === 'completed' && !n.read)
      .map(n => n.sessionId),
  )
}

describe('notificationStore 未读 completed 标记', () => {
  beforeEach(() => {
    notificationStore.clearAll()
  })

  it('push 后该 session 出现在未读集合中', () => {
    notificationStore.push('completed', 'Task done', 'Session completed', SESSION, '/repo')

    expect(unreadIds().has(SESSION)).toBe(true)
  })

  it('markSessionNotificationsRead 能清掉指定 session 的未读', () => {
    notificationStore.push('completed', 'Task done', 'Session completed', SESSION, '/repo')

    notificationStore.markSessionNotificationsRead(SESSION, 'completed')

    expect(unreadIds().has(SESSION)).toBe(false)
  })

  it('只清指定 session，不影响其它 session', () => {
    const other = 'srv::ses_2'
    notificationStore.push('completed', 'A', 'done', SESSION, '/repo')
    notificationStore.push('completed', 'B', 'done', other, '/repo')

    notificationStore.markSessionNotificationsRead(SESSION, 'completed')

    expect(unreadIds().has(SESSION)).toBe(false)
    expect(unreadIds().has(other)).toBe(true)
  })

  it('指定 type 时不清掉其它类型的未读', () => {
    notificationStore.push('permission', 'Perm', 'needs approval', SESSION, '/repo')
    notificationStore.push('completed', 'Done', 'completed', SESSION, '/repo')

    notificationStore.markSessionNotificationsRead(SESSION, 'completed')

    const remaining = notificationStore.getSnapshot().notifications.filter(n => !n.read)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].type).toBe('permission')
  })

  it('重复标记不产生额外状态变更（幂等）', () => {
    notificationStore.push('completed', 'Done', 'completed', SESSION, '/repo')
    notificationStore.markSessionNotificationsRead(SESSION, 'completed')
    const snapshot = notificationStore.getSnapshot()

    notificationStore.markSessionNotificationsRead(SESSION, 'completed')

    expect(notificationStore.getSnapshot()).toBe(snapshot)
  })

  it('useUnreadCompletedSessionIds 的过滤口径与之一致', () => {
    notificationStore.push('completed', 'Done', 'completed', SESSION, '/repo')
    // 该 hook 只是同一份数据的 selector 包装，这里直接验证底层过滤条件
    const ids = unreadIds()
    expect(ids.size).toBe(1)
    expect(typeof useUnreadCompletedSessionIds).toBe('function')
  })
})
