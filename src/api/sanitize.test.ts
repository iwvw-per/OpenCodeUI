import { describe, expect, it } from 'vitest'
import {
  sanitizeMessageWithParts,
  stripMessageSummaryDiffs,
  stripPartAttachments,
  stripSessionDiffSnapshots,
  stripSessionListDetails,
} from './sanitize'
import type { ApiMessage, ApiMessageWithParts, ApiSession } from './types'

function makeInfo(extra: Record<string, unknown> = {}): ApiMessage {
  return { id: 'msg_1', sessionID: 'ses_1', role: 'assistant', ...extra } as unknown as ApiMessage
}

describe('stripMessageSummaryDiffs', () => {
  it('removes summary.diffs but keeps title and body', () => {
    const info = makeInfo({
      summary: { title: 't', body: 'b', diffs: [{ path: 'a.ts', diff: 'x'.repeat(1000) }] },
    })

    const result = stripMessageSummaryDiffs(info) as unknown as { summary: Record<string, unknown> }

    expect(result.summary.title).toBe('t')
    expect(result.summary.body).toBe('b')
    expect('diffs' in result.summary).toBe(false)
  })

  it('returns the same reference when there is nothing to strip', () => {
    const info = makeInfo({ summary: { title: 't' } })
    expect(stripMessageSummaryDiffs(info)).toBe(info)
  })

  it('returns the same reference when summary is absent', () => {
    const info = makeInfo()
    expect(stripMessageSummaryDiffs(info)).toBe(info)
  })

  it('does not mutate the input', () => {
    const summary = { title: 't', diffs: [{ path: 'a' }] }
    const info = makeInfo({ summary })

    stripMessageSummaryDiffs(info)

    expect(summary.diffs).toHaveLength(1)
  })
})

describe('stripPartAttachments', () => {
  it('removes tool state.attachments while keeping other state fields', () => {
    const part = {
      type: 'tool',
      id: 'prt_1',
      state: { status: 'completed', output: 'ok', attachments: [{ url: 'data:image/png;base64,AAA' }] },
    } as unknown as ApiMessageWithParts['parts'][number]

    const result = stripPartAttachments(part) as unknown as { state: Record<string, unknown> }

    expect(result.state.output).toBe('ok')
    expect(result.state.status).toBe('completed')
    expect('attachments' in result.state).toBe(false)
  })

  it('keeps state.metadata.diff and filediff, which the tool card renders', () => {
    const part = {
      type: 'tool',
      id: 'prt_1',
      state: {
        status: 'completed',
        metadata: { diff: 'unified diff text', filediff: { patch: 'patch text', additions: 1 } },
      },
    } as unknown as ApiMessageWithParts['parts'][number]

    const result = stripPartAttachments(part)

    expect(result).toBe(part)
    const state = (result as unknown as { state: { metadata: Record<string, unknown> } }).state
    expect(state.metadata.diff).toBe('unified diff text')
    expect(state.metadata.filediff).toEqual({ patch: 'patch text', additions: 1 })
  })

  it('ignores non-tool parts', () => {
    const part = { type: 'text', id: 'prt_1', text: 'hi' } as unknown as ApiMessageWithParts['parts'][number]
    expect(stripPartAttachments(part)).toBe(part)
  })

  it('returns the same reference when attachments is empty', () => {
    const part = {
      type: 'tool',
      id: 'prt_1',
      state: { status: 'completed', attachments: [] },
    } as unknown as ApiMessageWithParts['parts'][number]
    expect(stripPartAttachments(part)).toBe(part)
  })
})

