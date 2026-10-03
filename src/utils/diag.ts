// ============================================
// diag - 临时诊断日志（排查「发送后不显示 / SSE 事件收不到」）
//
// 默认关闭（不污染控制台）。需要排查时在控制台执行：
//   __DIAG__.all()                 // 全开
//   __DIAG__.only('SEND','PANE')   // 只看这几类
//   __DIAG__.off()                 // 关闭
//   __DIAG__.channels()            // 看当前开启的频道
// 排查结束后整体删除本文件与所有 diag(...) 调用即可。
// ============================================

type Channel = 'SEND' | 'PANE' | 'SSE' | 'STORE'

const ALL: Channel[] = ['SEND', 'PANE', 'SSE', 'STORE']
const enabled = new Set<Channel>()

function fmt(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function diag(channel: Channel, ...args: unknown[]): void {
  if (!enabled.has(channel)) return
  console.log(`[DIAG ${channel}] ${args.map(fmt).join(' ')}`)
}

if (typeof window !== 'undefined') {
  ;(window as unknown as { __DIAG__: unknown }).__DIAG__ = {
    only: (...channels: Channel[]) => {
      enabled.clear()
      channels.forEach(c => enabled.add(c))
      console.log('[DIAG] only:', [...enabled].join(','))
    },
    all: () => {
      ALL.forEach(c => enabled.add(c))
      console.log('[DIAG] all on')
    },
    on: () => {
      ALL.forEach(c => enabled.add(c))
      console.log('[DIAG] on')
    },
    off: () => {
      enabled.clear()
      console.log('[DIAG] off')
    },
    channels: () => [...enabled],
  }
}
