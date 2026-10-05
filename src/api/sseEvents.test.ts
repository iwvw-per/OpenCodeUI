import { describe, expect, it } from 'vitest'
import { parseAndCoalesce, parseGlobalEvent, coalesceEvents } from './sseEvents'
import { EventTypes } from '../types/api/event'
import type { GlobalEvent } from './types'

function deltaEvent(sessionID: string, messageID: string, partID: string, delta: string): string {
  return JSON.stringify({
    directory: 'global',
    payload: {
      type: EventTypes.MESSAGE_PART_DELTA,
      properties: { sessionID, messageID, partID, field: 'text', delta },
    },
  })
}

function partUpdatedEvent(sessionID: string, messageID: string, partID: string): string {
  return JSON.stringify({
    directory: 'global',
    payload: {
      type: EventTypes.MESSAGE_PART_UPDATED,
      properties: { sessionID, part: { id: partID, messageID, sessionID } },
    },
  })
}

describe('parseGlobalEvent', () => {
  it('parses a valid global event', () => {
    const event = parseGlobalEvent(deltaEvent('s', 'm', 'p', 'hi'))
    expect(event?.payload.type).toBe(EventTypes.MESSAGE_PART_DELTA)
  })

  it('returns null for malformed JSON', () => {
    expect(parseGlobalEvent('{not json')).toBeNull()
  })

  it('returns null for JSON that is not a global event', () => {
    expect(parseGlobalEvent(JSON.stringify({ hello: 'world' }))).toBeNull()
  })
})

describe('coalesceEvents', () => {
  it('merges consecutive deltas for the same part into one event', () => {
    const events = parseAndCoalesce([
      deltaEvent('s', 'm', 'p', 'a'),
      deltaEvent('s', 'm', 'p', 'b'),
      deltaEvent('s', 'm', 'p', 'c'),
    ])
    expect(events).toHaveLength(1)
    const props = (events[0].payload as { properties: { delta: string } }).properties
    expect(props.delta).toBe('abc')
  })

  it('keeps deltas for different parts separate', () => {
    const events = parseAndCoalesce([
      deltaEvent('s', 'm', 'p1', 'a'),
      deltaEvent('s', 'm', 'p2', 'b'),
    ])
    expect(events).toHaveLength(2)
  })

  it('drops in-flight deltas once a part.updated for the same part arrives', () => {
    const events = parseAndCoalesce([
      deltaEvent('s', 'm', 'p', 'a'),
      partUpdatedEvent('s', 'm', 'p'),
      deltaEvent('s', 'm', 'p', 'b'),
    ])
    // 第一条 delta 被 part.updated 作废，保留 part.updated 与之后的 delta
    const types = events.map(e => e.payload.type)
    expect(types).toEqual([EventTypes.MESSAGE_PART_UPDATED, EventTypes.MESSAGE_PART_DELTA])
    const last = (events[1].payload as { properties: { delta: string } }).properties
    expect(last.delta).toBe('b')
  })

  it('passes a single event through unchanged', () => {
    const single: GlobalEvent[] = [
      { directory: 'g', payload: { type: 'x', properties: {} } } as unknown as GlobalEvent,
    ]
    expect(coalesceEvents(single)).toBe(single)
  })
})
