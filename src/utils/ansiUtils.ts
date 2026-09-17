/**
 * ANSI escape code 处理工具
 *
 * 支持两种模式：
 * - stripAnsi: 纯净文本，去掉所有控制符
 * - parseAnsi: 解析为带颜色信息的 segments，用于渲染彩色终端输出
 */

// ANSI escape sequence 正则
// 匹配 CSI (Control Sequence Introducer) 序列：ESC[ ... 终止符
// 用字符串构造（而非正则字面量），避免 no-control-regex 误报
const ANSI_PATTERN = '\\x1b\\[[0-9;]*m'

// 无状态检测用：不带 g 标志，test() 不会推进 lastIndex
const ANSI_TEST_RE = new RegExp(ANSI_PATTERN)

// replace() 全程重扫，不依赖 lastIndex，可安全复用带 g 的实例
const ANSI_RE = new RegExp(ANSI_PATTERN, 'g')

/**
 * 去掉所有 ANSI escape codes
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

// ============================================
// ANSI → colored segments
// ============================================

export interface AnsiSegment {
  text: string
  fg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
}

// 标准 ANSI 3/4-bit 颜色映射
const ANSI_COLORS: Record<number, string> = {
  30: 'var(--ansi-black, #545454)',
  31: 'var(--ansi-red, #cf4647)',
  32: 'var(--ansi-green, #4ea24c)',
  33: 'var(--ansi-yellow, #c4a500)',
  34: 'var(--ansi-blue, #3d7ec7)',
  35: 'var(--ansi-magenta, #b44e91)',
  36: 'var(--ansi-cyan, #21a8a5)',
  37: 'var(--ansi-white, #cccccc)',
  // 高亮/明亮色
  90: 'var(--ansi-bright-black, #767676)',
  91: 'var(--ansi-bright-red, #f0706f)',
  92: 'var(--ansi-bright-green, #7bc96f)',
  93: 'var(--ansi-bright-yellow, #e3d94e)',
  94: 'var(--ansi-bright-blue, #6cb5ed)',
  95: 'var(--ansi-bright-magenta, #d07fd0)',
  96: 'var(--ansi-bright-cyan, #5fd7d7)',
  97: 'var(--ansi-bright-white, #eeeeee)',
}

interface AnsiState {
  fg?: string
  bold: boolean
  dim: boolean
  italic: boolean
}

/**
 * 解析含 ANSI 控制符的文本为 segments
 */
export function parseAnsi(text: string): AnsiSegment[] {
  const segments: AnsiSegment[] = []
  const state: AnsiState = { bold: false, dim: false, italic: false }

  let lastIndex = 0

  // 独立实例：exec() 会修改 lastIndex，不复用模块级正则以免相互干扰
  const iterator = new RegExp(ANSI_PATTERN, 'g')

  let match: RegExpExecArray | null
  while ((match = iterator.exec(text)) !== null) {
    // 控制符前面的文本
    if (match.index > lastIndex) {
      const chunk = text.slice(lastIndex, match.index)
      if (chunk) {
        segments.push({
          text: chunk,
          fg: state.fg,
          bold: state.bold || undefined,
          dim: state.dim || undefined,
          italic: state.italic || undefined,
        })
      }
    }
    lastIndex = iterator.lastIndex

    // 解析 SGR 参数
    const params = match[0].slice(2, -1) // 去掉 ESC[ 和 m
    const codes = params === '' ? [0] : params.split(';').map(Number)

    for (const code of codes) {
      if (code === 0) {
        // Reset
        state.fg = undefined
        state.bold = false
        state.dim = false
        state.italic = false
      } else if (code === 1) {
        state.bold = true
      } else if (code === 2) {
        state.dim = true
      } else if (code === 3) {
        state.italic = true
      } else if (code === 22) {
        state.bold = false
        state.dim = false
      } else if (code === 23) {
        state.italic = false
      } else if (code === 39) {
        state.fg = undefined
      } else if (ANSI_COLORS[code]) {
        state.fg = ANSI_COLORS[code]
      }
    }
  }

  // 剩余文本
  if (lastIndex < text.length) {
    const chunk = text.slice(lastIndex)
    if (chunk) {
      segments.push({
        text: chunk,
        fg: state.fg,
        bold: state.bold || undefined,
        dim: state.dim || undefined,
        italic: state.italic || undefined,
      })
    }
  }

  return segments
}

/**
 * 检测文本是否包含 ANSI escape codes
 */
export function hasAnsi(text: string): boolean {
  // 必须用无 g 标志的正则：带 g 的 test() 会推进 lastIndex，
  // 导致同一字符串连续调用交替返回 true/false。
  return ANSI_TEST_RE.test(text)
}
