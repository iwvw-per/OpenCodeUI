import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hapticStore } from '../store/hapticStore'
import { hapticTap, hapticsSupported } from './haptics'

describe('haptics', () => {
  beforeEach(() => {
    localStorage.clear()
    hapticStore.setEnabled(true)
    hapticStore.setIntensity('standard')
    delete (window as unknown as { __opencode_android?: unknown }).__opencode_android
    delete (navigator as unknown as { vibrate?: unknown }).vibrate
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prefers the native amplitude bridge when available', () => {
    const vibratePattern = vi.fn()
    const vibrate = vi.fn()
    ;(window as unknown as { __opencode_android?: unknown }).__opencode_android = { vibratePattern, vibrate }

    hapticTap('strong')

    expect(vibratePattern).toHaveBeenCalledWith('22,30,22', '200,0,200')
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('falls back to the legacy single-shot bridge', () => {
    const vibrate = vi.fn()
    ;(window as unknown as { __opencode_android?: unknown }).__opencode_android = { vibrate }

    hapticTap('medium')

    expect(vibrate).toHaveBeenCalledWith(16)
  })

  it('uses the W3C Vibration API when no bridge exists', () => {
    const vibrate = vi.fn()
    ;(navigator as unknown as { vibrate?: unknown }).vibrate = vibrate

    hapticTap('light')

    expect(vibrate).toHaveBeenCalledWith(8)
  })

  it('does nothing when the toggle is off', () => {
    const vibrate = vi.fn()
    ;(navigator as unknown as { vibrate?: unknown }).vibrate = vibrate
    hapticStore.setEnabled(false)

    hapticTap('strong')

    expect(vibrate).not.toHaveBeenCalled()
  })

  it('reports support based on bridge or Vibration API', () => {
    expect(hapticsSupported()).toBe(false)
    ;(navigator as unknown as { vibrate?: unknown }).vibrate = vi.fn()
    expect(hapticsSupported()).toBe(true)
  })

  it('scales durations and amplitudes by the global intensity', () => {
    const vibratePattern = vi.fn()
    ;(window as unknown as { __opencode_android?: unknown }).__opencode_android = { vibratePattern }

    hapticStore.setIntensity('strong')
    hapticTap('medium')
    expect(vibratePattern).toHaveBeenLastCalledWith('22', '182')

    hapticStore.setIntensity('subtle')
    hapticTap('medium')
    expect(vibratePattern).toHaveBeenLastCalledWith('10', '70')
  })

  it('scales the Vibration API fallback duration by intensity', () => {
    const vibrate = vi.fn()
    ;(navigator as unknown as { vibrate?: unknown }).vibrate = vibrate

    hapticStore.setIntensity('subtle')
    hapticTap('light')
    expect(vibrate).toHaveBeenLastCalledWith(5)
  })
})
