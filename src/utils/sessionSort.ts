// ============================================
// 会话排序
// ============================================
//
// 侧栏会话列表的排序偏好。只提供纯函数：调用方在「拉取完成 / 排序偏好变化」
// 时应用一次，不在每次 session.updated 时重排——并行会话的更新事件是交替到达的，
// 按时间实时重排会让列表来回跳（见 useSessions 的 onSessionUpdated）。

import type { ApiSession } from '../api'

export type SessionSortField = 'updated' | 'created'

export interface SessionSortPreference {
  field: SessionSortField
  /** true = 倒序（新 → 旧），false = 正序（旧 → 新） */
  desc: boolean
}

export const DEFAULT_SESSION_SORT: SessionSortPreference = { field: 'updated', desc: true }

export function isSessionSortField(value: unknown): value is SessionSortField {
  return value === 'updated' || value === 'created'
}

/** 取排序依据的时间戳；缺字段时退回另一个字段，避免 NaN 打乱顺序 */
export function getSessionSortTime(session: ApiSession, field: SessionSortField): number {
  const time = session.time
  const primary = field === 'updated' ? time?.updated : time?.created
  const fallback = field === 'updated' ? time?.created : time?.updated
  return primary ?? fallback ?? 0
}

/**
 * 按偏好排序（返回新数组，不改原数组）。
 * 时间戳相同时按 id 升序兜底：与输入顺序无关，结果稳定，
 * 也不会因引用抖动而互换位置。
 */
export function sortSessions<T extends ApiSession>(sessions: T[], preference: SessionSortPreference): T[] {
  const { field, desc } = preference
  const direction = desc ? -1 : 1
  return [...sessions].sort((a, b) => {
    const delta = getSessionSortTime(a, field) - getSessionSortTime(b, field)
    if (delta !== 0) return delta * direction
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/**
 * 把一个新出现的会话插到已排序列表的正确位置（返回新数组）。
 * 列表本身始终保持"按偏好有序"，所以新会话不该无脑置顶——
 * 正序（旧→新）时新会话属于末尾。
 */
export function insertSessionSorted<T extends ApiSession>(
  sessions: T[],
  session: T,
  preference: SessionSortPreference,
): T[] {
  if (sessions.length === 0) return [session]
  const direction = preference.desc ? -1 : 1
  const target = getSessionSortTime(session, preference.field)
  let index = sessions.length
  for (let i = 0; i < sessions.length; i += 1) {
    if ((getSessionSortTime(sessions[i], preference.field) - target) * direction > 0) {
      index = i
      break
    }
  }
  const next = sessions.slice()
  next.splice(index, 0, session)
  return next
}
