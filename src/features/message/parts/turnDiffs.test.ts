import { describe, expect, it } from 'vitest'
import { collectTurnDiffsFromMessages } from './turnDiffs'

function userMessage(id: string) {
  return { info: { role: 'user', id }, parts: [] as unknown[] }
}

function assistantWithTool(id: string, toolPart: unknown) {
  return { info: { role: 'assistant', id }, parts: [toolPart] }
}

function toolPart(overrides: {
  tool?: string
  status?: string
  title?: string
  input?: Record<string, unknown>
  metadata?: Record<string, unknown>
}) {
  return {
    type: 'tool',
    id: `prt-${Math.random().toString(36).slice(2)}`,
    tool: overrides.tool ?? 'edit',
    state: {
      status: overrides.status ?? 'completed',
      title: overrides.title,
      input: overrides.input,
      metadata: overrides.metadata,
    },
  }
}

describe('collectTurnDiffsFromMessages', () => {
  it('collects files from metadata.files', () => {
    const messages = [
      userMessage('u1'),
      assistantWithTool('a1', toolPart({
        metadata: {
          files: [
            { filePath: 'src/a.ts', additions: 3, deletions: 1, diff: '@@ -1 +1 @@\n-a\n+b' },
            { filePath: 'src/b.ts', additions: 2, deletions: 0 },
          ],
        },
      })),
    ]

    const diffs = collectTurnDiffsFromMessages(messages)

    expect(diffs.map(d => d.file).sort()).toEqual(['src/a.ts', 'src/b.ts'])
    const a = diffs.find(d => d.file === 'src/a.ts')!
    expect(a.additions).toBe(3)
    expect(a.deletions).toBe(1)
  })

  it('collects from metadata.filediff patch', () => {
    const messages = [
      userMessage('u1'),
      assistantWithTool('a1', toolPart({
        metadata: { filepath: 'src/c.ts', filediff: { patch: '@@ -1 +1 @@\n-x\n+y', additions: 1, deletions: 1 } },
      })),
    ]

    const diffs = collectTurnDiffsFromMessages(messages)
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toMatchObject({ file: 'src/c.ts', additions: 1, deletions: 1 })
    expect(diffs[0].patch).toContain('@@')
  })

  it('merges multiple edits to the same file and sums stats', () => {
    const messages = [
      userMessage('u1'),
      assistantWithTool('a1', toolPart({ metadata: { filepath: 'src/a.ts', filediff: { patch: '@@\n-a\n+b', additions: 1, deletions: 1 } } })),
      assistantWithTool('a2', toolPart({ metadata: { filepath: 'src/a.ts', filediff: { patch: '@@\n-c\n+d', additions: 1, deletions: 1 } } })),
    ]

    const diffs = collectTurnDiffsFromMessages(messages)
    expect(diffs).toHaveLength(1)
    expect(diffs[0].additions).toBe(2)
    expect(diffs[0].deletions).toBe(2)
  })

  it('ignores tool parts before the last user message', () => {
    const messages = [
      userMessage('u1'),
      assistantWithTool('a0', toolPart({ metadata: { filepath: 'src/old.ts', filediff: { patch: '@@\n-a\n+b', additions: 1, deletions: 1 } } })),
      userMessage('u2'),
      assistantWithTool('a1', toolPart({ metadata: { filepath: 'src/new.ts', filediff: { patch: '@@\n-a\n+b', additions: 1, deletions: 1 } } })),
    ]

    const diffs = collectTurnDiffsFromMessages(messages)
    expect(diffs.map(d => d.file)).toEqual(['src/new.ts'])
  })

  it('ignores errored tool parts', () => {
    const messages = [
      userMessage('u1'),
      assistantWithTool('a1', toolPart({ status: 'error', metadata: { filepath: 'src/a.ts', filediff: { patch: '@@\n-a\n+b' } } })),
    ]

    expect(collectTurnDiffsFromMessages(messages)).toEqual([])
  })

  it('returns an empty array when there are no tool changes', () => {
    const messages = [userMessage('u1'), { info: { role: 'assistant', id: 'a1' }, parts: [{ type: 'text', text: 'hi' }] }]
    expect(collectTurnDiffsFromMessages(messages)).toEqual([])
  })

  it('computes additions/deletions from before/after when stats are absent', () => {
    const messages = [
      userMessage('u1'),
      assistantWithTool('a1', toolPart({ metadata: { filepath: 'src/a.ts', filediff: { before: 'a\nb', after: 'a\nc\nd' } } })),
    ]

    const diffs = collectTurnDiffsFromMessages(messages)
    expect(diffs[0]).toMatchObject({ file: 'src/a.ts', additions: 2, deletions: 1 })
  })
})
