import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGlobalHaptics } from './useGlobalHaptics'

const { hapticTapMock } = vi.hoisted(() => ({ hapticTapMock: vi.fn() }))

vi.mock('../utils/haptics', () => ({
  hapticTap: hapticTapMock,
}))

function clickOn(el: Element) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('useGlobalHaptics', () => {
  beforeEach(() => {
    hapticTapMock.mockReset()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('does not listen when disabled', () => {
    renderHook(() => useGlobalHaptics(false))
    const button = document.createElement('button')
    document.body.appendChild(button)
    clickOn(button)
    expect(hapticTapMock).not.toHaveBeenCalled()
  })

  it('fires a light tap for a plain interactive element', () => {
    renderHook(() => useGlobalHaptics(true))
    const button = document.createElement('button')
    document.body.appendChild(button)
    clickOn(button)
    expect(hapticTapMock).toHaveBeenCalledWith('light')
  })

  it('honors an explicit data-haptic strength', () => {
    renderHook(() => useGlobalHaptics(true))
    const button = document.createElement('button')
    button.setAttribute('data-haptic', 'strong')
    document.body.appendChild(button)
    clickOn(button)
    expect(hapticTapMock).toHaveBeenCalledWith('strong')
  })

  it('skips elements marked data-haptic="none"', () => {
    renderHook(() => useGlobalHaptics(true))
    const button = document.createElement('button')
    button.setAttribute('data-haptic', 'none')
    document.body.appendChild(button)
    clickOn(button)
    expect(hapticTapMock).not.toHaveBeenCalled()
  })

  it('ignores non-interactive elements', () => {
    renderHook(() => useGlobalHaptics(true))
    const span = document.createElement('span')
    document.body.appendChild(span)
    clickOn(span)
    expect(hapticTapMock).not.toHaveBeenCalled()
  })

  it('ignores disabled buttons', () => {
    renderHook(() => useGlobalHaptics(true))
    const button = document.createElement('button')
    button.disabled = true
    document.body.appendChild(button)
    clickOn(button)
    expect(hapticTapMock).not.toHaveBeenCalled()
  })
})
