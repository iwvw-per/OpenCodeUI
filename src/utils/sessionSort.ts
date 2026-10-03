// ============================================
// 排序字段类型（项目列表用）
// ============================================
//
// 会话列表固定「最新对话置顶」，不再有排序偏好；这里只保留项目列表排序字段的
// 类型与校验。项目排序：
//   - updated：按最后一次对话时间（用户最后一条消息的锚点）
//   - created：按项目保存时间

export type SessionSortField = 'updated' | 'created'

/** 项目列表默认按「最后对话时间」倒序：最近聊过的项目排最前。 */
export const DEFAULT_PROJECT_SORT_FIELD: SessionSortField = 'updated'
export const DEFAULT_PROJECT_SORT_DESC = true

export function isSessionSortField(value: unknown): value is SessionSortField {
  return value === 'updated' || value === 'created'
}
