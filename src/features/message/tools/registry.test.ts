import { describe, expect, it } from 'vitest'
import type { ToolPart } from '../../../types/message'
import { defaultExtractData, getToolColorClass } from './registry'

describe('defaultExtractData', () => {
  it('extracts files and diagnostics from metadata', () => {
    const part = {
      type: 'tool',
      tool: 'read',
      id: 'tool-1',
      callID: 'call-1',
      sessionID: 'session-1',
      messageID: 'message-1',
      state: {
        input: { filePath: 'src/app.ts' },
        metadata: {
          files: [
            {
              filePath: 'src/app.ts',
              diff: '@@ -1 +1 @@',
              additions: 1,
              deletions: 1,
            },
          ],
          diagnostics: {
            'src/app.ts': [
              {
                severity: 1,
                message: 'Syntax error',
                range: { start: { line: 3, character: 5 } },
              },
            ],
          },
        },
      },
    } as unknown as ToolPart

    const extracted = defaultExtractData(part)

    expect(extracted.files).toEqual([expect.objectContaining({ filePath: 'src/app.ts', additions: 1, deletions: 1 })])
    expect(extracted.diagnostics).toEqual([
      expect.objectContaining({ file: 'app.ts', severity: 'error', line: 3, column: 5 }),
    ])
  })
})

describe('getToolColorClass', () => {
  it('maps known tools to distinct category colors', () => {
    expect(getToolColorClass('read')).toBe('tool-color-read')
    expect(getToolColorClass('write')).toBe('tool-color-write')
    expect(getToolColorClass('bash')).toBe('tool-color-exec')
    expect(getToolColorClass('grep')).toBe('tool-color-search')
    expect(getToolColorClass('webfetch')).toBe('tool-color-network')
    expect(getToolColorClass('task')).toBe('tool-color-task')
    expect(getToolColorClass('todo')).toBe('tool-color-todo')
  })

  it('falls back to the default color for unknown tools', () => {
    expect(getToolColorClass('some-unknown-tool')).toBe('tool-color-default')
  })
})
