import { useCallback, useMemo, useState, useEffect, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderRecentList, type FolderRecentProject } from './FolderRecentList'
import { HostList } from './HostList'
import { HostQuickSwitcher } from './HostQuickSwitcher'
import { SessionSortMenu } from './SessionSortMenu'
import { useMultiServerStore } from '../../../store/multiServerStore'
import { useServerStore } from '../../../hooks/useServerStore'
import { getProjectGroupIdentity } from './projectGrouping'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { IconButton } from '../../../components/ui/IconButton'
import { Spinner } from '../../../components/ui/Spinner'
import { Tabs, TabsList, TabsTrigger } from '../../../components/ui/Tabs'
import { SidebarFooter } from './SidebarFooter'
import {
  SidebarIcon,
  FolderIcon,
  PlusIcon,
  NewChatIcon,
  TrashIcon,
  SearchIcon,
  CloseIcon,
  ManageSessionsIcon,
  FolderMinusIcon,
  CheckIcon,
  GlobeIcon,
} from '../../../components/Icons'
import { useDirectory, useKeybindingLabel, useGitWorkspaceCatalog } from '../../../hooks'
import { useServerProjects } from '../../../hooks/useServerProjects'
import { useServerGlobalSessionDirectories } from '../../../hooks/useServerGlobalSessionDirectories'
import { useProjectLastUsedAt } from '../../../hooks/useProjectLastUsedAt'
import { useSessionContext } from '../../../contexts/useSessionContext'
import { useLayoutStore, childSessionStore } from '../../../store'
import { useBusySessions } from '../../../store/activeSessionStore'
import { notificationStore, useNotifications } from '../../../store/notificationStore'
import { pinnedSessionsStore } from '../../../store/pinnedSessionsStore'
import { serverStore } from '../../../store/serverStore'
import {
  updateSession,
  deleteSession as apiDeleteSession,
  getSession,
  subscribeToConnectionState,
  type ApiSession,
  type ConnectionInfo,
} from '../../../api'
import { getDirectoryName, isSameDirectory, normalizeToForwardSlash } from '../../../utils'
import { makeSessionKey, splitSessionKey } from '../../../utils/sessionKey'
import { uiErrorHandler } from '../../../utils'
import { cn } from '../../../utils/cn'
import { interactive } from '../../../utils/interaction'

// 侧边栏设计模式：
// - 按钮结构统一，不因 expanded/collapsed 改变 DOM
// - 按钮内容使用 -translate-x-2 让图标在收起时居中
// - 文字用 opacity 过渡，不改变布局
// - 收起宽度 49px，展开宽度 288px

interface SidePanelProps {
  onNewSession: () => void
  onSelectSession: (session: ApiSession) => void
  onCloseMobile?: () => void
  selectedSessionId: string | null
  onAddProject: () => void
  isMobile?: boolean
  isExpanded?: boolean
  onToggleSidebar: () => void
  contextLimit?: number
  onOpenSettings?: () => void
  /** 桌面端标题栏已承载 logo 与开关：隐藏顶部 header 行 */
  hideHeader?: boolean
}

interface ProjectItem {
  id: string
  worktree: string
  name: string
  canReorder?: boolean
  memberDirectories?: string[]
  reorderPath?: string
  workspaceDirectories?: string[]
  sectionKind?: 'project' | 'workspace'
  /** 推导项目（无已保存工作区时从服务器会话自动生成）：不参与重排/移除 */
  isDerived?: boolean
}

function getSelectionRange(visibleIds: string[], anchorId: string, targetId: string) {
  const startIndex = visibleIds.indexOf(anchorId)
  const endIndex = visibleIds.indexOf(targetId)

  if (startIndex === -1 || endIndex === -1) return null

  const from = Math.min(startIndex, endIndex)
  const to = Math.max(startIndex, endIndex)
  return visibleIds.slice(from, to + 1)
}

const HIDDEN_DIRECTORIES_KEY = 'opencode-hidden-directories'
const PROJECT_ORDER_KEY = 'opencode-project-order'

