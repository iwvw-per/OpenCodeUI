// ============================================
// Desktop window constants
// ============================================

export const DESKTOP_TITLEBAR_HEIGHT = 44
export const DESKTOP_TITLEBAR_Z_INDEX = 220
export const DESKTOP_FULLSCREEN_LAYER_Z_INDEX = 320
export const DESKTOP_MACOS_TRAFFIC_LIGHTS_WIDTH = 72
/**
 * Windows 全高侧栏收起（rail）时的最小宽度：顶部工具栏按钮部分的宽度。
 * 收起时工具栏仅保留开关按钮（IconButton md，32px），左右各留 pl-2/pr-2（8px）与下方图标
 * 对齐、与边框留距，因此最小宽度 = 8 + 32 + 8 = 48px，保证按钮完整显示且不贴边。
 */
export const DESKTOP_SIDEBAR_RAIL_WIDTH = 8 + 32 + 8
/**
 * Windows 全高侧栏拖拽调节宽度的下限：不能小于顶部工具栏 6 个按钮的合计宽度，
 * 否则按钮被挤压。6×IconButton md(32px) + 5×gap(4px) + pl-2(8px) + pr-2(8px) = 228px，
 * 右留 pr-2 保证按钮行与侧栏右边框（竖线）不贴死。
 */
export const DESKTOP_SIDEBAR_MIN_WIDTH = 6 * 32 + 5 * 4 + 8 + 8
