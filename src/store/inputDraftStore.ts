import type { Attachment } from '../features/attachment'

// ============================================
// inputDraftStore - 按会话分桶的输入草稿
//
// 解决「预输入内容被切换会话/新建会话带过去」的问题：
// - 每个会话的草稿独立存储（Map<sessionId, { text, attachments }>）
// - 切回某会话时恢复该会话自己的草稿
// - 新建会话没有桶 → 输入框为空
// - 发送成功后清空对应桶，避免切回来又显示已发送内容
// 纯内存存储：同一应用会话内跨切换保留即可，不跨重启持久化
// （attachments 含 File/Blob 无法安全序列化进 localStorage）。
// ============================================

export interface InputDraft {
  text: string
  attachments: Attachment[]
}

class InputDraftStore {
  private drafts = new Map<string, InputDraft>()

  save(sessionId: string, draft: InputDraft) {
    this.drafts.set(sessionId, draft)
  }

  load(sessionId: string): InputDraft | undefined {
    return this.drafts.get(sessionId)
  }

  clear(sessionId: string) {
    this.drafts.delete(sessionId)
  }
}

export const inputDraftStore = new InputDraftStore()
