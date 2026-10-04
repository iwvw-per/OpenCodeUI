// ============================================
// LSP API - Language Server Protocol 状态
// ============================================

export interface LSPStatus {
  running: boolean
  language?: string
  capabilities?: string[]
}

export interface FormatterStatus {
  available: boolean
  name?: string
}
