// ============================================
// DirectoryContext - 管理当前工作目录
// ============================================

import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { getPath, type ApiPath } from '../api'
import { useRouter } from '../hooks/useRouter'
import {
  handleError,
  normalizeToForwardSlash,
  getDirectoryName,
  isSameDirectory,
  serverStorage,
  subscribePerServerStorageVersion,
} from '../utils'
import { layoutStore, useLayoutStore } from '../store/layoutStore'
import { serverStore } from '../store/serverStore'
import { multiServerStore, useMultiServerStore } from '../store/multiServerStore'
import { isTauri } from '../utils/tauri'
import { DirectoryContext, type DirectoryContextValue, type SavedDirectory } from './DirectoryContext.shared'

const STORAGE_KEY_SAVED = 'opencode-saved-directories'
const STORAGE_KEY_RECENT = 'opencode-recent-projects'

// 最近使用记录: { [path]: lastUsedAt }
type RecentProjects = Record<string, number>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

// 项目目录列表按服务器独立保存（原版设计）：切换主机后显示对应主机的项目
function readSavedDirectories(): SavedDirectory[] {
  const saved = serverStorage.getJSON<unknown>(STORAGE_KEY_SAVED)
  if (!Array.isArray(saved)) return []

  return saved.flatMap(item => {
    if (!isRecord(item) || typeof item.path !== 'string') return []
    const path = item.path
    return [
      {
        path,
        name: typeof item.name === 'string' && item.name.trim() ? item.name : getDirectoryName(path) || path,
        addedAt: typeof item.addedAt === 'number' ? item.addedAt : Date.now(),
      },
    ]
  })
}

function readRecentProjects(): RecentProjects {
  const recent = serverStorage.getJSON<unknown>(STORAGE_KEY_RECENT)
  if (!isRecord(recent)) return {}

  return Object.fromEntries(
    Object.entries(recent).filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
  )
}

