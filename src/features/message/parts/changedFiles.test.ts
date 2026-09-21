import { describe, expect, it, vi } from 'vitest'
import { collectChangedFiles, sumChangedFiles, buildDiffPreview } from './changedFiles'
import type { ToolPart } from '../../../types/message'

vi.mock('../tools', () => ({
  extractToolData: (part: ToolPart) => (part as unknown as { __data: unknown }).__data,
}))

function toolPart(data: unknown, status: 'completed' | 'error' = 'completed'): ToolPart {
  return { __data: data, state: { status }, tool: 'edit' } as unknown as ToolPart
}

describe('collectChangedFiles', () => {
  it('merges repeated edits to the same file into one entry', () => {
    const parts = [
      toolPart({ diff: { before: 'a', after: 'b' }, filePath: 'src/a.ts', diffStats: { additions: 1, deletions: 1 } }),
      toolPart({ diff: { before: 'b', after: 'c' }, filePath: 'src/a.ts', diffStats: { additions: 1, deletions: 1 } }),
    ]

    const files = collectChangedFiles(parts)

    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('src/a.ts')
    expect(files[0].editCount).toBe(2)
    expect(files[0].hunks).toHaveLength(2)
    expect(files[0].additions).toBe(2)
    expect(files[0].deletions).toBe(2)
  })

  it('keeps distinct files separate and preserves first-seen order', () => {
    const parts = [
      toolPart({ diff: { before: 'a', after: 'b' }, filePath: 'src/a.ts' }),
      toolPart({ diff: { before: 'x', after: 'y' }, filePath: 'src/b.ts' }),
    ]

    const files = collectChangedFiles(parts)

    expect(files.map(f => f.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(files.every(f => f.editCount === 1)).toBe(true)
  })

  it('skips failed tools so a rejected edit does not show up as changed', () => {
    const parts = [toolPart({ diff: { before: 'a', after: 'b' }, filePath: 'src/a.ts' }, 'error')]
    expect(collectChangedFiles(parts)).toEqual([])
  })

  it('handles multi-file tool results', () => {
    const parts = [
      toolPart({
        files: [
          { filePath: 'src/a.ts', before: 'a', after: 'b' },
          { filePath: 'src/b.ts', before: 'x', after: 'y' },
        ],
      }),
    ]

    expect(collectChangedFiles(parts).map(f => f.path)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('computes stats from the diff when the tool does not report them', () => {
    const parts = [toolPart({ diff: { before: 'a\nb', after: 'a\nc' }, filePath: 'src/a.ts' })]
    const files = collectChangedFiles(parts)
    expect(files[0].additions).toBe(1)
    expect(files[0].deletions).toBe(1)
  })

  it('ignores tools that changed nothing', () => {
    expect(collectChangedFiles([toolPart({ output: 'ok' })])).toEqual([])
  })
})

describe('sumChangedFiles', () => {
  it('returns undefined when there is nothing to summarize', () => {
    expect(sumChangedFiles([])).toBeUndefined()
  })

  it('adds up additions and deletions across files', () => {
    const files = collectChangedFiles([
      toolPart({ diff: { before: 'a', after: 'b' }, filePath: 'src/a.ts', diffStats: { additions: 3, deletions: 1 } }),
      toolPart({ diff: { before: 'x', after: 'y' }, filePath: 'src/b.ts', diffStats: { additions: 5, deletions: 2 } }),
    ])
    expect(sumChangedFiles(files)).toEqual({ additions: 8, deletions: 3 })
  })
})

describe('buildDiffPreview', () => {
  it('numbers each edit and keeps them as separate sections', () => {
    const sections = buildDiffPreview([
      { before: 'a', after: 'b', additions: 1, deletions: 1 },
      { before: 'c', after: 'd', additions: 1, deletions: 1 },
    ])

    expect(sections).toHaveLength(2)
    expect(sections.map(s => s.index)).toEqual([1, 2])
    expect(sections[0].lines.some(l => l.type === 'add')).toBe(true)
    expect(sections[0].lines.some(l => l.type === 'del')).toBe(true)
  })

  it('marks a section as truncated when it exceeds the line budget', () => {
    const before = Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n')
    const after = Array.from({ length: 120 }, (_, i) => `changed ${i}`).join('\n')

    const [section] = buildDiffPreview([{ before, after, additions: 120, deletions: 120 }])

    expect(section.truncated).toBe(true)
    expect(section.lines.length).toBeLessThanOrEqual(60)
  })

  it('does not truncate a small diff', () => {
    const [section] = buildDiffPreview([{ before: 'a\nb', after: 'a\nc', additions: 1, deletions: 1 }])
    expect(section.truncated).toBe(false)
  })
})
