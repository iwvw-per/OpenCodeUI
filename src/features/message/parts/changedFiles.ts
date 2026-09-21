import { diffLines } from 'diff'
import { extractToolData } from '../tools'
import { extractContentFromUnifiedDiff } from '../../../utils/diffUtils'
import type { ToolPart } from '../../../types/message'

/** 同一文件的一次修改（一个工具调用产生一段） */
export interface FileHunk {
  additions: number
  deletions: number
  before: string
  after: string
}

export interface ChangedFile {
  path: string
  /** 该文件所有修改的增行合计 */
  additions: number
  /** 该文件所有修改的删行合计 */
  deletions: number
  /** 按发生顺序排列的每次修改 */
  hunks: FileHunk[]
  /** 修改次数，> 1 时 chip 上标注 */
  editCount: number
}

export type DiffPreviewLineType = 'add' | 'del' | 'ctx'

export interface DiffPreviewLine {
  type: DiffPreviewLineType
  text: string
}

/** 单文件 diff 数据的公共形态 */
type DiffLike = { before: string; after: string } | string | undefined

function resolvePair(diff: DiffLike): { before: string; after: string } | undefined {
  if (!diff) return undefined
  if (typeof diff === 'object') return diff
  return extractContentFromUnifiedDiff(diff)
}

function countLines(before: string, after: string): { additions: number; deletions: number } {
  const changes = diffLines(before, after)
  let additions = 0
  let deletions = 0
  for (const change of changes) {
    if (change.added) additions += change.count || 0
    if (change.removed) deletions += change.count || 0
  }
  return { additions, deletions }
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

/**
 * 从工具组里收集所有改动过的文件。
 *
 * 同一文件被多次改动时合并为一条，各次修改按发生顺序存进 `hunks`，
 * 增删行数取合计 —— 否则一个文件改了三处会在概览条上出现三个同名胶囊，
 * 既挤占空间又看不出「这是同一个文件」。
 */
export function collectChangedFiles(parts: ToolPart[]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>()

  const push = (path: string, hunk: FileHunk) => {
    const existing = byPath.get(path)
    if (existing) {
      existing.hunks.push(hunk)
      existing.additions += hunk.additions
      existing.deletions += hunk.deletions
      existing.editCount += 1
      return
    }
    byPath.set(path, {
      path,
      additions: hunk.additions,
      deletions: hunk.deletions,
      hunks: [hunk],
      editCount: 1,
    })
  }

  for (const part of parts) {
    if (part.state.status === 'error') continue
    const data = extractToolData(part)

    if (data.files?.length) {
      for (const file of data.files) {
        const pair = resolvePair(file.diff ?? file.patch) ?? { before: file.before ?? '', after: file.after ?? '' }
        const stats =
          file.additions !== undefined || file.deletions !== undefined
            ? { additions: file.additions || 0, deletions: file.deletions || 0 }
            : countLines(pair.before, pair.after)
        push(file.filePath, { ...stats, ...pair })
      }
      continue
    }

    const pair = resolvePair(data.diff)
    if (!pair) continue
    const stats = data.diffStats ?? countLines(pair.before, pair.after)
    push(data.filePath || basename(part.state.title || part.tool), {
      additions: stats.additions,
      deletions: stats.deletions,
      ...pair,
    })
  }

  return [...byPath.values()]
}

/** 汇总增删行数（供 header 显示总览） */
export function sumChangedFiles(files: ChangedFile[]): { additions: number; deletions: number } | undefined {
  let additions = 0
  let deletions = 0
  for (const file of files) {
    additions += file.additions
    deletions += file.deletions
  }
  return additions || deletions ? { additions, deletions } : undefined
}

const PREVIEW_MAX_LINES = 60
const PREVIEW_CONTEXT = 2

export interface DiffPreviewSection {
  /** 第几次修改（从 1 起），同一文件多次修改时用于分隔 */
  index: number
  additions: number
  deletions: number
  lines: DiffPreviewLine[]
  /** 该段是否因超出预算被截断 */
  truncated: boolean
}

/**
 * 生成悬浮预览：每次修改各出一段，段内只保留改动行及其上下各 PREVIEW_CONTEXT 行。
 * 总预算 PREVIEW_MAX_LINES 按段顺序分配，避免同一文件改了很多次时浮层无限长。
 */
export function buildDiffPreview(hunks: FileHunk[]): DiffPreviewSection[] {
  let remaining = PREVIEW_MAX_LINES
  const sections: DiffPreviewSection[] = []

  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i]
    const { lines, truncated } = previewHunk(hunk, remaining)
    sections.push({
      index: i + 1,
      additions: hunk.additions,
      deletions: hunk.deletions,
      lines,
      truncated,
    })
    remaining -= lines.length
    if (remaining <= 0) break
  }

  return sections
}

function previewHunk(hunk: FileHunk, budget: number): { lines: DiffPreviewLine[]; truncated: boolean } {
  const changes = diffLines(hunk.before, hunk.after)
  const all: DiffPreviewLine[] = []

  for (const change of changes) {
    const type: DiffPreviewLineType = change.added ? 'add' : change.removed ? 'del' : 'ctx'
    const lines = (change.value ?? '').split('\n')
    if (lines[lines.length - 1] === '') lines.pop()
    for (const text of lines) all.push({ type, text })
  }

  if (all.length <= budget) return { lines: all, truncated: false }

  // 改动行及其上下文优先，其余折叠成省略标记
  const keep = new Set<number>()
  all.forEach((line, index) => {
    if (line.type === 'ctx') return
    for (let i = index - PREVIEW_CONTEXT; i <= index + PREVIEW_CONTEXT; i++) {
      if (i >= 0 && i < all.length) keep.add(i)
    }
  })

  const result: DiffPreviewLine[] = []
  let previous = -1
  let truncated = false
  for (const index of [...keep].sort((a, b) => a - b)) {
    if (previous !== -1 && index > previous + 1) {
      if (result.length + 1 >= budget) {
        truncated = true
        break
      }
      result.push({ type: 'ctx', text: '⋯' })
    }
    if (result.length >= budget) {
      truncated = true
      break
    }
    result.push(all[index])
    previous = index
  }

  return { lines: result, truncated }
}
