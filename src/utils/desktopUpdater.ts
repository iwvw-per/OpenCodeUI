// ============================================
// 桌面端自更新（tauri-plugin-updater）
//
// 与 updateStore 的分工：
//   - updateStore：查 GitHub Releases API，得到「有没有新版本」并驱动提示条，
//     跨平台通用（含 Android）。
//   - 这里：在桌面客户端上真正执行下载 + 安装 + 重启，一端完成。
//
// 插件只在桌面平台注册（见 src-tauri/capabilities/updater.json），移动端调用
// 会直接失败，因此所有入口都先过 isDesktopUpdaterAvailable()。
// ============================================

import { isTauri, isTauriMobile } from './tauri'

export type UpdaterPhase = 'idle' | 'checking' | 'downloading' | 'installing' | 'ready' | 'error'

export interface UpdaterProgress {
  phase: UpdaterPhase
  /** 已下载字节，仅在 downloading 阶段有意义 */
  downloadedBytes: number
  /** 总字节，服务端未提供 Content-Length 时为 null */
  totalBytes: number | null
  error: string | null
}

type Listener = (progress: UpdaterProgress) => void

const INITIAL_PROGRESS: UpdaterProgress = {
  phase: 'idle',
  downloadedBytes: 0,
  totalBytes: null,
  error: null,
}

/**
 * 桌面端是否支持应用内自更新。
 *
 * tauri-plugin-updater 仅覆盖 Windows/macOS/Linux；Android 上该插件未注册，
 * 只能引导用户去 Releases 下载 APK。
 */
export function isDesktopUpdaterAvailable(): boolean {
  return isTauri() && !isTauriMobile()
}

export class DesktopUpdater {
  private progress: UpdaterProgress = INITIAL_PROGRESS
  private listeners = new Set<Listener>()
  private running: Promise<void> | null = null

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): UpdaterProgress => this.progress

  private setProgress(next: Partial<UpdaterProgress>): void {
    this.progress = { ...this.progress, ...next }
    this.listeners.forEach(listener => listener(this.progress))
  }

  /**
   * 下载并安装最新版本。
   *
   * 返回后：
   *   - Windows：安装器已启动，进程即将退出（由插件接管），phase 停在 'ready'
   *   - macOS / Linux：字节已就位，需要调用方调 relaunchApp() 重启
   *   - 没有可用更新：phase 回到 'idle'
   */
  async installLatest(): Promise<void> {
    if (this.running) return this.running

    this.running = (async () => {
      try {
        this.setProgress({ phase: 'checking', downloadedBytes: 0, totalBytes: null, error: null })

        const { check } = await import('@tauri-apps/plugin-updater')
        const update = await check()

        if (!update) {
          this.setProgress({ phase: 'idle' })
          return
        }

        let total: number | null = null
        let downloaded = 0

        await update.downloadAndInstall(event => {
          if (event.event === 'Started') {
            total = event.data.contentLength ?? null
            this.setProgress({ phase: 'downloading', downloadedBytes: 0, totalBytes: total })
            return
          }
          if (event.event === 'Progress') {
            downloaded += event.data.chunkLength
            this.setProgress({ phase: 'downloading', downloadedBytes: downloaded, totalBytes: total })
            return
          }
          this.setProgress({ phase: 'installing' })
        })

        this.setProgress({ phase: 'ready' })
      } catch (error) {
        this.setProgress({
          phase: 'error',
          error: error instanceof Error ? error.message : 'Update failed',
        })
      } finally {
        this.running = null
      }
    })()

    return this.running
  }

  /** macOS / Linux 安装完成后重启到新版本；Windows 由安装器接管，无需调用。 */
  async relaunchApp(): Promise<void> {
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  }

  reset(): void {
    this.setProgress({ ...INITIAL_PROGRESS })
  }
}

export const desktopUpdater = new DesktopUpdater()
