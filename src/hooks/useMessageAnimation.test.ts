import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useMessageAnimation } from './useMessageAnimation'

const stubAnimation = () => ({ onfinish: null, cancel: vi.fn() }) as unknown as Animation

describe('useMessageAnimation 输入框脉冲', () => {
  it('脉冲走 WAAPI，不写内联 transition（避免打断 data-morphing 几何过渡）', async () => {
    const { result } = renderHook(() => useMessageAnimation())

    const inputBox = document.createElement('div')
    inputBox.setAttribute('data-morphing', '')
    inputBox.style.width = '132px'
    const animateSpy = vi.fn(() => stubAnimation())
    // jsdom 没有 WAAPI，补一个最小桩
    Object.defineProperty(inputBox, 'animate', { value: animateSpy, configurable: true })
    result.current.registerInputBox(inputBox)

    await result.current.animateUndo(['m1'])

    expect(inputBox.style.transition).toBe('')
    expect(inputBox.style.transform).toBe('')
    expect(inputBox.style.boxShadow).toBe('')
    // 几何过渡的先决条件不能被动过
    expect(inputBox.hasAttribute('data-morphing')).toBe(true)
    expect(inputBox.style.width).toBe('132px')
    expect(animateSpy).toHaveBeenCalled()
  })

  it('redo 的收缩脉冲同样不写内联 transition', async () => {
    const { result } = renderHook(() => useMessageAnimation())

    const inputBox = document.createElement('div')
    const animateSpy = vi.fn(() => stubAnimation())
    Object.defineProperty(inputBox, 'animate', { value: animateSpy, configurable: true })
    result.current.registerInputBox(inputBox)

    await result.current.animateRedo()

    expect(inputBox.style.transition).toBe('')
    expect(inputBox.style.transform).toBe('')
    expect(inputBox.style.boxShadow).toBe('')
    expect(animateSpy).toHaveBeenCalled()
  })
})
