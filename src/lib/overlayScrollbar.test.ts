import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { disposeOverlayScrollbars, initOverlayScrollbars } from './overlayScrollbar'

function makeScrollContainer(): { parent: HTMLDivElement; vp: HTMLDivElement } {
  const parent = document.createElement('div')
  const vp = document.createElement('div')
  // jsdom 的默认 overflow 计算值是空串，需要显式内联样式才能被 isScrollable 识别
  vp.style.overflowY = 'auto'
  parent.appendChild(vp)
  document.body.appendChild(parent)

  Object.defineProperty(vp, 'scrollHeight', { configurable: true, value: 400 })
  Object.defineProperty(vp, 'clientHeight', { configurable: true, value: 100 })
  Object.defineProperty(vp, 'scrollWidth', { configurable: true, value: 200 })
  Object.defineProperty(vp, 'clientWidth', { configurable: true, value: 200 })

  return { parent, vp }
}

describe('overlayScrollbar lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    disposeOverlayScrollbars()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('injects thumb DOM for scrollable containers', () => {
    const { parent } = makeScrollContainer()
    initOverlayScrollbars()

    expect(parent.querySelector('.os-thumb')).not.toBeNull()
  })

  it('is idempotent — a second init does not duplicate work', () => {
    const { parent } = makeScrollContainer()
    initOverlayScrollbars()
    initOverlayScrollbars()

    expect(parent.querySelectorAll('.os-thumb')).toHaveLength(1)
  })

  it('dispose removes every injected thumb and resumes cleanly', () => {
    const { parent, vp } = makeScrollContainer()
    initOverlayScrollbars()
    expect(parent.querySelectorAll('.os-thumb').length).toBeGreaterThan(0)

    disposeOverlayScrollbars()

    expect(parent.querySelectorAll('.os-thumb')).toHaveLength(0)
    expect(vp.hasAttribute('data-os')).toBe(false)

    // 可再次 init 并重新注入
    initOverlayScrollbars()
    expect(parent.querySelectorAll('.os-thumb').length).toBeGreaterThan(0)
  })

  it('dispose stops the mutation observer from scanning further', async () => {
    makeScrollContainer()
    initOverlayScrollbars()

    // 新的可滚动容器出现，初始化后会因 MutationObserver 被注入
    const { parent: lateParent } = makeScrollContainer()
    await vi.waitFor(() => {
      expect(lateParent.querySelector('.os-thumb')).not.toBeNull()
    })

    disposeOverlayScrollbars()

    // dispose 后再出现新容器，不应再被扫描注入
    const { parent: afterParent } = makeScrollContainer()
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(afterParent.querySelector('.os-thumb')).toBeNull()
  })
  it('dispose removes the window resize listener', () => {
    initOverlayScrollbars()
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    disposeOverlayScrollbars()

    const removedResize = removeSpy.mock.calls.some(call => (call[0] as string) === 'resize')
    expect(removedResize).toBe(true)
  })

  it('dispose disconnects the ResizeObserver', () => {
    const disconnect = vi.fn()
    class TrackingResizeObserver {
      observe() {}
      unobserve() {}
      disconnect = disconnect
    }
    vi.stubGlobal('ResizeObserver', TrackingResizeObserver)

    makeScrollContainer()
    initOverlayScrollbars()
    disposeOverlayScrollbars()

    expect(disconnect).toHaveBeenCalled()
  })

  it('a fresh init after dispose re-observes instead of reusing stale state', () => {
    const disconnect = vi.fn()
    class TrackingResizeObserver {
      observe() {}
      unobserve() {}
      disconnect = disconnect
    }
    vi.stubGlobal('ResizeObserver', TrackingResizeObserver)

    makeScrollContainer()
    initOverlayScrollbars()
    disposeOverlayScrollbars()
    const firstDisconnects = disconnect.mock.calls.length

    // 再次 init 后 dispose 应再次断开新创建的 observer
    initOverlayScrollbars()
    disposeOverlayScrollbars()

    expect(disconnect.mock.calls.length).toBeGreaterThan(firstDisconnects)
  })
})
