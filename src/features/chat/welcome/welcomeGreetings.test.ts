import { describe, expect, it } from 'vitest'
import { greetingSlotForHour, pickGreeting } from './welcomeGreetings'

describe('greetingSlotForHour', () => {
  it('maps hour boundaries to the expected slot', () => {
    expect(greetingSlotForHour(0)).toBe('lateNight')
    expect(greetingSlotForHour(4)).toBe('lateNight')
    expect(greetingSlotForHour(5)).toBe('earlyMorning')
    expect(greetingSlotForHour(8)).toBe('earlyMorning')
    expect(greetingSlotForHour(9)).toBe('morning')
    expect(greetingSlotForHour(11)).toBe('morning')
    expect(greetingSlotForHour(12)).toBe('noon')
    expect(greetingSlotForHour(13)).toBe('noon')
    expect(greetingSlotForHour(14)).toBe('afternoon')
    expect(greetingSlotForHour(17)).toBe('afternoon')
    expect(greetingSlotForHour(18)).toBe('evening')
    expect(greetingSlotForHour(21)).toBe('evening')
    expect(greetingSlotForHour(22)).toBe('night')
    expect(greetingSlotForHour(23)).toBe('night')
  })

  it('covers every hour of the day', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      expect(greetingSlotForHour(hour)).toBeTruthy()
    }
  })
})

describe('pickGreeting', () => {
  it('returns empty string for missing or empty pool', () => {
    expect(pickGreeting(undefined)).toBe('')
    expect(pickGreeting([])).toBe('')
  })

  it('picks deterministically from the injected random source', () => {
    const pool = ['a', 'b', 'c']
    expect(pickGreeting(pool, () => 0)).toBe('a')
    expect(pickGreeting(pool, () => 0.5)).toBe('b')
    expect(pickGreeting(pool, () => 0.999)).toBe('c')
  })

  it('never falls out of bounds when random returns 1', () => {
    expect(pickGreeting(['only'], () => 1)).toBe('only')
  })
})
