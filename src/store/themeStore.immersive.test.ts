import { beforeEach, describe, expect, it } from 'vitest'
import { themeStore, type ToolCardStyle } from './themeStore'

/**
 * 沉浸模式是「预设 + 4 个继承项」的结构：
 *   setImmersiveMode 内部会一并改写 inlineToolRequests / descriptiveToolSteps /
 *   toolCardStyle / compactInlinePermission，并逐个落盘。
 *
 * 这里锁定该级联行为，以及「子项单独变更不会反向改写 immersiveMode」这一事实
 * —— 设置页正是基于后者，用派生值而不是 store 值来渲染总开关。
 */
describe('themeStore immersive mode cascade', () => {
  beforeEach(() => {
    localStorage.clear()
    // themeStore 是单例，内存状态不随 localStorage.clear() 复位。
    // setImmersiveMode 有「值相同即 return」的短路，前一个用例若留下
    // immersiveMode=true，后面的用例就会因短路而什么都没发生。
    // 这里显式归零，保证每个用例从已知状态出发。
    themeStore.setImmersiveMode(true)
    themeStore.setImmersiveMode(false)
  })

  it('turning immersive on enables all four inheriting settings', () => {
    themeStore.setImmersiveMode(false)
    themeStore.setImmersiveMode(true)

    expect(themeStore.immersiveMode).toBe(true)
    expect(themeStore.inlineToolRequests).toBe(true)
    expect(themeStore.descriptiveToolSteps).toBe(true)
    expect(themeStore.toolCardStyle).toBe('compact')
    expect(themeStore.compactInlinePermission).toBe(true)
  })

  it('turning immersive off disables all four inheriting settings', () => {
    themeStore.setImmersiveMode(true)
    themeStore.setImmersiveMode(false)

    expect(themeStore.immersiveMode).toBe(false)
    expect(themeStore.inlineToolRequests).toBe(false)
    expect(themeStore.descriptiveToolSteps).toBe(false)
    expect(themeStore.toolCardStyle).toBe('classic')
    expect(themeStore.compactInlinePermission).toBe(false)
  })

  it('does not reverse-update immersiveMode when a child changes on its own', () => {
    themeStore.setImmersiveMode(true)
    themeStore.setCompactInlinePermission(false)

    // 关键：子项改动只影响自己，immersiveMode 保持原值不变。
    // 设置页因此必须用「四项是否都符合」推导总开关显示值，
    // 而不能直接读 themeStore.immersiveMode。
    expect(themeStore.compactInlinePermission).toBe(false)
    expect(themeStore.immersiveMode).toBe(true)
  })

  it('keeps the other children intact when one child is turned off', () => {
    themeStore.setImmersiveMode(true)
    themeStore.setCompactInlinePermission(false)

    expect(themeStore.inlineToolRequests).toBe(true)
    expect(themeStore.descriptiveToolSteps).toBe(true)
    expect(themeStore.toolCardStyle).toBe('compact')
  })

  it('short-circuits when set to the same value, leaving children untouched', () => {
    themeStore.setImmersiveMode(true)
    themeStore.setCompactInlinePermission(false)
    // immersiveMode 已是 true，再次置 true 会短路返回，children 不被恢复
    themeStore.setImmersiveMode(true)

    expect(themeStore.compactInlinePermission).toBe(false)
    expect(themeStore.immersiveMode).toBe(true)
  })

  it('derives the effective immersive state from the four children', () => {
    // 复刻设置页的派生逻辑，锁定「任一项偏离即视为关闭」的语义
    const derive = () =>
      themeStore.inlineToolRequests &&
      themeStore.descriptiveToolSteps &&
      themeStore.compactInlinePermission &&
      themeStore.toolCardStyle === 'compact'

    themeStore.setImmersiveMode(true)
    expect(derive()).toBe(true)

    themeStore.setCompactInlinePermission(false)
    expect(derive()).toBe(false)

    themeStore.setCompactInlinePermission(true)
    expect(derive()).toBe(true)

    // 工具输出风格偏离「精简」同样视为关闭
    themeStore.setToolCardStyle('classic' as ToolCardStyle)
    expect(derive()).toBe(false)
  })
})
