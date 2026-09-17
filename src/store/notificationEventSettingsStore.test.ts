import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('notificationEventSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('persists system notification toggles', async () => {
    const { notificationEventSettingsStore } = await import('./notificationEventSettingsStore')

    notificationEventSettingsStore.setSystemEnabled('completed', false)
    notificationEventSettingsStore.setSystemEnabled('question', false)

    const persisted = JSON.parse(localStorage.getItem('opencode:notification-event-settings') || 'null')
    expect(persisted).toEqual({
      events: {
        completed: { systemEnabled: false },
        permission: { systemEnabled: true },
        question: { systemEnabled: false },
        error: { systemEnabled: true },
      },
    })
  })

  it('updates in-memory state and notifies subscribers on import', async () => {
    const { notificationEventSettingsStore, importNotificationEventSettingsBackup } = await import(
      './notificationEventSettingsStore'
    )

    let notifications = 0
    const unsubscribe = notificationEventSettingsStore.subscribe(() => {
      notifications += 1
    })

    importNotificationEventSettingsBackup({
      events: {
        completed: { systemEnabled: false },
        permission: { systemEnabled: false },
        question: { systemEnabled: true },
        error: { systemEnabled: true },
      },
    })

    // 内存状态（UI 的 snapshot 来源）必须同步更新
    expect(notificationEventSettingsStore.getSnapshot().events.completed.systemEnabled).toBe(false)
    expect(notificationEventSettingsStore.getSnapshot().events.permission.systemEnabled).toBe(false)
    expect(notificationEventSettingsStore.isSystemEnabled('completed')).toBe(false)
    // 且通知了订阅者
    expect(notifications).toBe(1)

    unsubscribe()
  })
})
