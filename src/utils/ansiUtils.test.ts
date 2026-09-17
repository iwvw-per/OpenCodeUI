import { describe, expect, it } from 'vitest'
import { hasAnsi, parseAnsi, stripAnsi } from './ansiUtils'

const ESC = '\x1b'
const RED = `${ESC}[31m`
const RESET = `${ESC}[0m`

describe('ansiUtils', () => {
  describe('hasAnsi', () => {
    it('detects ANSI escape codes', () => {
      expect(hasAnsi(`${RED}red${RESET}`)).toBe(true)
      expect(hasAnsi('plain text')).toBe(false)
      expect(hasAnsi('')).toBe(false)
    })

    it('returns a stable result across repeated calls on the same string', () => {
      const text = `${RED}red${RESET}`
      expect(Array.from({ length: 5 }, () => hasAnsi(text))).toEqual([true, true, true, true, true])

      const plain = 'plain text'
      expect(Array.from({ length: 5 }, () => hasAnsi(plain))).toEqual([false, false, false, false, false])
    })

    it('stays stable when interleaved with stripAnsi and parseAnsi', () => {
      const text = `${RED}red${RESET}`
      expect(hasAnsi(text)).toBe(true)
      stripAnsi(text)
      expect(hasAnsi(text)).toBe(true)
      parseAnsi(text)
      expect(hasAnsi(text)).toBe(true)
      expect(hasAnsi(text)).toBe(true)
    })
  })

  describe('stripAnsi', () => {
    it('removes all escape codes', () => {
      expect(stripAnsi(`${RED}red${RESET} normal`)).toBe('red normal')
    })

    it('is repeatable', () => {
      const text = `${RED}red${RESET}`
      expect(stripAnsi(text)).toBe('red')
      expect(stripAnsi(text)).toBe('red')
    })
  })

  describe('parseAnsi', () => {
    it('splits text into colored segments', () => {
      const segments = parseAnsi(`${RED}red${RESET} normal`)
      expect(segments).toEqual([
        { text: 'red', fg: expect.any(String), bold: undefined, dim: undefined, italic: undefined },
        { text: ' normal', fg: undefined, bold: undefined, dim: undefined, italic: undefined },
      ])
    })

    it('is repeatable and unaffected by prior calls', () => {
      const text = `${RED}red${RESET}`
      expect(parseAnsi(text)).toEqual(parseAnsi(text))
      expect(parseAnsi(text)).toEqual(parseAnsi(text))
    })
  })
})