describe('sanitizeMessageWithParts', () => {
  it('strips both summary.diffs and part attachments in one pass', () => {
    const message = {
      info: makeInfo({ summary: { title: 't', diffs: [{ path: 'a' }] } }),
      parts: [
        { type: 'text', id: 'p1', text: 'hello' },
        { type: 'tool', id: 'p2', state: { status: 'completed', attachments: [{ url: 'x' }] } },
      ],
    } as unknown as ApiMessageWithParts

    const result = sanitizeMessageWithParts(message)

    expect('diffs' in ((result.info as unknown as { summary: object }).summary as object)).toBe(false)
    const toolState = (result.parts[1] as unknown as { state: Record<string, unknown> }).state
    expect('attachments' in toolState).toBe(false)
    expect((result.parts[0] as unknown as { text: string }).text).toBe('hello')
  })

  it('returns the same reference when nothing needs stripping', () => {
    const message = {
      info: makeInfo(),
      parts: [{ type: 'text', id: 'p1', text: 'hello' }],
    } as unknown as ApiMessageWithParts

    expect(sanitizeMessageWithParts(message)).toBe(message)
  })

  it('preserves the identity of untouched parts when one part changes', () => {
    const untouched = { type: 'text', id: 'p1', text: 'hello' }
    const message = {
      info: makeInfo(),
      parts: [untouched, { type: 'tool', id: 'p2', state: { status: 'completed', attachments: [{ url: 'x' }] } }],
    } as unknown as ApiMessageWithParts

    const result = sanitizeMessageWithParts(message)

    expect(result.parts[0]).toBe(untouched)
  })

  it('does not mutate the input parts array', () => {
    const parts = [{ type: 'tool', id: 'p2', state: { status: 'completed', attachments: [{ url: 'x' }] } }]
    const message = { info: makeInfo(), parts } as unknown as ApiMessageWithParts

    sanitizeMessageWithParts(message)

    expect(parts[0]).toBe(parts[0])
    expect((parts[0] as unknown as { state: { attachments: unknown[] } }).state.attachments).toHaveLength(1)
  })
})

describe('stripSessionDiffSnapshots', () => {
  it('removes revert.snapshot and revert.diff but keeps the revert marker', () => {
    const session = {
      id: 'ses_1',
      revert: { messageID: 'msg_1', partID: 'prt_1', snapshot: 'huge', diff: 'huge' },
    } as unknown as ApiSession

    const result = stripSessionDiffSnapshots(session) as unknown as { revert: Record<string, unknown> }

    expect(result.revert.messageID).toBe('msg_1')
    expect(result.revert.partID).toBe('prt_1')
    expect('snapshot' in result.revert).toBe(false)
    expect('diff' in result.revert).toBe(false)
  })

  it('removes session.summary.diffs', () => {
    const session = { id: 'ses_1', summary: { diffs: [{ path: 'a' }], other: 1 } } as unknown as ApiSession

    const result = stripSessionDiffSnapshots(session) as unknown as { summary: Record<string, unknown> }

    expect('diffs' in result.summary).toBe(false)
    expect(result.summary.other).toBe(1)
  })

  it('returns the same reference when there is nothing to strip', () => {
    const session = { id: 'ses_1' } as unknown as ApiSession
    expect(stripSessionDiffSnapshots(session)).toBe(session)
  })
})

describe('stripSessionListDetails', () => {
  it('reduces revert to a messageID/partID marker', () => {
    const session = {
      id: 'ses_1',
      revert: { messageID: 'msg_1', partID: 'prt_1', snapshot: 'huge' },
    } as unknown as ApiSession

    const result = stripSessionListDetails(session) as unknown as { revert: Record<string, unknown> }

    expect(result.revert).toEqual({ messageID: 'msg_1', partID: 'prt_1' })
  })

  it('drops summary.diffs and permission from list records', () => {
    const session = {
      id: 'ses_1',
      summary: { diffs: [{ path: 'a' }], title: 'keep' },
      permission: [{ huge: true }],
    } as unknown as ApiSession

    const result = stripSessionListDetails(session) as unknown as {
      summary: Record<string, unknown>
      permission?: unknown
    }

    expect('diffs' in result.summary).toBe(false)
    expect(result.summary.title).toBe('keep')
    expect('permission' in result).toBe(false)
  })

  it('returns the same reference for a plain session record', () => {
    const session = { id: 'ses_1', title: 'plain' } as unknown as ApiSession
    expect(stripSessionListDetails(session)).toBe(session)
  })
})
