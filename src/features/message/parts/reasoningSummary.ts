/**
 * 折叠态摘要：挑出第一条「有内容」的行。
 *
 * 思维链常以围栏代码块、分隔线或空行开头，若直接取第一行，摘要会变成
 * ``` 、--- 这类无信息量的符号。这里跳过这些结构行，取第一条真正的文字行。
 *
 * 返回的是**原始行**，不剥 markdown —— 折叠预览仍走 MarkdownRenderer，
 * 标记由渲染器处理；这里只负责选中哪一行。
 */

const FENCE_PATTERN = /^\s*(```|~~~)/
const HR_PATTERN = /^\s{0,3}(?:[-*_]\s*){3,}$/
/** 只有标记、没有文字的伪内容行 */
const MARKER_ONLY_PATTERN = /^[\s#>*+\-_.|`~[\]()]*$/

export function firstMeaningfulLine(markdown: string): string {
  const lines = (markdown || '').split(/\r?\n/)
  let inFence = false

  for (const raw of lines) {
    if (FENCE_PATTERN.test(raw)) {
      inFence = !inFence
      continue
    }
    // 代码块整体跳过：它是实现细节，不是思维链的要点
    if (inFence) continue

    const trimmed = raw.trim()
    if (!trimmed) continue
    if (HR_PATTERN.test(raw)) continue
    if (MARKER_ONLY_PATTERN.test(trimmed)) continue

    return trimmed
  }

  return ''
}
