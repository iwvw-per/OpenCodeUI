import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { SplitContainer } from './SplitContainer'
import { paneLayoutStore } from '../../store/paneLayoutStore'

function renderSplit() {
  paneLayoutStore.reset()
  const second = paneLayoutStore.splitPane('pane-1', 'horizontal', 'session-b')
  expect(second).toBe('pane-2')

  const { container } = render(
    <SplitContainer
      node={paneLayoutStore.getRoot()}
      renderLeaf={(id, sessionId) => <div data-pane={id}>{sessionId}</div>}
    />,
  )
  const grid = container.firstElementChild as HTMLElement
  const divider = grid.children[1] as HTMLElement
  return { grid, divider }
}

/** jsdom 不做真实布局，手动给出可用的尺寸。 */
function stubRect(el: HTMLElement, rect: Partial<DOMRect>) {
  const full = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect
  el.getBoundingClientRect = () => full
}

describe('SplitContainer divider', () => {
  beforeEach(() => {
    paneLayoutStore.reset()
  })

  it('writes the grid template back after a drag that does not change the ratio', () => {
    // 回归：onUp 曾清空 inline 样式、指望 React 重写。单击/双击（ratio 未变）
    // 时 React 认为 style 无变化而跳过写入，容器就停在「无 grid-template」，
    // 三个子元素退化成 auto-flow 排成三行（看起来像上下分屏、拖拽柄消失）。
    const { grid, divider } = renderSplit()
    stubRect(grid, { x: 0, y: 0, width: 1000, height: 800, right: 1000, bottom: 800 })
    stubRect(divider, { x: 499, y: 0, width: 3, height: 800, right: 502, bottom: 800 })

    fireEvent.pointerDown(divider, { button: 0, clientX: 500, clientY: 400, pointerId: 1 })
    // 松手时仍停在正中：ratio 与 store 当前值一致，最容易被 React 判定为「没变」
    fireEvent.pointerUp(document, { clientX: 500, clientY: 400, pointerId: 1 })

    expect(grid.style.gridTemplateColumns).not.toBe('')
    expect(grid.style.gridTemplateColumns).toContain('fr')
    expect(grid.style.gridTemplateRows).not.toBe('')
  })

  it('keeps the committed ratio within the store clamp', () => {
    const { grid, divider } = renderSplit()
    stubRect(grid, { x: 0, y: 0, width: 1000, height: 800, right: 1000, bottom: 800 })
    stubRect(divider, { x: 999, y: 0, width: 3, height: 800, right: 1002, bottom: 800 })

    fireEvent.pointerDown(divider, { button: 0, clientX: 1000, clientY: 400, pointerId: 1 })
    // 拖到最右：预览与提交都要夹在同一范围，否则松手会跳一下
    fireEvent.pointerMove(document, { clientX: 2000, clientY: 400, pointerId: 1 })
    fireEvent.pointerUp(document, { clientX: 2000, clientY: 400, pointerId: 1 })

    const ratio = paneLayoutStore.getRoot()
    expect(ratio.type).toBe('split')
    if (ratio.type === 'split') {
      expect(ratio.ratio).toBeLessThanOrEqual(0.85)
      expect(ratio.ratio).toBeGreaterThanOrEqual(0.15)
    }
  })
})
