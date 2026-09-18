// ============================================
// Preferences Sync - 客户端设置的多端同步
//
// 登录 API Monitor 账号后，把本地设置（localStorage 全量 + 账号外的服务器
// 列表）推送到面板的 /api/aiagent/preferences，并在启动/登录时拉取合并，
// 让桌面端与 Web 端共享同一份用户偏好。
//
// 同步边界（黑名单制）：
//   默认同步所有键，只排除运行时状态与同步自身的元数据（见 EXCLUDED_*）。
//
//   此前是白名单制（只同步 opencode* / theme-* / i18nextLng），但大量设置
//   用了裸键名（font-scale、diff-style、tool-card-style、chat-wide-mode、
//   immersive-mode 等），不在前缀里 —— 结果是「项目列表能同步、主题色和
//   外观设置不同步」。改为默认同步后，新增设置不会再漏。
// ============================================

import { accountRequest, readAccount, type AiAgentAccount } from './aiagent'

const SYNC_ENABLED_KEY = 'opencode-preferences-sync-enabled'
const SYNC_META_KEY = 'opencode-preferences-sync-meta'

const EXCLUDED_KEYS = new Set([
  // 登录会话本身：同步它等于用凭证去同步凭证，且登录后才同步，无意义。
  'opencode-aiagent-account',
  // 同步自身的状态与元数据，避免自我递归。
  SYNC_ENABLED_KEY,
  SYNC_META_KEY,
  // 服务器列表：含各机器自己的地址与凭证，跨设备同步会把 A 机的
  // localhost 地址带到 B 机，反而不可用。
  'opencode-servers',
  // 当前选中/最近使用的运行时状态：跟随本机环境，跨端同步会让两边互相覆盖。
  'selected-model-key',
  'selected-project-id',
  'last-directory',
  // 用量统计是本机累计值，合并会重复计数。
  'model-usage-stats',
])

const EXCLUDED_PREFIXES = [
  // 多服务器订阅含 focusedServerId 等运行时状态，跨端无意义。
  'opencode-multi-server',
  // per-server 存储按「当前活动服务器」分桶，而活动服务器是本地概念
  // （两台机器都用各自的 localhost 作为 sid）。同步它会把 A 机 local 桶的内容
  // 覆盖到 B 机的 local 桶，语义上不是「共享一份设置」而是互相踩。
  //
  // 注意这里用裸前缀做 startsWith 匹配：键形如 `srv:{serverId}:{key}`，
  // 前两段已由冒号分隔，再加冒号会变成 `srv::` 而匹配不到。
  'srv:',
]

const EXCLUDED_SUFFIXES = [
  // 目录类：记录「上次打开的路径」，是本机上下文，换设备无意义。
  'last-directory',
]

/**
 * 是否参与同步的 localStorage 键。
 *
 * 默认同步；命中排除项则跳过。排除的是「运行时状态」与「本机专属值」，
 * 而非「设置」—— 所有用户可见的设置项都应参与同步。
 */
export function isSyncableKey(key: string): boolean {
  if (!key) return false
  if (EXCLUDED_KEYS.has(key)) return false
  // 前缀判定同时接受「裸前缀」与「前缀 + 冒号」两种写法，
  // 避免调用方在写前缀时纠结要不要带分隔符。
  for (const prefix of EXCLUDED_PREFIXES) {
    if (key.startsWith(prefix)) return false
  }
  for (const suffix of EXCLUDED_SUFFIXES) {
    if (key === suffix || key.endsWith(`:${suffix}`)) return false
  }
  return true
}

/**
 * 列出 localStorage 中的所有键。
 * 优先用 key(index) 遍历；测试环境的 localStorage 桩可能不实现该方法，
 * 回退到 Object.keys（浏览器下 localStorage 的键会作为自有属性暴露）。
 */
function listStorageKeys(): string[] {
  const keys: string[] = []
  try {
    if (typeof localStorage.length === 'number' && typeof localStorage.key === 'function') {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index)
        if (key) keys.push(key)
      }
    }
  } catch {
    // 落到下面的回退
  }
  if (keys.length > 0) return keys
  try {
    return Object.keys(localStorage)
  } catch {
    return []
  }
}

/** 采集当前设备上所有可同步的键值。 */
export function collectLocalPreferences(): Record<string, string> {
  const entries: Record<string, string> = {}
  for (const key of listStorageKeys()) {
    if (!isSyncableKey(key)) continue
    try {
      const value = localStorage.getItem(key)
      if (value !== null) entries[key] = value
    } catch {
      // 单项读取失败不影响其余键
    }
  }
  return entries
}

interface SyncMeta {
  /** 上次成功同步完成的时间戳（毫秒），用于增量判断。 */
  lastSyncedAt: number
  /** 上次推送的键值指纹，内容未变时跳过上传。 */
  fingerprint: string
  /** 最近一次同步结果，供设置页展示。 */
  lastError?: string
}

function readSyncMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY)
    if (!raw) return { lastSyncedAt: 0, fingerprint: '' }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { lastSyncedAt: 0, fingerprint: '' }
    const record = parsed as Record<string, unknown>
    return {
      lastSyncedAt: typeof record.lastSyncedAt === 'number' ? record.lastSyncedAt : 0,
      fingerprint: typeof record.fingerprint === 'string' ? record.fingerprint : '',
      lastError: typeof record.lastError === 'string' ? record.lastError : undefined,
    }
  } catch {
    return { lastSyncedAt: 0, fingerprint: '' }
  }
}

function writeSyncMeta(meta: SyncMeta): void {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta))
  } catch {
    // ignore
  }
}

export function isSyncEnabled(): boolean {
  try {
    return localStorage.getItem(SYNC_ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

export function setSyncEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(SYNC_ENABLED_KEY, '1')
    } else {
      localStorage.removeItem(SYNC_ENABLED_KEY)
    }
  } catch {
    // ignore
  }
}

export function getSyncMeta(): SyncMeta {
  return readSyncMeta()
}

/** 稳定的内容指纹：键排序后拼接，用于判断是否需要上传。 */
function fingerprint(entries: Record<string, string>): string {
  const keys = Object.keys(entries).sort()
  let hash = 2166136261
  for (const key of keys) {
    const line = `${key}=${entries[key]}`
    for (let index = 0; index < line.length; index += 1) {
      hash ^= line.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
  }
  return `${keys.length}:${(hash >>> 0).toString(16)}`
}

interface ServerPreferenceItem {
  key: string
  value: unknown
  updatedAt: string
}

/**
 * 拉取服务端偏好并写入本地。返回写入的键数量。
 *
 * 服务端把值当作不透明的 JSON 存储，但 localStorage 里存的始终是字符串，
 * 因此这里按「原始字符串」语义还原：非字符串的 JSON 值（数组/对象/数字/
 * 布尔）序列化回字符串，字符串值直接使用（它们在推送时就是按需解析的）。
 */
export async function pullPreferences(account?: AiAgentAccount | null): Promise<number> {
  const current = account ?? readAccount()
  if (!current) throw new Error('尚未登录')

  const items = await accountRequest<ServerPreferenceItem[]>(current, '/api/aiagent/preferences')
  if (!Array.isArray(items)) return 0

  let written = 0
  for (const item of items) {
    if (!item || typeof item.key !== 'string' || !isSyncableKey(item.key)) continue
    const value = typeof item.value === 'string' ? item.value : JSON.stringify(item.value)
    if (typeof value !== 'string') continue
    try {
      if (localStorage.getItem(item.key) === value) continue
      localStorage.setItem(item.key, value)
      written += 1
    } catch {
      // 单项写入失败不影响其余键
    }
  }
  return written
}

/**
 * 推送本地偏好到服务端。返回实际写入的键数量。
 *
 * 值统一按「原始字符串」推送：能解析成 JSON 的就推解析后的结构（便于服务端
 * 与其它客户端按类型读取），不能解析的推原始字符串。这样 localStorage 中
 * 既存 JSON 又存裸字符串（如 i18nextLng=zh-CN）的键都能无损往返。
 */
export async function pushPreferences(account?: AiAgentAccount | null, force = false): Promise<number> {
  const current = account ?? readAccount()
  if (!current) throw new Error('尚未登录')

  const entries = collectLocalPreferences()
  const currentFingerprint = fingerprint(entries)
  const meta = readSyncMeta()
  if (!force && currentFingerprint === meta.fingerprint) {
    return 0
  }

  const values: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(entries)) {
    try {
      values[key] = JSON.parse(raw)
    } catch {
      values[key] = raw
    }
  }

  const result = await accountRequest<{ written?: string[] }>(current, '/api/aiagent/preferences', {
    method: 'PUT',
    body: JSON.stringify({ values, updatedAt: new Date().toISOString() }),
  })

  writeSyncMeta({
    lastSyncedAt: Date.now(),
    fingerprint: currentFingerprint,
  })
  return Array.isArray(result?.written) ? result.written.length : Object.keys(values).length
}

/**
 * 双向同步：先拉取服务端偏好到本地，再推送本地偏好。
 * 拉取覆盖本地同名键，因此多端冲突时以服务端为准。
 */
export async function syncPreferences(account?: AiAgentAccount | null, force = false): Promise<{ pulled: number; pushed: number }> {
  const current = account ?? readAccount()
  if (!current) throw new Error('尚未登录')
  try {
    const pulled = await pullPreferences(current)
    const pushed = await pushPreferences(current, force)
    return { pulled, pushed }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const meta = readSyncMeta()
    writeSyncMeta({ ...meta, lastError: message })
    throw error
  }
}

export const PreferencesSyncApi = {
  isSyncEnabled,
  setSyncEnabled,
  getSyncMeta,
  collectLocalPreferences,
  isSyncableKey,
  pullPreferences,
  pushPreferences,
  syncPreferences,
}

export default PreferencesSyncApi
