/** 初始消息加载数量（旧版按条数分页、本轮 diff 兜底等仍在用） */
export const INITIAL_MESSAGE_LIMIT = 50

/** 历史加载批次大小（旧版无游标 serve 的 limit 递增回退） */
export const HISTORY_LOAD_BATCH_SIZE = 50

/** 首屏默认加载的完整对话轮数 */
export const INITIAL_TURN_LIMIT = 3

/** 上滑一次追加的完整对话轮数 */
export const HISTORY_TURN_BATCH_SIZE = 5

/** 单次底层 message 请求的条数上限（轮次分页的内部粒度） */
export const TURN_FETCH_MESSAGE_LIMIT = 30

/** 轮次分页内部最多连续请求几次，用于补齐轮次边界，避免病态循环 */
export const TURN_FETCH_MAX_PAGES = 4

/** 内存中保留完整过程（思考/工具输出）的最近轮数，更早的轮次压缩 */
export const RECENT_FULL_TURNS = 5
