import { describe, expect, it } from 'vitest'
import { firstMeaningfulLine } from './reasoningSummary'

describe('firstMeaningfulLine', () => {
  it('returns the first plain line', () => {
    expect(firstMeaningfulLine('first\nsecond')).toBe('first')
  })

  it('skips a leading fenced code block so the summary is not backticks', () => {
    const text = ['```ts', 'const a = 1', '```', 'Then I checked the router.'].join('\n')
    expect(firstMeaningfulLine(text)).toBe('Then I checked the router.')
  })

  it('skips leading blank lines', () => {
    expect(firstMeaningfulLine('\n\n   \nActual thought')).toBe('Actual thought')
  })

  it('skips horizontal rules and marker-only lines', () => {
    expect(firstMeaningfulLine('---\n***\n> \nReal content')).toBe('Real content')
  })

  it('keeps markdown markers in the returned line so the renderer can handle them', () => {
    expect(firstMeaningfulLine('## Heading text\nbody')).toBe('## Heading text')
  })

  it('returns an empty string when there is nothing meaningful', () => {
    expect(firstMeaningfulLine('```\ncode only\n```')).toBe('')
    expect(firstMeaningfulLine('')).toBe('')
  })
})
