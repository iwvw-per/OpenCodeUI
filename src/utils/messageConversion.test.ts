import { describe, expect, it } from 'vitest'
import { toUIMessage } from './messageConversion'
import type { ApiMessageWithParts } from '../api/types'

function envelope(extra: Record<string, unknown> = {}): ApiMessageWithParts {
  return {
    info: { id: 'a1', sessionID: 'ses-1', role: 'assistant', time: { created: 1 } },
    parts: [{ id: 't1', sessionID: 'ses-1', messageID: 'a1', type: 'text', text: 'hi' }],
    ...extra,
  } as unknown as ApiMessageWithParts
}

describe('toUIMessage lightweight mapping', () => {
  it('marks messages with a lightweight field as compressed with stats', () => {
    const message = toUIMessage(envelope({ lightweight: { reasoningCount: 2, stepCount: 3 } }))
    expect(message.isCompressed).toBe(true)
    expect(message.compressedStats).toEqual({ reasoningCount: 2, stepCount: 3 })
  })

  it('leaves normal messages uncompressed', () => {
    const message = toUIMessage(envelope())
    expect(message.isCompressed).toBeUndefined()
    expect(message.compressedStats).toBeUndefined()
  })

  it('defaults missing lightweight counts to zero', () => {
    const message = toUIMessage(envelope({ lightweight: {} }))
    expect(message.isCompressed).toBe(true)
    expect(message.compressedStats).toEqual({ reasoningCount: 0, stepCount: 0 })
  })
})
