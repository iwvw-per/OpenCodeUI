import { beforeEach, describe, expect, it, vi } from 'vitest'

const { messagesMock, messageMock, getSDKClientMock } = vi.hoisted(() => ({
  messagesMock: vi.fn(),
  messageMock: vi.fn(),
  getSDKClientMock: vi.fn(),
}))

vi.mock('./sdk', () => ({
  getSDKClient: (...args: unknown[]) => getSDKClientMock(...args),
  unwrap: (result: { data?: unknown; error?: unknown }) => {
    if (result.error != null) throw result.error
    return result.data
  },
}))

vi.mock('../utils/sessionKey', () => ({
  resolveSessionTarget: (sessionId: string, serverId?: string) => ({ sessionId, serverId: serverId ?? 'srv' }),
}))

vi.mock('../utils/directoryUtils', () => ({
  formatPathForApi: (dir?: string) => dir,
}))

import { getSessionMessagePage, getSessionMessages } from './message'

type AnyMessage = {
  info: Record<string, unknown>
  parts: Array<Record<string, unknown>>
}

function envelope(overrides: Partial<AnyMessage> = {}): AnyMessage {
  return {
    info: { id: 'msg-1', sessionID: 'ses-1', role: 'user', time: { created: 1 } },
    parts: [],
    ...overrides,
  }
}

function sdkResult(messages: AnyMessage[], nextCursor?: string) {
  return {
    data: messages,
    response: {
      headers: {
        get: (name: string) => (name === 'X-Next-Cursor' ? (nextCursor ?? null) : null),
      },
    },
  }
}

describe('getSessionMessagePage projection', () => {
  beforeEach(() => {
    messagesMock.mockReset()
    messageMock.mockReset()
    getSDKClientMock.mockReset()
    getSDKClientMock.mockReturnValue({
      session: { messages: messagesMock, message: messageMock },
    })
  })

  it('strips summary.diffs while keeping the rest of summary', async () => {
    messagesMock.mockResolvedValue(
      sdkResult([
        envelope({
          info: {
            id: 'msg-1',
            sessionID: 'ses-1',
            role: 'user',
            time: { created: 1 },
            summary: { title: 'Keep me', diffs: [{ file: 'a.ts', patch: 'x'.repeat(5000) }] },
          },
        }),
      ]),
    )

    const page = await getSessionMessagePage('ses-1', 50)

    const summary = page.messages[0].info.summary as Record<string, unknown>
    expect(summary.title).toBe('Keep me')
    expect(summary.diffs).toBeUndefined()
  })

  it('strips tool state.attachments but keeps output and error', async () => {
    messagesMock.mockResolvedValue(
      sdkResult([
        envelope({
          parts: [
            {
              id: 'prt-1',
              type: 'tool',
              tool: 'read',
              state: {
                status: 'completed',
                output: 'file contents',
                attachments: [{ id: 'att-1', url: 'data:image/png;base64,' + 'A'.repeat(4000) }],
              },
            },
          ],
        }),
      ]),
    )

    const page = await getSessionMessagePage('ses-1', 50)

    const state = (page.messages[0].parts[0] as unknown as { state: Record<string, unknown> }).state
    expect(state.attachments).toBeUndefined()
    expect(state.output).toBe('file contents')
    expect(state.status).toBe('completed')
  })

  it('leaves messages without heavy fields untouched', async () => {
    const original = envelope({
      parts: [{ id: 'prt-1', type: 'text', text: 'hello' }],
    })
    messagesMock.mockResolvedValue(sdkResult([original]))

    const page = await getSessionMessagePage('ses-1', 50)

    expect(page.messages[0]).toBe(original)
  })

  it('passes through the cursor from X-Next-Cursor', async () => {
    messagesMock.mockResolvedValue(sdkResult([envelope()], 'cursor-abc'))

    const page = await getSessionMessagePage('ses-1', 50, 'cursor-prev')

    expect(page.nextCursor).toBe('cursor-abc')
    expect(messagesMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: 'ses-1', limit: 50, before: 'cursor-prev' }),
    )
  })

  it('skips projection when project:false so summary.diffs survives', async () => {
    messagesMock.mockResolvedValue(
      sdkResult([
        envelope({
          info: {
            id: 'msg-1',
            sessionID: 'ses-1',
            role: 'user',
            time: { created: 1 },
            summary: { title: 'Keep me', diffs: [{ file: 'a.ts', patch: 'diff-body' }] },
          },
        }),
      ]),
    )

    const messages = await getSessionMessages('ses-1', 50, undefined, undefined, { project: false })

    const summary = messages[0].info.summary as Record<string, unknown>
    expect(summary.diffs).toEqual([{ file: 'a.ts', patch: 'diff-body' }])
  })
})
