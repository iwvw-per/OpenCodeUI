import { describe, expect, it } from 'vitest'
import {
  CHAT_CONTENT_EDGE_BUDGET,
  CHAT_CONTENT_MIN,
  preferenceFromDrag,
  resolveChatContentWidth,
} from './contentWidth'

describe('resolveChatContentWidth', () => {
  it('无偏好时按列宽自适应', () => {
    expect(resolveChatContentWidth(2000, null)).toBe(920) // clamp 上限
    expect(resolveChatContentWidth(1000, null)).toBe(680) // 1000*0.64=640 -> 下限 680
  })

  it('有偏好时钳制到 [MIN, column - EDGE_BUDGET]', () => {
    expect(resolveChatContentWidth(2000, 1400)).toBe(1400)
    expect(resolveChatContentWidth(900, 1400)).toBe(900 - CHAT_CONTENT_EDGE_BUDGET)
    expect(resolveChatContentWidth(2000, 100)).toBe(CHAT_CONTENT_MIN)
  })
})

describe('preferenceFromDrag', () => {
  it('大窗口未钳制时：偏好按指针位移变化', () => {
    const column = 2000
    const startPreference = 1400
    const startDisplay = resolveChatContentWidth(column, startPreference)
    const next = preferenceFromDrag(column, startPreference, startDisplay, startDisplay + 100)
    expect(next).toBe(1500)
  })

  it('窄窗口向外拖（被窗口上限挡住）不改变大窗口的宽偏好', () => {
    const wideColumn = 2000
    const widePreference = 1400
    const narrowColumn = 900
    const startDisplay = resolveChatContentWidth(narrowColumn, widePreference) // 被钳制到 724
    const next = preferenceFromDrag(narrowColumn, widePreference, startDisplay, startDisplay + 10)
    // 向外拖被上限挡住，偏好保持不变 → 回到大窗口仍是 1400
    expect(next).toBe(1400)
    expect(resolveChatContentWidth(wideColumn, next)).toBe(1400)
  })

  it('窄窗口向内拖：偏好按位移缩小', () => {
    const narrowColumn = 900
    const startPreference = 1400
    const startDisplay = resolveChatContentWidth(narrowColumn, startPreference) // 724
    const next = preferenceFromDrag(narrowColumn, startPreference, startDisplay, startDisplay - 20)
    expect(next).toBe(1380)
  })

  it('回归：窄窗口上微调拖拽柄，回到大窗口能恢复原宽偏好', () => {
    const wideColumn = 2000
    const preference = 1400
    const narrowColumn = 900

    // 大窗口设好 1400
    // 缩到窄窗口：显示被钳制
    const narrowDisplay = resolveChatContentWidth(narrowColumn, preference)
    expect(narrowDisplay).toBe(narrowColumn - CHAT_CONTENT_EDGE_BUDGET)

    // 在窄窗口轻微向外拖一下并提交
    const committed = preferenceFromDrag(narrowColumn, preference, narrowDisplay, narrowDisplay + 5)

    // 回到大窗口：宽度应恢复，而不是停在窄窗口的钳制值
    expect(resolveChatContentWidth(wideColumn, committed)).toBe(1400)
  })
})
