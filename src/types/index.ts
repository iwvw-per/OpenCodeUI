// ============================================
// Types - 统一类型导出
// ============================================
//
// 推荐使用方式:
// - API 类型: import type { Session, Message } from '@/types/api'
// - UI 类型: import type { UIMessage, Attachment } from '@/types'
//

// Re-export all API types
export * from './api'

// Re-export UI types
export * from './ui'

// ============================================
// 类型别名（向后兼容）
// ============================================

// 为了向后兼容，保留一些旧的类型别名
export type { Message as ApiMessage } from './api'
export type { Part as ApiPart } from './api'
export type { Session as ApiSession } from './api'