function readHiddenDirectories(serverId: string): string[] {
  try {
    const raw = localStorage.getItem(`srv:${serverId}:${HIDDEN_DIRECTORIES_KEY}`)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function writeHiddenDirectories(serverId: string, directories: string[]): void {
  try {
    localStorage.setItem(`srv:${serverId}:${HIDDEN_DIRECTORIES_KEY}`, JSON.stringify(directories))
  } catch {
    // ignore
  }
}

function readProjectOrder(serverId: string): string[] {
  try {
    const raw = localStorage.getItem(`srv:${serverId}:${PROJECT_ORDER_KEY}`)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function findProjectGroupForDirectory(projects: ProjectItem[], directory: string) {
  return projects.find(project => {
    if (isSameDirectory(project.id, directory) || isSameDirectory(project.worktree, directory)) {
      return true
    }

    if (project.workspaceDirectories?.some(workspace => isSameDirectory(workspace, directory))) {
      return true
    }

    if (project.memberDirectories?.some(memberDirectory => isSameDirectory(memberDirectory, directory))) {
      return true
    }

    return false
  })
}

export function SidePanel({
  onNewSession,
  onSelectSession,
  onCloseMobile,
  selectedSessionId,
  onAddProject,
  isMobile = false,
  isExpanded = true,
  onToggleSidebar,
  contextLimit = 200000,
  onOpenSettings,
  hideHeader = false,
}: SidePanelProps) {
  const { t } = useTranslation(['chat', 'common'])
  const {
    currentDirectory,
    savedDirectories,
    setCurrentDirectory,
    removeDirectory,
    reorderDirectories,
    pathInfo,
    recentProjects,
  } = useDirectory()
  const catalogDirectories = useMemo(
    () =>
      Array.from(
        new Set(
          savedDirectories
            .map(directory => normalizeToForwardSlash(directory.path))
            .concat(currentDirectory ? [normalizeToForwardSlash(currentDirectory)] : []),
        ),
      ),
    [savedDirectories, currentDirectory],
  )
  // 多服务器：Git/路径信息跟随「焦点服务器」（焦点缺省 = 活动服务器）。
  // 不再用 enabled 门控 —— 现在始终连接所有服务器，多服务器是默认行为。
  const multiServerConfig = useMultiServerStore()
  const { activeServer } = useServerStore()
  const catalogServerId = multiServerConfig.focusedServerId ?? activeServer?.id
  // 项目 tab 数据源 = 活动服务器（per-server 存储）；同时发现其服务端项目/目录
  const activeServerId = activeServer?.id ?? 'local'
  const { projects: serverProjects, isLoading: isServerProjectsLoading } = useServerProjects(activeServerId, true)
  const { groups: globalSessionGroups, isLoading: isGlobalGroupsLoading } = useServerGlobalSessionDirectories(
    activeServerId,
    true,
  )
  const { catalog: gitWorkspaceCatalog, isLoading: isGitWorkspaceCatalogLoading } = useGitWorkspaceCatalog(
    catalogDirectories,
    catalogServerId,
  )
  const { sidebarChildSessions, sidebarSessionSortDesc } = useLayoutStore()
  // all = 始终列出全部子会话；active = 只列活跃/正在查看；off = 不额外列出
  const showAllChildSessions = sidebarChildSessions === 'all'
  const showActiveChildSessions = sidebarChildSessions !== 'off'
  const normalizedCurrentDirectory = useMemo(
    () => (currentDirectory ? normalizeToForwardSlash(currentDirectory) : undefined),
    [currentDirectory],
  )
  const [connectionState, setConnectionState] = useState<ConnectionInfo | null>(null)
  // 侧栏视图：主机（切换后端）/ 项目（会话与项目）
  const [sidebarTab, setSidebarTab] = useState<'hosts' | 'projects'>('projects')
  const [expandedRecentProjectIds, setExpandedRecentProjectIds] = useState<string[]>([])

  // ---- 编辑模式状态 ----
  const [isEditMode, setIsEditMode] = useState(false)
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set())
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set())
  const sessionSelectionAnchorIdRef = useRef<string | null>(null)
  const projectSelectionAnchorIdRef = useRef<string | null>(null)
  const recentsSelectionRootRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const pendingFocusSearchRef = useRef(false)
  // 批量删除确认弹窗
  const [batchDeleteSessionConfirm, setBatchDeleteSessionConfirm] = useState(false)
  const [batchRemoveProjectConfirm, setBatchRemoveProjectConfirm] = useState(false)
  const [isBatchDeleting, setIsBatchDeleting] = useState(false)

  // 已隐藏的服务器发现目录（每主机独立；"移除"发现项目 = 加入隐藏列表，不再展示）
  const [hiddenDirectories, setHiddenDirectories] = useState<Set<string>>(
    () => new Set(readHiddenDirectories(activeServerId)),
  )
  useEffect(() => {
    setHiddenDirectories(new Set(readHiddenDirectories(activeServerId)))
  }, [activeServerId])
  // 项目显示顺序（每主机独立；拖拽重排后持久化，覆盖已保存 + 发现项目）
  const [projectOrder, setProjectOrder] = useState<string[]>(() => readProjectOrder(activeServerId))
  useEffect(() => {
    setProjectOrder(readProjectOrder(activeServerId))
  }, [activeServerId])

  const getVisibleSelectionIds = useCallback((kind: 'session' | 'project') => {
    const root = recentsSelectionRootRef.current
    if (!root) return []

    return Array.from(root.querySelectorAll<HTMLElement>(`[data-selection-kind="${kind}"]`))
      .filter(element => element.getClientRects().length > 0)
      .map(element => element.dataset.selectionId)
      .filter((id): id is string => Boolean(id))
  }, [])

  const toggleSessionSelection = useCallback(
    (sessionId: string, options?: { shiftKey?: boolean }) => {
      const anchorId = sessionSelectionAnchorIdRef.current
      const visibleIds = getVisibleSelectionIds('session')

      setSelectedSessionIds(prev => {
        if (options?.shiftKey && anchorId) {
          const range = getSelectionRange(visibleIds, anchorId, sessionId)
          if (range) {
            const next = new Set(prev)
            // 目标已选中 → 整段取消；未选中 → 整段选中
            const shouldSelect = !prev.has(sessionId)
            for (const id of range) {
              if (shouldSelect) next.add(id)
              else next.delete(id)
            }
            return next
          }
        }

        const next = new Set(prev)
        if (next.has(sessionId)) next.delete(sessionId)
        else next.add(sessionId)
        return next
      })
      // Shift 范围操作后仍保留锚点，方便连续扩选/缩选
      if (!(options?.shiftKey && anchorId)) {
        sessionSelectionAnchorIdRef.current = sessionId
      }
    },
    [getVisibleSelectionIds],
  )

  const toggleProjectSelection = useCallback(
    (projectId: string, options?: { shiftKey?: boolean }) => {
      const anchorId = projectSelectionAnchorIdRef.current
      const visibleIds = getVisibleSelectionIds('project')

      setSelectedProjectIds(prev => {
        if (options?.shiftKey && anchorId) {
          const range = getSelectionRange(visibleIds, anchorId, projectId)
          if (range) {
            const next = new Set(prev)
            const shouldSelect = !prev.has(projectId)
            for (const id of range) {
              if (shouldSelect) next.add(id)
              else next.delete(id)
            }
            return next
          }
        }

        const next = new Set(prev)
        if (next.has(projectId)) next.delete(projectId)
        else next.add(projectId)
        return next
      })
      if (!(options?.shiftKey && anchorId)) {
        projectSelectionAnchorIdRef.current = projectId
      }
    },
    [getVisibleSelectionIds],
  )

  const exitEditMode = useCallback(() => {
    setIsEditMode(false)
    setSelectedSessionIds(new Set())
    setSelectedProjectIds(new Set())
    sessionSelectionAnchorIdRef.current = null
    projectSelectionAnchorIdRef.current = null
  }, [])

  const enterEditMode = useCallback(() => {
    setIsEditMode(true)
    sessionSelectionAnchorIdRef.current = null
    projectSelectionAnchorIdRef.current = null
  }, [])

  const showLabels = isExpanded || isMobile
  const newChatShortcut = useKeybindingLabel('newSession')

  // 收起态点搜索：展开后再聚焦输入框
  useEffect(() => {
    if (!showLabels) return

    if (pendingFocusSearchRef.current) {
      pendingFocusSearchRef.current = false
      const frameId = requestAnimationFrame(() => {
        searchInputRef.current?.focus()
      })
      return () => cancelAnimationFrame(frameId)
    }
  }, [showLabels])

  // Active sessions
  const busySessions = useBusySessions()
  useSyncExternalStore(
    childSessionStore.subscribe.bind(childSessionStore),
    childSessionStore.getVersion,
    childSessionStore.getVersion,
  )
  // Notification history
  const notifications = useNotifications()

  useEffect(() => {
    return subscribeToConnectionState(setConnectionState)
  }, [])

  const { sessions, search, setSearch, refresh } = useSessionContext()

  const pinnedEntries = useSyncExternalStore(
    pinnedSessionsStore.subscribe,
    pinnedSessionsStore.getSnapshot,
    pinnedSessionsStore.getSnapshot,
  )
  // 缓存通过 API 拉取的 session 数据（sessions 列表中不存在的）
  const [fetchedSessions, setFetchedSessions] = useState<Record<string, ApiSession>>({})
  // 防止 busySessions 等数组引用抖动时 cancel+重拉，导致 /session 风暴
  const inflightSessionIdsRef = useRef(new Set<string>())
  const failedSessionIdsRef = useRef(new Set<string>())

  // 为 active sessions 构建 sessionId -> ApiSession 的查找表
  const sessionLookup = useMemo(() => {
    const map = new Map<string, ApiSession>()
    for (const s of sessions) {
      map.set(s.id, s)
    }
    // fetchedSessions 作为补充（其他项目的 session）
    for (const [id, s] of Object.entries(fetchedSessions)) {
      if (!map.has(id)) {
        map.set(id, s)
      }
    }
    return map
  }, [sessions, fetchedSessions])

  const resolvedPinnedSessions = useMemo(
    () =>
      pinnedEntries
        .map(entry => sessionLookup.get(entry.sessionId))
        .filter((session): session is ApiSession => Boolean(session)),
    [pinnedEntries, sessionLookup],
  )
  // 当前 lookup 里没有的置顶：灰色展示，始终可取消
  const unavailablePinnedEntries = useMemo(
    () => pinnedEntries.filter(entry => !sessionLookup.has(entry.sessionId)),
    [pinnedEntries, sessionLookup],
  )

  // 切服务器时清空跨目录 fetch 缓存，避免串服
  useEffect(() => {
    return serverStore.onServerChange(() => {
      setFetchedSessions({})
      inflightSessionIdsRef.current.clear()
      failedSessionIdsRef.current.clear()
    })
  }, [])

  // 需要补全的 session 集合：用内容 key 稳定，避免 busySessions 数组引用抖动触发重拉
  const missingSessionsKey = useMemo(() => {
    const byId = new Map<string, { sessionId: string; directory?: string; pinned?: boolean }>()
    const add = (sessionId: string, directory?: string, pinned?: boolean) => {
      if (sessionLookup.has(sessionId)) return
      const existing = byId.get(sessionId)
      if (existing) {
        byId.set(sessionId, {
          sessionId,
          directory: existing.directory || directory,
          pinned: existing.pinned || pinned,
        })
        return
      }
      byId.set(sessionId, { sessionId, directory, pinned })
    }

    for (const entry of busySessions) add(entry.sessionId, entry.directory)
    for (const entry of notifications) add(entry.sessionId, entry.directory)
    for (const entry of pinnedEntries) add(entry.sessionId, entry.directory, true)
    if (selectedSessionId) add(selectedSessionId, currentDirectory || undefined)

    return Array.from(byId.values())
      .map(e => `${e.sessionId}\0${e.directory ?? ''}\0${e.pinned ? '1' : '0'}`)
      .sort()
      .join('|')
  }, [busySessions, notifications, pinnedEntries, sessionLookup, selectedSessionId, currentDirectory])

  // 异步拉取不在 lookup 中的 active/notification/pinned/selected session
  useEffect(() => {
    const neededIds = new Set<string>()
    const missing: Array<{ sessionId: string; directory?: string; pinned?: boolean }> = []

    if (missingSessionsKey) {
      for (const token of missingSessionsKey.split('|')) {
        const [sessionId, directory, pinned] = token.split('\0')
        if (!sessionId) continue
        neededIds.add(sessionId)
        if (sessionLookup.has(sessionId)) continue
        if (inflightSessionIdsRef.current.has(sessionId)) continue
        if (failedSessionIdsRef.current.has(sessionId)) continue
        missing.push({
          sessionId,
          directory: directory || undefined,
          pinned: pinned === '1',
        })
      }
    }

    // 不再需要的失败记录清掉，session 再次出现时允许重试
    for (const sessionId of [...failedSessionIdsRef.current]) {
      if (!neededIds.has(sessionId)) failedSessionIdsRef.current.delete(sessionId)
    }

    if (missing.length === 0) return

    for (const entry of missing) {
      inflightSessionIdsRef.current.add(entry.sessionId)
    }

    void Promise.allSettled(
      missing.map(async entry => {
        try {
          const session = await getSession(entry.sessionId, entry.directory)
          inflightSessionIdsRef.current.delete(entry.sessionId)
          setFetchedSessions(prev => (prev[session.id] ? prev : { ...prev, [session.id]: session }))
          if (entry.pinned) {
            pinnedSessionsStore.update(session.id, {
              directory: session.directory || entry.directory,
              title: session.title || session.id.slice(0, 12) + '...',
            })
          }
        } catch {
          inflightSessionIdsRef.current.delete(entry.sessionId)
          // 失败只记一次，避免 SSE/busy 抖动时无限重试 /session
          failedSessionIdsRef.current.add(entry.sessionId)
        }
      }),
    )
  }, [missingSessionsKey, sessionLookup])

  // ---- 子 session 展示数据 ----
  const rootSessionIds = useMemo(() => new Set(sessions.map(s => s.id)), [sessions])

  const findParentId = useCallback(
    (id: string) => {
      // 输入可能是复合 key（serverId::sessionId）或原始 id；返回「原始 parentID」
      // （sessions/sessionLookup 以原始 id 存；childSessionStore 以复合 key 存）
      const { serverId, sessionId } = splitSessionKey(id)
      const s = sessionLookup.get(sessionId)
      if (s?.parentID) return s.parentID
      const childInfo = childSessionStore.getSessionInfo(id.includes('::') ? id : makeSessionKey(serverId, id))
      return childInfo ? splitSessionKey(childInfo.parentID).sessionId : undefined
    },
    [sessionLookup],
  )

  // all → 拉 /children 全量：选中的 root 或选中子 session 时保持其父展开
  const expandedChildSessionIds = useMemo(() => {
    if (search || !showAllChildSessions || !selectedSessionId) return undefined
    // 选中 session 可能属于任意服务器，直接用全服务器的 childSessionStore 判断
    if (childSessionStore.getChildSessionIds(selectedSessionId).length > 0) {
      return new Set([splitSessionKey(selectedSessionId).sessionId])
    }
    const pid = findParentId(selectedSessionId)
    if (pid) return new Set([pid])
    return undefined
  }, [search, showAllChildSessions, selectedSessionId, findParentId])

  // active → 只挂活跃的 + 选中的子 session；off → 只挂选中的那个
  const inlineChildSessions = useMemo(() => {
    if (search) return undefined
    const map = new Map<string, ApiSession[]>()
    const add = (parentId: string, session: ApiSession) => {
      if (expandedChildSessionIds?.has(parentId)) return
      let arr = map.get(parentId)
      if (!arr) {
        arr = []
        map.set(parentId, arr)
      }
      if (!arr.some(s => s.id === session.id)) arr.push(session)
    }
    if (showActiveChildSessions) {
      for (const entry of busySessions) {
        const pid = findParentId(entry.sessionId)
        // 父可能在其它服务器的会话列表里，因此放宽为「只要解析出父 id 就挂上」，
        // 不再要求父在 rootSessionIds（那只是当前服务器的列表）
        if (pid) {
          const rawId = splitSessionKey(entry.sessionId).sessionId
          // sessionLookup 只含 active 服务器会话；其他服务器的子 session 用 entry 构造
          const s =
            sessionLookup.get(rawId) ??
            (entry.title || entry.directory
              ? ({ id: rawId, title: entry.title, directory: entry.directory } as ApiSession)
              : undefined)
          if (s) add(pid, s)
        }
      }
    }
    if (selectedSessionId && !rootSessionIds.has(splitSessionKey(selectedSessionId).sessionId)) {
      // 只挂「当前服务器列表里能确认是父」的，避免把别的服务器的会话误挂上来
      const pid = findParentId(selectedSessionId)
      if (pid && rootSessionIds.has(pid)) {
        const s = sessionLookup.get(splitSessionKey(selectedSessionId).sessionId)
        if (s) add(pid, s)
      }
    }
    return map.size > 0 ? map : undefined
  }, [
    search,
    busySessions,
    selectedSessionId,
    showActiveChildSessions,
    rootSessionIds,
    expandedChildSessionIds,
    sessionLookup,
    findParentId,
  ])

  const buildProjectGroups = useCallback(
    (directories: typeof savedDirectories, isDerived = false): ProjectItem[] => {
      const savedNameByPath = new Map(
        directories.map(directory => [normalizeToForwardSlash(directory.path), directory.name]),
      )
      const groups = new Map<string, ProjectItem>()

      for (const directory of directories) {
        const normalizedDirectory = normalizeToForwardSlash(directory.path)
        const meta = gitWorkspaceCatalog.get(normalizedDirectory)
        const { projectId, workspaceDirectories } = getProjectGroupIdentity(normalizedDirectory, meta)
        const existing = groups.get(projectId)

        if (existing) {
          groups.set(projectId, {
            ...existing,
            memberDirectories: [...(existing.memberDirectories ?? []), directory.path],
            reorderPath: existing.reorderPath ?? directory.path,
          })
          continue
        }

        groups.set(projectId, {
          id: projectId,
          worktree: projectId,
          name: savedNameByPath.get(projectId) ?? getDirectoryName(projectId),
          canReorder: !isDerived,
          isDerived: isDerived || undefined,
          memberDirectories: [directory.path],
          reorderPath: directory.path,
          workspaceDirectories,
        })
      }

      return Array.from(groups.values()).map(project => {
        if (!project.workspaceDirectories?.length) return project

        const savedWorkspaceDirectories = (project.memberDirectories ?? [])
          .map(directory => normalizeToForwardSlash(directory))
          .filter(directory => project.workspaceDirectories?.some(workspace => isSameDirectory(workspace, directory)))

        const remainingWorkspaceDirectories = project.workspaceDirectories.filter(
          workspace => !savedWorkspaceDirectories.some(directory => isSameDirectory(directory, workspace)),
        )

        return {
          ...project,
          workspaceDirectories: [...savedWorkspaceDirectories, ...remainingWorkspaceDirectories],
        }
      })
    },
    [gitWorkspaceCatalog],
  )

  const folderProjectGroups = useMemo<ProjectItem[]>(() => {
    return buildProjectGroups(savedDirectories)
  }, [buildProjectGroups, savedDirectories])

  const globalProject = useMemo<ProjectItem>(
    () => ({
      id: 'global',
      worktree: t('sidebar.allProjects'),
      name: t('sidebar.global'),
    }),
    [t],
  )

  const currentProject = useMemo<ProjectItem>(() => {
    if (!currentDirectory) return globalProject

    const groupedProject = findProjectGroupForDirectory(folderProjectGroups, normalizedCurrentDirectory!)
    if (groupedProject) return groupedProject

    const meta = gitWorkspaceCatalog.get(normalizedCurrentDirectory!)
    const { projectId, workspaceDirectories } = getProjectGroupIdentity(normalizedCurrentDirectory!, meta)
    const found = findProjectGroupForDirectory(folderProjectGroups, projectId)
    if (found) return found

    return {
      id: projectId,
      worktree: projectId,
      name: getDirectoryName(projectId),
      canReorder: false,
      isDerived: true,
      memberDirectories: [],
      workspaceDirectories,
    }
  }, [currentDirectory, folderProjectGroups, gitWorkspaceCatalog, globalProject, normalizedCurrentDirectory])

  // 当前激活项目 = 服务器当前 worktree（pathInfo）。仅当是真实目录时自动置顶；
  // 根 worktree（global 项目）不展示 —— 用户明确不要「全局」文件夹
  const serverCurrentProject = useMemo<ProjectItem | null>(() => {
    const raw = pathInfo?.worktree
    if (!raw) return null
    const worktree = normalizeToForwardSlash(raw)
    if (!worktree || worktree === '/') return null
    return {
      id: worktree,
      worktree,
      name: getDirectoryName(worktree) || worktree,
      canReorder: false,
      isDerived: true,
    }
  }, [pathInfo])

  // 服务器侧发现的「项目」：/project 的 git 项目 + 全局存储会话按 directory 分组的目录
  // （如 work 主机的 D:\AAADATA\OneDrive - moi\TEMP\HYY）。标记 isDerived（不参与重排；
  // 点其中会话后自动保存为该主机的真实工作区；「移除」= 加入隐藏列表不再展示）
  const discoveredProjectItems = useMemo<ProjectItem[]>(() => {
    const items: ProjectItem[] = []
    const pushWorktree = (worktree: string) => {
      const normalized = normalizeToForwardSlash(worktree)
      if (!normalized || normalized === '/') return
      if (hiddenDirectories.has(normalized)) return
      if (items.some(item => item.worktree === normalized)) return
      items.push({
        id: normalized,
        worktree: normalized,
        name: getDirectoryName(normalized) || normalized,
        canReorder: true,
        isDerived: true,
      })
    }
    for (const project of serverProjects) pushWorktree(project.worktree || '')
    for (const group of globalSessionGroups) pushWorktree(group.directory)
    return items
  }, [serverProjects, globalSessionGroups, hiddenDirectories])

  const folderProjects = useMemo<ProjectItem[]>(() => {
    let list: ProjectItem[] = []
    // 已保存项目（当前主机的 per-server 列表）；根路径（global 项目，归一化后为空）不展示「全局」文件夹
    const nonRootGroups = folderProjectGroups.filter(project => normalizeToForwardSlash(project.worktree || '') !== '')
    // 当前激活项目（真实目录）置顶，与已保存项目重复时不重复添加
    if (
      serverCurrentProject &&
      !nonRootGroups.some(project => isSameDirectory(project.worktree, serverCurrentProject.worktree))
    ) {
      list.push(serverCurrentProject)
    }
    list.push(...nonRootGroups)
    // 服务器侧发现的项目/目录（与已保存项目按目录去重；切换主机即显示对应主机的项目）
    const knownWorktrees = new Set(list.map(project => normalizeToForwardSlash(project.worktree || '')))
    for (const item of discoveredProjectItems) {
      const worktree = normalizeToForwardSlash(item.worktree || '')
      if (!worktree || knownWorktrees.has(worktree)) continue
      knownWorktrees.add(worktree)
      list.push(item)
    }

    if (currentDirectory && !list.some(project => isSameDirectory(project.worktree, currentProject.worktree))) {
      list.push({ ...currentProject, canReorder: false })
    }

    // 应用每主机拖拽保存的显示顺序：在顺序列表中的项按顺序排前，其余追加在后
    if (projectOrder.length > 0) {
      const byWorktree = new Map(list.map(project => [normalizeToForwardSlash(project.worktree || ''), project]))
      const ordered: ProjectItem[] = []
      const seen = new Set<string>()
      for (const path of projectOrder) {
        const normalized = normalizeToForwardSlash(path)
        const project = byWorktree.get(normalized)
        if (project && !seen.has(normalized)) {
          ordered.push(project)
          seen.add(normalized)
        }
      }
      for (const project of list) {
        const normalized = normalizeToForwardSlash(project.worktree || '')
        if (!seen.has(normalized)) {
          ordered.push(project)
          seen.add(normalized)
        }
      }
      list = ordered
    }

    // 不展示「全局」文件夹：全局把所有会话堆在一起条目多且卡，用户只按项目打开会话
    return list
  }, [
    serverCurrentProject,
    folderProjectGroups,
    discoveredProjectItems,
    projectOrder,
    currentDirectory,
    currentProject,
  ])

  // 新添加/新保存的项目自动展开（服务器发现的 isDerived 项目不自动展开，避免一堆目录同时加载）
  const prevFolderProjectIdsRef = useRef<string[] | null>(null)
  useEffect(() => {
    const ids = folderProjects.filter(project => !project.isDerived).map(project => project.id)
    const prev = prevFolderProjectIdsRef.current
    prevFolderProjectIdsRef.current = ids
    if (!prev) return
    const added = ids.filter(id => !prev.includes(id))
    if (added.length > 0) {
      setExpandedRecentProjectIds(current => {
        const missing = added.filter(id => !current.includes(id))
        return missing.length > 0 ? [...current, ...missing] : current
      })
    }
  }, [folderProjects])

  const workspaceDirectoriesByProjectId = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const project of folderProjects) {
      if (project.workspaceDirectories && project.workspaceDirectories.length > 1) {
        map.set(project.id, project.workspaceDirectories)
      }
    }
    return map
  }, [folderProjects])

  const currentProjectWorkspaceDirectories = useMemo(
    () => currentProject.workspaceDirectories ?? [],
    [currentProject.workspaceDirectories],
  )
  const shouldWaitForWorkspaceResolution =
    !search &&
    !!currentDirectory &&
    isGitWorkspaceCatalogLoading &&
    currentProjectWorkspaceDirectories.length <= 1 &&
    !!normalizedCurrentDirectory &&
    !gitWorkspaceCatalog.has(normalizedCurrentDirectory)
  // 服务器侧项目/目录发现中且还没有任何可展示项 → 转圈，避免空状态闪现
  const isDiscoveringServerData =
    (isServerProjectsLoading || isGlobalGroupsLoading) &&
    folderProjectGroups.length === 0 &&
    discoveredProjectItems.length === 0

  const allDisplayedProjects = useMemo(() => {
    return [...folderProjects]
  }, [folderProjects])

  // ---- 项目行「最后使用时间」----
  // 来源：全局会话列表已含非 git 目录（TEMP 等）的会话时间（0 额外请求）；
  // git worktree 的会话按目录存储，单独拉取；本地点击记录（recentProjects）作兜底。
  const globalProjectLastUsed = useMemo(() => {
    const map: Record<string, number> = {}
    for (const group of globalSessionGroups) {
      if (group.lastUsedAt) map[normalizeToForwardSlash(group.directory)] = group.lastUsedAt
    }
    return map
  }, [globalSessionGroups])

  const uncoveredProjectWorktrees = useMemo(
    () =>
      allDisplayedProjects
        .map(project => normalizeToForwardSlash(project.worktree || ''))
        .filter(worktree => !!worktree && !globalProjectLastUsed[worktree]),
    [allDisplayedProjects, globalProjectLastUsed],
  )
  const fetchedProjectLastUsed = useProjectLastUsedAt(activeServerId, uncoveredProjectWorktrees, true)

  const projectLastUsedAt = useMemo(() => {
    const map: Record<string, number> = { ...recentProjects }
    for (const [directory, updated] of Object.entries(globalProjectLastUsed)) map[directory] = updated
    for (const [directory, updated] of Object.entries(fetchedProjectLastUsed)) map[directory] = updated
    return map
  }, [recentProjects, globalProjectLastUsed, fetchedProjectLastUsed])

  /**
   * 项目（文件夹）的最终显示顺序。
   *
   * 排序菜单此前只管项目内会话，项目本身是"当前项目置顶 + 保存顺序 + 发现顺序"
   * 的混排，看起来就像"排序没生效"。这里让同一套方向偏好也作用于项目。
   *
   * 数据限制：ProjectItem 没有创建时间字段，因此「创建时间」与「更新时间」
   * 都只能用 projectLastUsedAt（会话最后活跃时间）—— 差异只在方向。
   * 缺省视作 0；同名时按名称兜底，保证顺序稳定不抖动。
   *
   * 注意：这里对全列表统一排序，会覆盖 folderProjects 里「当前激活项目置顶」
   * 的初始顺序 —— 那是刻意的，否则置顶项会永远不参与排序。
   */
  const sortedFolderProjects = useMemo(() => {
    const lastUsed = (project: ProjectItem): number =>
      projectLastUsedAt[normalizeToForwardSlash(project.worktree || '')] ?? 0

    return [...folderProjects].sort((a, b) => {
      const ta = lastUsed(a)
      const tb = lastUsed(b)
      if (ta !== tb) return sidebarSessionSortDesc ? tb - ta : ta - tb
      return a.name.localeCompare(b.name)
    })
  }, [folderProjects, projectLastUsedAt, sidebarSessionSortDesc])

  // 需求 3：点击项目目录/名称不跳转（只展开/收起），只有点击会话才导航。
  // 保持签名兼容 FolderRecentList 的 onSelectProject 调用，但不再 setCurrentDirectory。
  const handleSelectFolderProject = useCallback((_project: ProjectItem) => {}, [])

  const getProjectDirectoriesToRemove = useCallback(
    (projectId: string) => {
      const project = allDisplayedProjects.find(item => isSameDirectory(item.id, projectId))
      return project?.memberDirectories?.length ? project.memberDirectories : [projectId]
    },
    [allDisplayedProjects],
  )

  const handleReorderProjectGroup = useCallback(
    (draggedId: string, targetId: string) => {
      const draggedIdx = folderProjects.findIndex(project => project.id === draggedId)
      const targetIdx = folderProjects.findIndex(project => project.id === targetId)
      if (draggedIdx === -1 || targetIdx === -1 || draggedIdx === targetIdx) return

      // 不展示「全局」文件夹，故不存在全局行拖拽分支
      const draggedReorderPath = folderProjects[draggedIdx].reorderPath
      const targetReorderPath = folderProjects[targetIdx].reorderPath
      if (!draggedReorderPath || !targetReorderPath) return
      reorderDirectories(draggedReorderPath, targetReorderPath)
    },
    [folderProjects, reorderDirectories],
  )

  const handleSelectActive = useCallback(
    (session: ApiSession & { serverId?: string }) => {
      // 只导航，不自动保存目录到项目列表：目录由 URL（?dir=）派生，currentDirectory 自动跟随；
      // 若在此 addDirectory，点一次会话就把项目塞进已保存列表，触发列表重建 + 自动展开级联。
      onSelectSession(session)
      if (window.innerWidth < 768 && onCloseMobile) {
        onCloseMobile()
      }
    },
    [onSelectSession, onCloseMobile],
  )

  const handleRenameFolderSession = useCallback(
    async (session: ApiSession, newTitle: string) => {
      try {
        await updateSession(session.id, { title: newTitle }, session.directory)
        pinnedSessionsStore.update(session.id, { title: newTitle })
        if (!currentDirectory || isSameDirectory(currentDirectory, session.directory)) {
          await refresh()
        }
      } catch (e) {
        uiErrorHandler('rename session', e)
      }
    },
    [currentDirectory, refresh],
  )

  const handleDeleteFolderSession = useCallback(
    async (session: ApiSession) => {
      await apiDeleteSession(session.id, session.directory)
      // 清掉该会话的通知：否则项目行会因孤儿通知一直亮未读点
      notificationStore.removeSessionNotifications(session.id)
      pinnedSessionsStore.unpin(session.id)

      if (!currentDirectory || isSameDirectory(currentDirectory, session.directory)) {
        await refresh()
      }

      if (selectedSessionId === session.id) {
        onNewSession()
      }
    },
    [currentDirectory, onNewSession, refresh, selectedSessionId],
  )

  // ---- 批量删除 session ----
  const handleBatchDeleteSessions = useCallback(async () => {
    if (selectedSessionIds.size === 0) return
    setIsBatchDeleting(true)

    const needSwitchSession = selectedSessionId && selectedSessionIds.has(selectedSessionId)

    // 文件夹模式下可能跨目录，需要按 session 逐个调用
    // 普通模式下也用 sessionLookup 获取目录信息
    const ids = Array.from(selectedSessionIds)
    await Promise.allSettled(
      ids.map(async id => {
        try {
          const s = sessionLookup.get(id)
          if (s) {
            await apiDeleteSession(id, s.directory)
          } else {
            await apiDeleteSession(id, currentDirectory)
          }
          notificationStore.removeSessionNotifications(id)
          pinnedSessionsStore.unpin(id)
        } catch (e) {
          uiErrorHandler('batch delete session', e)
        }
      }),
    )

    await refresh()
    setSelectedSessionIds(new Set())
    sessionSelectionAnchorIdRef.current = null
    setBatchDeleteSessionConfirm(false)
    setIsBatchDeleting(false)

    if (needSwitchSession) {
      onNewSession()
    }
  }, [selectedSessionIds, selectedSessionId, sessionLookup, currentDirectory, refresh, onNewSession])

  // ---- 批量移除项目 ----
  const handleBatchRemoveProjects = useCallback(() => {
    if (selectedProjectIds.size === 0) return
    for (const projectId of selectedProjectIds) {
      getProjectDirectoriesToRemove(projectId).forEach(directory => removeDirectory(directory))
    }
    setSelectedProjectIds(new Set())
    projectSelectionAnchorIdRef.current = null
    setBatchRemoveProjectConfirm(false)
  }, [getProjectDirectoriesToRemove, selectedProjectIds, removeDirectory])

  // 单个项目移除：二次点击防误触（按钮层），这里直接执行。
  // 已保存项目 = 从列表移除（不删文件）；服务器发现项目 = 加入该主机隐藏列表（不再展示）
  const handleRemoveProjectClick = useCallback(
    (project: FolderRecentProject) => {
      if (project.isDerived) {
        const normalized = normalizeToForwardSlash(project.worktree || '')
        if (!normalized) return
        const next = new Set(hiddenDirectories)
        next.add(normalized)
        setHiddenDirectories(next)
        writeHiddenDirectories(activeServerId, Array.from(next))
        return
      }
      getProjectDirectoriesToRemove(project.id).forEach(directory => removeDirectory(directory))
    },
    [hiddenDirectories, activeServerId, getProjectDirectoriesToRemove, removeDirectory],
  )

  // 需求 4：在指定项目目录下新建会话 —— 先切目录上下文，再走全局新建
  const handleNewSessionInDirectory = useCallback(
    (directory: string) => {
      if (!isSameDirectory(currentDirectory, directory)) {
        setCurrentDirectory(directory)
      }
      onNewSession()
    },
    [currentDirectory, setCurrentDirectory, onNewSession],
  )

  const commonFolderRecentListProps = {
    currentDirectory,
    selectedSessionId,
    // 项目 tab 的数据源是活动服务器；状态汇总（busy/未读）必须用同一个 serverId 收窄，
    // 否则另一台服务器同名路径的会话状态会挂到本服务器项目行上
    serverId: activeServerId,
    // 搜索时强制展开所有项目：让各项目加载会话供就地筛选（否则折叠项目的会话未加载会被误隐藏）
    expandedProjectIds: search ? folderProjects.map(project => project.id) : expandedRecentProjectIds,
    onExpandedProjectIdsChange: setExpandedRecentProjectIds,
    onSelectProject: handleSelectFolderProject,
    onSelectSession: handleSelectActive,
    onRenameSession: handleRenameFolderSession,
    onDeleteSession: handleDeleteFolderSession,
    onNewSessionInDirectory: handleNewSessionInDirectory,
    onRemoveProject: handleRemoveProjectClick,
    expandedChildSessionIds,
    inlineChildSessions,
    onSelectChildSession: handleSelectActive,
    search,
    isEditMode,
    selectedSessionIds,
    selectedProjectIds,
    onToggleSessionSelection: toggleSessionSelection,
    onToggleProjectSelection: toggleProjectSelection,
    projectLastUsedAt,
  }

  // 统一的结构，通过 CSS 控制显示/隐藏
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ===== Header ===== */}
      {hideHeader ? null : (
        <div
          className={`shrink-0 flex items-center border-b border-border-200/60 px-2 gap-1 ${
            isMobile ? 'mobile-safe-topbar-14' : 'h-11'
          }`}
        >
          {/* 折叠按钮 - 最左侧，与下方各项目图标对齐（mx-2 + paddingLeft 6） */}
          {!isMobile && (
            <button
              onClick={onToggleSidebar}
              aria-label={isExpanded ? t('sidebar.collapseSidebar') : t('sidebar.expandSidebar')}
              className={cn(
                'h-8 w-8 flex items-center justify-center rounded-lg text-text-300 hover:text-text-100 shrink-0',
                interactive.row,
                'transition-all duration-200',
              )}
              style={{ paddingLeft: 6, paddingRight: 6 }}
            >
              <SidebarIcon size={16} />
            </button>
          )}

          {/* Logo 区域 - 折叠按钮右侧，占满剩余宽度，展开时显示 */}
          <div
            className="flex-1 overflow-hidden transition-[opacity] duration-300 ease-out min-w-0"
            style={{ opacity: showLabels ? 1 : 0 }}
          >
            <a href="/" className="flex items-center whitespace-nowrap h-full">
              <span className="text-[length:var(--fs-heading-3)] font-semibold text-text-100 tracking-tight">
                {t('header.openCode')}
              </span>
            </a>
          </div>
        </div>
      )}

      {/* ===== Navigation - 图标位置固定；间距与 Header 面板按钮对齐 ===== */}
      <div className={`flex flex-col gap-1 mx-2 ${hideHeader ? 'mt-2' : 'mt-1'}`}>
        {/* New Chat - 图标始终在 padding-left: 6px 位置，收起时刚好居中 */}
        <button
          type="button"
          onClick={onNewSession}
          aria-label={t('sidebar.newChat')}
          className={cn(
            'h-8 flex items-center rounded-lg text-text-300 group overflow-hidden',
            interactive.row,
            'transition-all duration-300',
          )}
          style={{
            width: showLabels ? '100%' : 32,
            paddingLeft: 6,
            paddingRight: 6,
          }}
          title={t('sidebar.newChat')}
        >
          <span className="size-5 flex items-center justify-center shrink-0">
            <NewChatIcon size={16} />
          </span>
          <span
            className="ml-2 text-[length:var(--fs-base)] whitespace-nowrap transition-opacity duration-300"
            style={{ opacity: showLabels ? 1 : 0 }}
          >
            {t('sidebar.newChat')}
          </span>
          <span
            className="ml-auto text-[length:var(--fs-xxs)] text-text-500 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
            style={{ opacity: showLabels ? undefined : 0 }}
          >
            {newChatShortcut}
          </span>
        </button>

        {/* 新建项目 - 收起时仅图标 */}
        <button
          type="button"
          onClick={onAddProject}
          aria-label={t('sidebar.newProject')}
          className={cn(
            'h-8 flex items-center rounded-lg text-text-300 group overflow-hidden',
            interactive.row,
            'transition-all duration-300',
          )}
          style={{
            width: showLabels ? '100%' : 32,
            paddingLeft: 6,
            paddingRight: 6,
          }}
          title={t('sidebar.newProject')}
        >
          <span className="size-5 flex items-center justify-center shrink-0">
            <PlusIcon size={16} />
          </span>
          <span
            className="ml-2 text-[length:var(--fs-base)] whitespace-nowrap transition-opacity duration-300"
            style={{ opacity: showLabels ? 1 : 0 }}
          >
            {t('sidebar.newProject')}
          </span>
        </button>

        {/* Search — 与上方导航同列 gap-0.5；收起时图标，展开时输入框 */}
        {showLabels ? (
          <div className="relative w-full mb-1.5">
            <span className="pointer-events-none absolute left-[6px] top-1/2 -translate-y-1/2 size-5 flex items-center justify-center text-text-300">
              <SearchIcon size={16} />
            </span>
            <input
              ref={searchInputRef}
              type="text"
              name="sidebar-chat-search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('sidebar.searchChats')}
              aria-label={t('sidebar.searchChats')}
              autoComplete="off"
              spellCheck={false}
              className="h-8 w-full appearance-none rounded-lg border-0 bg-transparent pl-[34px] pr-[26px] text-[length:var(--fs-base)] text-text-100 shadow-none outline-none ring-0 placeholder:text-text-300 transition-shadow focus-visible:ring-1 focus-visible:ring-accent-main-100/30"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-[6px] top-1/2 flex size-[14px] -translate-y-1/2 items-center justify-center text-text-400 hover:text-text-100"
                aria-label={t('sidebar.clearSearch')}
              >
                <CloseIcon size={14} />
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              pendingFocusSearchRef.current = true
              onToggleSidebar()
            }}
            aria-label={t('sidebar.searchChats')}
            className={cn(
              'h-8 mb-1.5 flex items-center rounded-lg text-text-300 hover:text-text-100 overflow-hidden',
              interactive.row,
              'transition-all duration-300',
            )}
            style={{ width: 32, paddingLeft: 6, paddingRight: 6 }}
            title={t('sidebar.searchChats')}
          >
            <span className="size-5 flex items-center justify-center shrink-0">
              <SearchIcon size={16} />
            </span>
          </button>
        )}
      </div>

      {/* ===== Main Content ===== */}
      <div
        className="flex-1 flex flex-col min-h-0 overflow-hidden transition-opacity duration-300 ease-out"
        style={{
          opacity: showLabels ? 1 : 0,
          visibility: showLabels ? 'visible' : 'hidden',
        }}
      >
        {/* Tab Bar: Recents / Active */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* 固定行高：普通态是 TabsList（slider/sm：p-1 + 文字 + 边框，约 36px），
              管理态是提示文字 + 操作按钮。两态的 padding 天然凑不齐，不固定高度的话
              点「管理」整行会缩 ~6px，下方列表跟着上跳。这里钉死高度，
              两个分支的 py 只用来做垂直居中微调。 */}
          <div className="flex items-center mx-2 gap-1 shrink-0 h-9">
            {isEditMode ? (
              <>
                {/* 与 tab 同字号字重，左侧文案变成状态提示 */}
                <span className="pl-[6px] pr-2 py-1.5 text-[length:var(--fs-xxs)] font-semibold uppercase tracking-wider text-text-100 min-w-0 truncate">
                  {selectedSessionIds.size === 0 && selectedProjectIds.size === 0
                    ? t('sidebar.selectItems')
                    : selectedSessionIds.size > 0 && selectedProjectIds.size > 0
                      ? t('sidebar.selectedMixed', {
                          sessions: selectedSessionIds.size,
                          projects: selectedProjectIds.size,
                        })
                      : selectedSessionIds.size > 0
                        ? t('sidebar.selectedSessions', { count: selectedSessionIds.size })
                        : t('sidebar.selectedProjects', { count: selectedProjectIds.size })}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  {selectedSessionIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setBatchDeleteSessionConfirm(true)}
                      className={cn('p-1.5 rounded-md text-text-500 hover:text-danger-100', interactive.danger)}
                      title={t('sidebar.deleteSessionsWithCount', { count: selectedSessionIds.size })}
                      aria-label={t('sidebar.deleteSessionsWithCount', { count: selectedSessionIds.size })}
                    >
                      <TrashIcon size={14} />
                    </button>
                  )}
                  {selectedProjectIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setBatchRemoveProjectConfirm(true)}
                      className={cn(
                        'p-1.5 rounded-md text-text-500 hover:text-warning-100',
                        interactive.warning,
                        interactive.focusRingCompact,
                      )}
                      title={t('sidebar.removeProjectsWithCount', { count: selectedProjectIds.size })}
                      aria-label={t('sidebar.removeProjectsWithCount', { count: selectedProjectIds.size })}
                    >
                      <FolderMinusIcon size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={exitEditMode}
                    aria-label={t('sidebar.doneManaging')}
                    aria-pressed
                    className={cn('p-1.5 rounded-md text-text-500 hover:text-text-100', interactive.subtle)}
                    title={t('sidebar.doneManaging')}
                  >
                    <CheckIcon size={14} />
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* 视图切换：主机/项目 — 与「变更」面板的列表/树形切换同一视觉语言 */}
                <Tabs
                  variant="slider"
                  value={sidebarTab}
                  onValueChange={value => {
                    setSidebarTab(value as 'hosts' | 'projects')
                    if (value !== sidebarTab) exitEditMode()
                  }}
                >
                  <TabsList activeIndex={sidebarTab === 'hosts' ? 0 : 1} itemCount={2} className="shrink-0">
                    <TabsTrigger value="hosts" title={t('sidebar.hostsHint', { defaultValue: 'Switch between hosts' })}>
                      <GlobeIcon size={13} />
                      <span className="truncate">{t('sidebar.hosts', { defaultValue: 'Hosts' })}</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="projects"
                      title={t('sidebar.projectByFolder', { defaultValue: 'Group by project' })}
                    >
                      <FolderIcon size={13} />
                      <span className="truncate">{t('sidebar.project', { defaultValue: 'Project' })}</span>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                {/* 排序 + 管理：仅项目视图。两个按钮独立（排序改偏好，管理进批量选择） */}
                {sidebarTab === 'projects' && (
                  <div className="ml-auto shrink-0 flex items-center gap-0.5">
                    <SessionSortMenu />
                    <IconButton
                      size="sm"
                      onMouseDown={e => e.preventDefault()}
                      onClick={enterEditMode}
                      aria-label={t('sidebar.manageSessions')}
                      title={t('sidebar.manageSessions')}
                    >
                      <ManageSessionsIcon size={14} />
                    </IconButton>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 主机 tab：切换后端 */}
          {sidebarTab === 'hosts' ? (
            <div ref={recentsSelectionRootRef} className="flex-1 overflow-hidden">
              <HostList onActivate={() => setSidebarTab('projects')} onOpenSettings={onOpenSettings} />
            </div>
          ) : (
            /* 项目 tab：已保存项目文件夹树（统一按目录查询） */
            <div ref={recentsSelectionRootRef} className={`flex-1 overflow-hidden ${isEditMode ? 'select-none' : ''}`}>
              {search ? (
                /* 搜索：文件夹 + session 就地筛选 */
                <FolderRecentList
                  projects={sortedFolderProjects}
                  {...commonFolderRecentListProps}
                  onReorderProject={handleReorderProjectGroup}
                  workspaceDirectoriesByProjectId={workspaceDirectoriesByProjectId}
                  pinnedSessions={resolvedPinnedSessions}
                  unavailablePinnedEntries={unavailablePinnedEntries}
                />
              ) : isDiscoveringServerData || (shouldWaitForWorkspaceResolution && folderProjects.length === 0) ? (
                /* 首次加载/无任何项目可展示时才整列表转圈；已有项目时保持列表，
                   当前项目的工作区解析用文件夹内的局部 spinner 过渡，避免打开会话导致侧栏整体重载 */
                <div className="flex h-full items-center justify-center text-accent-main-100">
                  <Spinner size="sm" tone="accent" variant="pixel" />
                </div>
              ) : (
                <FolderRecentList
                  projects={sortedFolderProjects}
                  {...commonFolderRecentListProps}
                  onReorderProject={handleReorderProjectGroup}
                  workspaceDirectoriesByProjectId={workspaceDirectoriesByProjectId}
                  pinnedSessions={resolvedPinnedSessions}
                  unavailablePinnedEntries={unavailablePinnedEntries}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Spacer for collapsed */}
      {!showLabels && <div className="flex-1" />}

      {/* ===== 主机快速切换条（对话区底部，仅展开显示） ===== */}
      {showLabels && <HostQuickSwitcher />}

      {/* ===== Footer ===== */}
      <SidebarFooter
        showLabels={showLabels}
        connectionState={connectionState?.state || 'disconnected'}
        contextLimit={contextLimit}
        onOpenSettings={onOpenSettings}
      />

      {/* 批量删除会话确认弹窗 */}
      <ConfirmDialog
        isOpen={batchDeleteSessionConfirm}
        onClose={() => setBatchDeleteSessionConfirm(false)}
        onConfirm={handleBatchDeleteSessions}
        title={t('sidebar.batchDeleteSessions', { count: selectedSessionIds.size })}
        description={
          <>
            {t('sidebar.batchDeleteSessionsConfirm', { count: selectedSessionIds.size })}
            {selectedSessionId && selectedSessionIds.has(selectedSessionId) && (
              <div className="mt-2 text-[length:var(--fs-sm)] text-warning-100">
                {t('sidebar.batchDeleteIncludesCurrent')}
              </div>
            )}
          </>
        }
        confirmText={t('common:delete')}
        variant="danger"
        isLoading={isBatchDeleting}
      />

      {/* 批量移除项目确认弹窗 */}
      <ConfirmDialog
        isOpen={batchRemoveProjectConfirm}
        onClose={() => setBatchRemoveProjectConfirm(false)}
        onConfirm={handleBatchRemoveProjects}
        title={t('sidebar.batchRemoveProjects', { count: selectedProjectIds.size })}
        description={t('sidebar.batchRemoveProjectsConfirm', { count: selectedProjectIds.size })}
        confirmText={t('common:remove')}
        variant="warning"
      />
    </div>
  )
}
