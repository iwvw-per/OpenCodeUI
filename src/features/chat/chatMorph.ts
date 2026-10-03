// ============================================
// chatMorph — 输入框收起/展开变形中的轻量状态
//
// 变形逐帧改变 width / height / border-radius，而输入框本身带 backdrop-filter：
// 每帧都要按新盒子重新模糊整块背景，是快速滚动时掉帧的主要来源（与内容列宽
// 拖拽同源，见 chatWidthDrag）。ChatArea 订阅本状态，在变形期间把 overscan 降到
// 最小，腾出主线程给几何动画；毛玻璃由 [data-input-box][data-morphing] 就地关闭。
//
// 用引用计数而非布尔：分屏下两个 pane 可能同时变形，一个结束不能清掉另一个。
// ============================================

type Listener = () => void

let morphingCount = 0
let morphing = false
const listeners = new Set<Listener>()

function recompute() {
  const next = morphingCount > 0
  if (next === morphing) return
  morphing = next
  listeners.forEach(listener => listener())
}

export function setChatMorphing(next: boolean) {
  if (next) {
    morphingCount += 1
  } else if (morphingCount > 0) {
    morphingCount -= 1
  }
  recompute()
}

export function subscribeChatMorphing(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getChatMorphing(): boolean {
  return morphing
}
