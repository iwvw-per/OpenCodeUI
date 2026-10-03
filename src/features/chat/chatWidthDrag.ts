// ============================================
// chatWidthDrag — 内容列宽拖拽中的轻量状态
//
// 拖拽期间内容列宽度逐帧变化，会让每个已渲染的消息行文字重排、高度变化。
// 虚拟列表因此每帧都要测量并重渲染所有可见行（含 overscan），是拖拽卡顿的
// 主要来源。
//
// ChatArea 订阅本状态，在拖拽期间把 overscan 降到最小，只保留视口内的行参与
// 重排；松手后恢复。这样每帧重排/测量的行数从约 30 行降到约 10 行。
// ============================================

type Listener = () => void

let dragging = false
const listeners = new Set<Listener>()

export function setChatWidthDragging(next: boolean) {
  if (dragging === next) return
  dragging = next
  listeners.forEach(listener => listener())
}

export function subscribeChatWidthDrag(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getChatWidthDragging(): boolean {
  return dragging
}
