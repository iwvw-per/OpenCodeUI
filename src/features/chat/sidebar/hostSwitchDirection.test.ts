import { describe, expect, it } from 'vitest'
import { hostSwitchDirection, hostSlideClass } from './hostSwitchDirection'

describe('hostSwitchDirection', () => {
  it('slides from the right when moving to a host further right', () => {
    expect(hostSwitchDirection(0, 1)).toBe('from-right')
    expect(hostSwitchDirection(0, 3)).toBe('from-right')
  })

  it('slides from the left when moving to a host further left', () => {
    expect(hostSwitchDirection(2, 1)).toBe('from-left')
    expect(hostSwitchDirection(3, 0)).toBe('from-left')
  })

  it('falls back to from-left when either index is unknown', () => {
    expect(hostSwitchDirection(-1, 1)).toBe('from-left')
    expect(hostSwitchDirection(1, -1)).toBe('from-left')
    expect(hostSwitchDirection(-1, -1)).toBe('from-left')
  })

  it('maps direction to the CSS class', () => {
    expect(hostSlideClass('from-right')).toBe('host-slide-from-right')
    expect(hostSlideClass('from-left')).toBe('host-slide-from-left')
  })
})
