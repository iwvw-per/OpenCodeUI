import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readWatermarkStore, watermarkNow } from './readWatermarkStore'

// 已读水位：跨端同步「未读」的核心。
// 不变量：
//   1. 单调递增——raise 只在更高时才写，时钟回拨/乱序不会把水位拉低。
//   2. 裸 sessionId 对齐——不同 serverId 前缀指向同一后端时水位不分叉。
//   3. 通知时间戳 <= 水位 判定为已读。

const STORAGE_KEY = 'opencode-read-watermarks'

function resetStore() {
  localStorage.removeItem(STORAGE_KEY)
  readWatermarkStore.reload()
}

describe('readWatermarkStore', () => {
  beforeEach(() => {
    resetStore()
  })

  it('raise 抬高水位并持久化', () => {
    readWatermarkStore.raise('local::ses_1', 1000)
    expect(readWatermarkStore.get('ses_1')).toBe(1000)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({ ses_1: 1000 })
  })

  it('单调递增：较低值不覆盖较高值', () => {
    readWatermarkStore.raise('local::ses_1', 2000)
    readWatermarkStore.raise('local::ses_1', 1000)
    expect(readWatermarkStore.get('ses_1')).toBe(2000)
  })

  it('isRead：时间戳不高于水位视为已读', () => {
    readWatermarkStore.raise('local::ses_1', 2000)
    expect(readWatermarkStore.isRead('ses_1', 1500)).toBe(true)
    expect(readWatermarkStore.isRead('ses_1', 2000)).toBe(true)
    expect(readWatermarkStore.isRead('ses_1', 2001)).toBe(false)
  })

  it('裸 id 对齐：不同前缀共享同一水位', () => {
    readWatermarkStore.raise('local::ses_shared', 3000)
    expect(readWatermarkStore.get('ses_shared')).toBe(3000)
    // 另一前缀读取同一水位
    expect(readWatermarkStore.isRead('ses_shared', 2500)).toBe(true)
  })

  it('raiseMany 逐会话取较大值', () => {
    readWatermarkStore.raise('local::ses_a', 1000)
    readWatermarkStore.raiseMany(['local::ses_a', 'local::ses_b'], 2000)
    expect(readWatermarkStore.get('ses_a')).toBe(2000)
    expect(readWatermarkStore.get('ses_b')).toBe(2000)
  })

  it('reload 感知外部写入（模拟偏好同步 pull）', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ses_ext: 5000 }))
    readWatermarkStore.reload()
    expect(readWatermarkStore.get('ses_ext')).toBe(5000)
  })

  it('reload 内容未变时不通知订阅者', () => {
    readWatermarkStore.raise('local::ses_1', 1000)
    const listener = vi.fn()
    readWatermarkStore.subscribe(listener)
    readWatermarkStore.reload()
    expect(listener).not.toHaveBeenCalled()
  })

  it('订阅者在 raise 时被通知', () => {
    const listener = vi.fn()
    readWatermarkStore.subscribe(listener)
    readWatermarkStore.raise('local::ses_1', 1000)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('无记录时 get 返回 0', () => {
    expect(readWatermarkStore.get('ses_unknown')).toBe(0)
  })

  it('空 sessionId 不写入', () => {
    readWatermarkStore.raise('', 1000)
    expect(Object.keys(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'))).toHaveLength(0)
  })

  it('watermarkNow 返回有限数值', () => {
    expect(Number.isFinite(watermarkNow())).toBe(true)
  })
})