export function DirectoryProvider({ children }: { children: ReactNode }) {
  // 从 URL 获取 directory（替代 localStorage）
  const { directory: urlDirectory, setDirectory: setUrlDirectory } = useRouter()

  // 从 layoutStore 获取 sidebarExpanded
  const { sidebarExpanded } = useLayoutStore()

  // savedDirectories / recentProjects 绑定的是「读取时的那台服务器」。
  // 只存值不够：写回时必须写回同一台服务器的桶，否则切换主机（或同步引擎
  // 在别的服务器上触发重读）时，会把 A 主机的列表写进 B 主机的桶，原桶被
  // 旧状态覆盖 —— 表现为「新建的项目一同步就没了」。
  const [savedState, setSavedState] = useState<{ serverId: string; directories: SavedDirectory[] }>(() => ({
    serverId: serverStore.getActiveServerId(),
    directories: readSavedDirectories(),
  }))

  const [recentState, setRecentState] = useState<{ serverId: string; projects: RecentProjects }>(() => ({
    serverId: serverStore.getActiveServerId(),
    projects: readRecentProjects(),
  }))

  const savedDirectories = savedState.directories
  const recentProjects = recentState.projects

  const [pathInfo, setPathInfo] = useState<ApiPath | null>(null)

  // 路径信息跟随焦点服务器（焦点缺省 = 活动服务器）。
  // 不再有模式开关：始终按服务器区分路径信息。
  useMultiServerStore()
  const pathServerId = multiServerStore.getFocusedServerId()

  // 服务器 ID 切换时切换 per-server 目录；local runtime URL 变化时只刷新 path info。
  useEffect(() => {
    return serverStore.onServerChange((_, reason) => {
      if (reason === 'server-switch') {
        // 连同 serverId 一起换：写回时才知道这份列表属于哪台服务器。
        setSavedState({ serverId: serverStore.getActiveServerId(), directories: readSavedDirectories() })
        setRecentState({ serverId: serverStore.getActiveServerId(), projects: readRecentProjects() })
        setUrlDirectory(undefined)
      }
      setPathInfo(null)
      getPath(multiServerStore.getFocusedServerId())
        .then(setPathInfo)
        .catch(handleError('get path info', 'api'))
    })
  }, [setUrlDirectory])

  // 加载路径信息（活动/焦点服务器变化时刷新）
  useEffect(() => {
    setPathInfo(null)
    getPath(pathServerId).then(setPathInfo).catch(handleError('get path info', 'api'))
  }, [pathServerId])

  // 感知外部对 per-server 存储的写入（偏好同步引擎拉取别的端的改动时）：
  // savedDirectories / recentProjects 是 useState，不会自动跟随 localStorage，
  // 不重读就会停在初始化快照上，表现为「另一端改了但这边界面不变」。
  //
  // 用「内容相同就不 setState」而不是直接 set：下方的保存 effect 会因 setState
  // 再次写入存储并 bumpVersion，直接 set 会形成 写入→通知→重读→写入 的自激循环。
  // 比较内容后，只有真正变化的键才触发一次 setState，循环在第二轮收敛。
  useEffect(() => {
    return subscribePerServerStorageVersion(() => {
      // 只在「通知来自当前绑定的服务器」时才重读：同步引擎可能改动别的实例的桶，
      // 那种变化不属于本组件正在展示的列表，重读会把当前列表换成别人的内容。
      const activeId = serverStore.getActiveServerId()
      setSavedState(prev => {
        if (prev.serverId !== activeId) return prev
        const next = readSavedDirectories()
        return JSON.stringify(prev.directories) === JSON.stringify(next) ? prev : { serverId: activeId, directories: next }
      })
      setRecentState(prev => {
        if (prev.serverId !== activeId) return prev
        const next = readRecentProjects()
        return JSON.stringify(prev.projects) === JSON.stringify(next) ? prev : { serverId: activeId, projects: next }
      })
    })
  }, [])

  // 写回时必须写回「这份数据所属的服务器」，而不是「当前活动服务器」：
  // 同步引擎可能在别的服务器上触发重读，两者不一致时会把 A 的列表写进 B 的桶，
  // 原桶被旧状态覆盖，表现为「新建的项目一同步就没了」。
  useEffect(() => {
    serverStorage.setJSONFor(STORAGE_KEY_SAVED, savedState.directories, savedState.serverId)
  }, [savedState])

  useEffect(() => {
    serverStorage.setJSONFor(STORAGE_KEY_RECENT, recentState.projects, recentState.serverId)
  }, [recentState])

  // 设置当前目录（更新 URL + 记录最近使用）
  const setCurrentDirectory = useCallback(
    (directory: string | undefined) => {
      setUrlDirectory(directory)
      if (directory) {
        setRecentState(prev => ({ ...prev, projects: { ...prev.projects, [directory]: Date.now() } }))
      }
    },
    [setUrlDirectory],
  )

  // 添加目录
  const addDirectory = useCallback(
    (path: string) => {
      let normalized = normalizeToForwardSlash(path)

      // normalizeToForwardSlash 会去掉尾斜杠，导致根路径 "/" → "" 和 "C:/" → "C:"
      // 需要修正：如果原始路径是根路径，恢复正确的值
      const trimmed = path.replace(/\\/g, '/').replace(/\/+$/, '/')
      if (!normalized && (trimmed === '/' || /^[a-zA-Z]:\/$/.test(trimmed))) {
        normalized = trimmed.slice(0, -1) || '/'
      }

      // 验证路径非空（只阻止空字符串和 "."）
      if (!normalized || normalized === '.') return

      // 使用 isSameDirectory 检查是否已存在（处理大小写和斜杠差异）
      if (savedDirectories.some(d => isSameDirectory(d.path, normalized))) {
        setCurrentDirectory(normalized)
        return
      }

      const newDir: SavedDirectory = {
        path: normalized,
        name: getDirectoryName(normalized) || normalized,
        addedAt: Date.now(),
      }

      setSavedState(prev => ({ ...prev, directories: [...prev.directories, newDir] }))
      setCurrentDirectory(normalized)
    },
    [savedDirectories, setCurrentDirectory],
  )

  // 移除目录
  const removeDirectory = useCallback(
    (path: string) => {
      const normalized = normalizeToForwardSlash(path)
      setSavedState(prev => ({
        ...prev,
        directories: prev.directories.filter(d => !isSameDirectory(d.path, normalized)),
      }))
      if (isSameDirectory(urlDirectory, normalized)) {
        setCurrentDirectory(undefined)
      }
    },
    [urlDirectory, setCurrentDirectory],
  )

  const reorderDirectories = useCallback((draggedPath: string, targetPath: string) => {
    const normalizedDragged = normalizeToForwardSlash(draggedPath)
    const normalizedTarget = normalizeToForwardSlash(targetPath)

    if (!normalizedDragged || !normalizedTarget || isSameDirectory(normalizedDragged, normalizedTarget)) {
      return
    }

    setSavedState(prev => {
      const next = [...prev.directories]
      const draggedIndex = next.findIndex(directory => isSameDirectory(directory.path, normalizedDragged))
      const targetIndex = next.findIndex(directory => isSameDirectory(directory.path, normalizedTarget))

      if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) {
        return prev
      }

      const [draggedDirectory] = next.splice(draggedIndex, 1)
      next.splice(targetIndex, 0, draggedDirectory)
      return { ...prev, directories: next }
    })
  }, [])

  // Tauri: 启动时获取 CLI 传入的目录 + 监听后续 open-directory 事件
  // 用 ref 持有最新的 addDirectory 避免 stale closure
  const addDirectoryRef = useRef(addDirectory)
  addDirectoryRef.current = addDirectory

  useEffect(() => {
    if (!isTauri()) return

    let unlisten: (() => void) | undefined

    // 拉取启动时的 CLI 目录（一次性）
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke<string | null>('get_cli_directory')
        .then(dir => {
          if (dir) addDirectoryRef.current(dir)
        })
        .catch(() => {})
    })

    // 监听后续的 open-directory 事件（single-instance / macOS RunEvent::Opened）
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<string>('open-directory', event => {
        addDirectoryRef.current(event.payload)
      }).then(fn => {
        unlisten = fn
      })
    })

    return () => {
      unlisten?.()
    }
  }, [])

  // 设置侧边栏展开 - 委托给 layoutStore
  const setSidebarExpanded = useCallback((expanded: boolean) => {
    layoutStore.setSidebarExpanded(expanded)
  }, [])

  // 稳定化 Provider value，避免每次渲染创建新对象导致子组件不必要重渲染
  const value = useMemo<DirectoryContextValue>(
    () => ({
      currentDirectory: urlDirectory,
      setCurrentDirectory,
      savedDirectories,
      addDirectory,
      removeDirectory,
      reorderDirectories,
      pathInfo,
      sidebarExpanded,
      setSidebarExpanded,
      recentProjects,
    }),
    [
      urlDirectory,
      setCurrentDirectory,
      savedDirectories,
      addDirectory,
      removeDirectory,
      reorderDirectories,
      pathInfo,
      sidebarExpanded,
      setSidebarExpanded,
      recentProjects,
    ],
  )

  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>
}
