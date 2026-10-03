/**
 * 回归：大会话「一次拉全」后不得陷入「加载历史记录」空拉循环，
 * 且投影后的小体积会话不应被误裁。
 *
 * 背景（issue: 界面反复显示「加载历史记录」）：
 * 轻量路径一次拉回整段会话，旧代码按**条数**上限 500 裁剪。裁剪若把
 * hasMoreHistory 强制置真并清空游标，loadMoreHistory 的无游标分支会用
 * 「当前条数的一半」重拉**最新**一页 —— 与内存完全重叠、去重后一条不剩，
 * 但 prependMessages 又照抄该页 hasMore，于是「上滑 → 空拉 → 仍说还有 →
 * 再上滑」自我维持。
 *
 * 修复要点：
 * 1. 裁剪只记录 trimmedCount（内存缺口），不再置 hasMoreHistory。
 * 2. 上限改为按**体积**记账（投影后单条约 0.8KB，不再被 500 条误裁）。
 * 3. loadMoreHistory 以 trimmedCount 识别缺口并按缺口补拉。
 * 4. 无游标重拉时，只有在「确实补进了更早内容」且服务端仍报 hasMore 时，
 *    才继续认为还有历史。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { messageStore } from './messageStore'

/** 每条约 400 字节文本 + 工具壳，接近真实投影消息（实测约 845B） */
function makeApiMessage(index: number) {
  return {
    info: {
      id: `msg-${index}`,
      sessionID: 'session-1',
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      time: { created: index + 1, completed: index + 2 },
    },
    parts: [
      { type: 'text' as const, text: `content ${index} `.repeat(30), id: `part-${index}` },
      { type: 'step-finish' as const, reason: 'stop', tokens: { input: 10, output: 5 }, id: `sf-${index}` },
    ],
  }
}

function makeApiMessages(count: number, offset = 0) {
  return Array.from({ length: count }, (_, i) => makeApiMessage(offset + i))
}

describe('session message budget', () => {
  beforeEach(() => {
    messageStore.clearAll()
  })

  it('keeps a large projected session intact instead of trimming at 500 messages', () => {
    // 投影后 1200 条约 1MB，远低于体积预算 —— 必须完整保留。
    // 旧代码按 500 条裁剪会丢掉最前面 700 条，导致首屏看不到最早几轮。
    messageStore.setMessages('session-1', makeApiMessages(1200) as never, {
      hasMoreHistory: false,
      historyCursor: undefined,
      directory: '/workspace/demo',
    })

    const state = messageStore.getSessionState('session-1')!

    expect(state.messages).toHaveLength(1200)
    expect(state.messages[0].info.id).toBe('msg-0')
    // 没有缺口，也就没有任何「还有历史」的虚假信号
    expect(messageStore.getTrimmedCount('session-1')).toBe(0)
    expect(state.hasMoreHistory).toBe(false)
  })

  it('trims by bytes when a session genuinely exceeds the budget', () => {
    // 构造超预算会话：每条 ~2MB（命中单条计费上限），少量条数即可越过 12MB
    const heavy = Array.from({ length: 10 }, (_, i) => ({
      info: {
        id: `heavy-${i}`,
        sessionID: 'session-1',
        role: 'assistant' as const,
        time: { created: i + 1, completed: i + 2 },
      },
      parts: [{ type: 'text' as const, text: 'x'.repeat(2 * 1024 * 1024), id: `p-${i}` }],
    }))

    messageStore.setMessages('session-1', heavy as never, {
      hasMoreHistory: false,
      historyCursor: undefined,
    })

    const state = messageStore.getSessionState('session-1')!
    // 12MB 预算 / 每条按 2MB 计费上限 ≈ 6 条
    expect(state.messages.length).toBeLessThan(10)
    expect(state.messages.length).toBeGreaterThan(0)
    // 被裁部分记为缺口，且不伪造 hasMoreHistory
    expect(messageStore.getTrimmedCount('session-1')).toBe(10 - state.messages.length)
    expect(state.hasMoreHistory).toBe(false)
  })

  it('never drops the newest messages, even for a single oversized message', () => {
    const huge = [
      makeApiMessage(0),
      {
        info: {
          id: 'huge-1',
          sessionID: 'session-1',
          role: 'assistant' as const,
          time: { created: 99, completed: 100 },
        },
        parts: [{ type: 'text' as const, text: 'z'.repeat(4 * 1024 * 1024), id: 'p-huge' }],
      },
    ]

    messageStore.setMessages('session-1', huge as never, { hasMoreHistory: false })

    const state = messageStore.getSessionState('session-1')!
    // 最新一条必须始终保留：用户正在看的就是尾部
    expect(state.messages[state.messages.length - 1].info.id).toBe('huge-1')
  })

  it('clears the gap once the trimmed messages are recovered', () => {
    messageStore.setMessages('session-1', makeApiMessages(1200) as never, {
      hasMoreHistory: false,
      historyCursor: undefined,
    })
    expect(messageStore.getTrimmedCount('session-1')).toBe(0)

    messageStore.prependMessages('session-1', makeApiMessages(100, -100) as never, false, undefined)
    expect(messageStore.getTrimmedCount('session-1')).toBe(0)
    expect(messageStore.getSessionState('session-1')!.messages).toHaveLength(1300)
  })

  it('an overlapping (no-op) refetch cannot keep the loop alive', () => {
    messageStore.setMessages('session-1', makeApiMessages(1200) as never, {
      hasMoreHistory: false,
      historyCursor: undefined,
    })

    // 模拟旧的错误路径：服务端重拉最新一页，与内存完全重叠
    const refetched = makeApiMessages(250, 950)
    const existingIds = new Set(messageStore.getSessionState('session-1')!.messages.map(m => m.info.id))
    const unique = refetched.filter(m => !existingIds.has(m.info.id))
    expect(unique).toHaveLength(0)

    messageStore.prependMessages('session-1', unique as never, false, undefined)

    const after = messageStore.getSessionState('session-1')!
    expect(after.hasMoreHistory).toBe(false)
    expect(after.messages).toHaveLength(1200)
    expect(messageStore.getTrimmedCount('session-1')).toBe(0)
  })

  it('does not shrink the gap when a refetch yields no new messages', () => {
    const heavy = Array.from({ length: 10 }, (_, i) => ({
      info: {
        id: `heavy-${i}`,
        sessionID: 'session-1',
        role: 'assistant' as const,
        time: { created: i + 1, completed: i + 2 },
      },
      parts: [{ type: 'text' as const, text: 'x'.repeat(2 * 1024 * 1024), id: `p-${i}` }],
    }))
    messageStore.setMessages('session-1', heavy as never, { hasMoreHistory: false })

    const before = messageStore.getTrimmedCount('session-1')
    expect(before).toBeGreaterThan(0)

    messageStore.prependMessages('session-1', [] as never, false, undefined)
    // 空拉不应该把缺口「算作已补」
    expect(messageStore.getTrimmedCount('session-1')).toBe(before)
  })
})
