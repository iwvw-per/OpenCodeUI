// ============================================
// 对话内容列宽
//
// 对话消息列与输入框必须使用同一组宽度/内边距，否则输入框比消息列宽，
// 视觉上「错位」；调节宽窄时两者也要一起变。
//
// 这里作为唯一来源，供 chatViewport 派生、ChatArea（消息行）、InputBox
// 以及两个贴在输入框上的对话框共同消费。此前 ChatArea 用 max-w-2xl、
// InputBox 用 max-w-3xl，是两个各自硬编码的字符串，相差 96px。
// ============================================

/** 消息列 / 输入框的最大宽度类（宽屏模式与非宽屏模式两档） */
export function getContentMaxWidthClass(isWideMode: boolean): string {
  return isWideMode ? 'max-w-[95%] xl:max-w-6xl' : 'max-w-2xl'
}

/** 消息列的水平内边距类（紧凑视图收窄） */
export function getContentPaddingClass(isCompact: boolean): string {
  return isCompact ? 'px-3' : 'px-5'
}
