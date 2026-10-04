import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hapticStore, normalizeHapticSettings } from './hapticStore'

const STORAGE_KEY = 'opencode:haptic-settings'

describe('hapticStore', () => {
  beforeEach(() => {
    localStorage.clear()
    hapticStore.setEnabled(true)
    hapticStore.setIntensity('standard')
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('defaults to enabled with standard intensity', () => {
    expect(hapticStore.getSnapshot()).toEqual({ enabled: true, intensity: 'standard' })
  })

  it('persists the toggle to localStorage', () => {
    hapticStore.setEnabled(false)
    expect(hapticStore.getSnapshot().enabled).toBe(false)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').enabled).toBe(false)
    hapticStore.setEnabled(true)
  })

  it('persists the intensity to localStorage', () => {
    hapticStore.setIntensity('strong')
    expect(hapticStore.getSnapshot().intensity).toBe('strong')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').intensity).toBe('strong')
  })

  it('notifies subscribers on change and skips no-op writes', () => {
    const listener = vi.fn()
    const unsubscribe = hapticStore.subscribe(listener)
    hapticStore.setEnabled(true)
    hapticStore.setIntensity('standard')
    expect(listener).not.toHaveBeenCalled()
    hapticStore.setEnabled(false)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    hapticStore.setEnabled(true)
  })
})

describe('normalizeHapticSettings', () => {
  it('falls back to default when raw is malformed', () => {
    expect(normalizeHapticSettings(null)).toEqual({ enabled: true, intensity: 'standard' })
    expect(normalizeHapticSettings({ enabled: 'nope', intensity: 'extreme' })).toEqual({
      enabled: true,
      intensity: 'standard',
    })
  })

  it('honors valid fields', () => {
    expect(normalizeHapticSettings({ enabled: false, intensity: 'subtle' })).toEqual({
      enabled: false,
      intensity: 'subtle',
    })
  })
})
