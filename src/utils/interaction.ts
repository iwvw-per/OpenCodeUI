// ============================================
// interaction - 交互态样式词汇表
//
// 背景：此前 hover / active / focus 的写法散落在各文件手写，同一个「列表项
// 悬停」在不同文件里出现了 bg-bg-200、bg-bg-200/50、bg-bg-200/60、/40、/30
// 等 20 余种写法，视觉上无法解释为什么要不同，改一处也无法影响其他处。
//
// 这里把「交互语义」收敛成固定几档，业务代码按语义引用，不再各自调透明度。
// 需要调整全站交互观感时，只改本文件，不要在调用点覆盖。
//
// 用法：
//   import { interactive } from '../../utils/interaction'
//   <button className={cn(interactive.row, 'px-2 h-8')} />
//
// 与 ui/ 组件的关系：基础组件（Button / IconButton / MenuItem）内部已内置
// 对应态，调用方通常不需要再引本表；本表主要服务于暂未封装的列表行、面板
// 行等结构。
// ============================================

/**
 * 按交互语义划分的交互态片段。
 *
 * 每档都包含完整的 hover / 按下反馈，`focusRing` 单独提供以便组合到
 * 已经自带 hover 的控件上。
 *
 * 两条硬性约定（全站统一，不要在各调用点覆盖）：
 *
 * 1. **按下反馈只用颜色/透明度，不用几何变换。**
 *    禁止 `active:scale-*` / `active:translate-*` / `active:rotate-*`。
 *    缩放与位移会在按下瞬间改变元素的视觉边界，在密集列表里表现为相邻元素
 *    抖动；"点击不改布局"比"有点动画"更重要。
 *
 * 2. **hover 与选中态用底色表达，不用边框。**
 *    hover = `bg-bg-200`，选中 = `bg-bg-200 text-text-100`（同底色，靠文字色区分）。
 *    加边框会撑开 1~2px 推动相邻元素；改用 ring 则会与键盘焦点环撞车，
 *    使"焦点环只在键盘导航时出现"这条约定失效。
 */
export const interactive = {
  /**
   * 列表行 / 菜单项：用于侧边栏会话项、文件树项、下拉选项等。
   *
   * 选中态见 `rowSelected`：两者同底色，靠文字色区分层级。
   */
  row: ['cursor-pointer select-none', 'transition-colors duration-150', 'hover:bg-bg-200', 'active:bg-bg-300'].join(
    ' ',
  ),

  /**
   * 列表行选中态。与 `row` 组合使用：
   * `cn(interactive.row, selected && interactive.rowSelected)`
   *
   * 与 row 同为 `bg-bg-200`，靠 `text-text-100` 拉高文字亮度来区分「选中」与
   * 「悬停」。这样做的原因：若选中改用 accent 浅底，会与 hover 形成两种色相，
   * 在侧边栏这类大色块区域显得杂乱；同底色 + 文字色既清晰又不需要边框。
   */
  rowSelected: 'bg-bg-200 text-text-100',

  /**
   * 面板行 / 工具栏按钮：与 row 同强度。保留独立档位是因为语义不同
   * （密集排布的工具控件 vs 列表项），便于将来单独调整而不波及列表。
   */
  subtle: ['cursor-pointer select-none', 'transition-colors duration-150', 'hover:bg-bg-200', 'active:bg-bg-300'].join(
    ' ',
  ),

  /**
   * 危险操作（删除、断开、清空）：悬停转为危险色浅底。
   * 注意文字色变化由调用方决定，通常配 `hover:text-danger-100`。
   */
  danger: [
    'cursor-pointer select-none',
    'transition-colors duration-150',
    'hover:bg-danger-100/10',
    'active:bg-danger-100/20',
  ].join(' '),

  /**
   * 警示操作（重置、覆盖、还原）：语义弱于 danger，用于"可恢复但有损失"的操作。
   * 同 danger，文字色通常配 `hover:text-warning-100`。
   */
  warning: [
    'cursor-pointer select-none',
    'transition-colors duration-150',
    'hover:bg-warning-100/10',
    'active:bg-warning-100/20',
  ].join(' '),

  /**
   * 强调操作（打开、跳转、新增）：悬停转为 accent 浅底，
   * 通常配 `hover:text-accent-main-100`。
   */
  accent: [
    'cursor-pointer select-none',
    'transition-colors duration-150',
    'hover:bg-accent-main-100/10',
    'active:bg-accent-main-100/20',
  ].join(' '),

  /**
   * 可点击卡片 / 大块区域：整块可点但内部仍含其他控件时使用。
   * 与 row 同强度（全不透明 bg-200），避免大色块 hover 反而更轻。
   */
  card: [
    'cursor-pointer',
    'transition-[background-color,border-color] duration-150',
    'hover:bg-bg-200',
    'active:bg-bg-300',
  ].join(' '),

  /**
   * 焦点环。仅在键盘导航时出现（focus-visible），鼠标点击不显示。
   *
   * 用 ring 而非 outline：ring 是 box-shadow，不占布局空间，不会在聚焦时
   * 推动相邻元素。已在自带 focus 样式（如 Radix 原语）的控件上不要叠加本项。
   *
   * 注意：ring 专属于**键盘焦点**，因此交互态一律不用 ring —— 否则鼠标悬停
   * 与键盘聚焦无法区分，约定即失效。
   */
  focusRing:
    'outline-none focus-visible:ring-2 focus-visible:ring-accent-main-100/50 focus-visible:ring-offset-1 focus-visible:ring-offset-bg-100',

  /**
   * 紧凑控件的焦点环（尺寸小的按钮 / 图标按钮），环更细以免盖住内容。
   */
  focusRingCompact: 'outline-none focus-visible:ring-1 focus-visible:ring-accent-main-100/60',

  /**
   * 禁用态统一写法。放在交互态之后，用 `disabled:` 保证优先级不依赖顺序。
   */
  disabled: 'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',
} as const

/**
 * 需要「选中即 accent 浅底」时使用的强调态。
 *
 * 仅用于**小型强调控件**（标签页、筛选 chip）——这类元素面积小，
 * accent 浅底能提供明确的"当前项"识别。列表行、文件树等大面积区域
 * 请用 `interactive.rowSelected`（中性底），否则大面积 accent 会压过内容。
 */
export const selectedAccent = 'bg-accent-main-100/15 text-text-100'

export type InteractiveTone = keyof typeof interactive
