// ============================================
// MultiServerStore - 多服务器焦点配置
//
// 历史：这里曾有一个 `enabled` 总开关 + 服务器订阅白名单。开启后才连接多台
// 服务器、按服务器分组会话。
//
// 现在「连接所有已配置服务器」是默认行为（见 useGlobalEvents 的
// collectActiveServerIds），不再需要开关与白名单：
//   - 主机列表要显示每台的实时状态与版本，必须保持连接
//   - 切换主机要瞬时生效，连接得先建好
// 因此 store 只剩一个职责：记录「项目管理面板当前聚焦的服务器」
// （添加目录时的目标服务器），它跟随当前聚焦 pane 的会话。
//
// 配置持久化在 localStorage。
// ============================================

import { useSyncExternalStore } from 'react'
import { serverStore } from './serverStore'

const STORAGE_KEY = 'opencode-multi-server'

interface PersistedShape {
  /** 项目管理面板当前聚焦的服务器（添加目录时的目标服务器） */
  focusedServerId: string | null
}

type Listener = () => void

function loadPersisted(): PersistedShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedShape>
      return {
        focusedServerId: typeof parsed.focusedServerId === 'string' ? parsed.focusedServerId : null,
      }
    }
    return { focusedServerId: null }
  } catch {
    return { focusedServerId: null }
  }
}

class MultiServerStore {
  private settings: PersistedShape = loadPersisted()
  private listeners: Set<Listener> = new Set()
  private _snapshot: PersistedShape = { ...this.settings }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): PersistedShape {
    return this._snapshot
  }

  private notify(): void {
    this._snapshot = { ...this.settings }
    this.persist()
    this.listeners.forEach(fn => fn())
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings))
    } catch {
      // ignore
    }
  }

  // ============================================
  // 焦点服务器（项目管理面板的目标服务器）
  // ============================================

  /** 当前焦点服务器（缺省 = active server） */
  getFocusedServerId(): string {
    return this.settings.focusedServerId ?? serverStore.getActiveServerId()
  }

  setFocusedServerId(serverId: string | null): void {
    if (this.settings.focusedServerId === serverId) return
    this.settings.focusedServerId = serverId
    this.notify()
  }

  /**
   * home 态（没有聚焦会话）时，让焦点服务器跟随活动服务器。
   *
   * 否则在底部主机条切换主机只改 active、不改 focus：项目列表已按新主机展示，
   * 点「新建项目」打开的却是旧主机的目录选择器（选了 muse 还是显示 Windows 目录）。
   * 有聚焦会话时焦点由该会话决定，不在此处介入。
   */
  syncFocusToActiveServerWhenIdle(hasFocusedSession: boolean): void {
    if (hasFocusedSession) return
    this.setFocusedServerId(serverStore.getActiveServerId())
  }
}

export const multiServerStore = new MultiServerStore()

/** React hook：多服务器焦点配置 */
export function useMultiServerStore(): PersistedShape {
  return useSyncExternalStore(
    listener => multiServerStore.subscribe(listener),
    () => multiServerStore.getSnapshot(),
    () => multiServerStore.getSnapshot(),
  )
}
