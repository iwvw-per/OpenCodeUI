import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { updateSession, type ApiSession } from '../../../api'
import {
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GlobeIcon,
  PinIcon,
  SpinnerIcon,
  ChevronDownIcon,
  PlusIcon,
  TrashIcon,
  CheckIcon,
} from '../../../components/Icons'
import { ExpandableSection } from '../../../components/ui'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { useDelayedRender, useSessions, useVcsInfo } from '../../../hooks'
import { useInputCapabilities } from '../../../hooks/useInputCapabilities'
import { useInView } from '../../../hooks/useInView'
import { useDirectory } from '../../../contexts/useDirectory'
import { getDirectoryName, isSameDirectory, normalizeToForwardSlash } from '../../../utils'
import { formatRelativeDay } from '../../../utils/dateUtils'
import { useLayoutStore } from '../../../store'
import { useBusySessions } from '../../../store/activeSessionStore'
import { splitSessionKey } from '../../../utils/sessionKey'
import { useNotifications } from '../../../store/notificationStore'
import { pinnedSessionsStore, type PinnedSessionEntry } from '../../../store/pinnedSessionsStore'
import { SessionListItem } from '../../sessions'
import { getSelectionRoundClass } from '../../sessions/selectionRound'
import { SessionChildrenSlot } from './SessionChildrenSlot'
import { cn } from '../../../utils/cn'
import { interactive } from '../../../utils/interaction'

const DIRECTORY_PAGE_SIZE = 5

/** 长项目名：溢出时右侧渐隐（替代生硬的 ellipsis 截断），不 hover 也生效 */
function ProjectNameTitle({ text, className = '' }: { text: string; className?: string }) {
  const spanRef = useRef<HTMLSpanElement>(null)
  const [overflows, setOverflows] = useState(false)

  useEffect(() => {
    const el = spanRef.current
    if (!el) return
    const measure = () => setOverflows(el.scrollWidth > el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text])

  return (
    <span
      ref={spanRef}
      className={`min-w-0 flex-1 whitespace-nowrap text-[length:var(--fs-sm)] font-semibold ${
        overflows ? 'name-fade-right overflow-hidden' : 'truncate'
      } ${className}`}
    >
      {text}
    </span>
  )
}

export interface FolderRecentProject {
  id: string
  name: string
  worktree: string
  canReorder?: boolean
  memberDirectories?: string[]
  sectionKind?: 'project' | 'workspace'
  /** 推导项目（无已保存工作区时自动生成）：隐藏移除按钮，避免对未存储目录执行无效移除 */
  isDerived?: boolean
}

interface FolderRecentListProps {
  projects: FolderRecentProject[]
  /** 数据服务器（多服务器模式；缺省用活动服务器） */
  serverId?: string
  /** 嵌套模式（多服务器服务器节点下）：外层负责滚动，本组件不设滚动容器/内边距 */
  embedded?: boolean
  currentDirectory?: string
  selectedSessionId: string | null
  expandedProjectIds: string[]
  onExpandedProjectIdsChange: React.Dispatch<React.SetStateAction<string[]>>
  onSelectProject: (project: FolderRecentProject) => void
  onSelectSession: (session: ApiSession) => void
  onRenameSession: (session: ApiSession, newTitle: string) => Promise<void>
  onDeleteSession: (session: ApiSession) => Promise<void>
  onReorderProject: (draggedPath: string, targetPath: string) => void
  /** 项目行 hover 的 + 按钮：在该项目目录下新建会话（无目录的项目（全局）不显示） */
  onNewSessionInDirectory?: (directory: string) => void
  /** 移除项目（从侧栏列表移除，不删文件） */
  onRemoveProject?: (project: FolderRecentProject) => void
  /** worktree → 最后使用时间戳（服务端会话数据 + 本地记录合并）；缺省退回 useDirectory 的 recentProjects */
  projectLastUsedAt?: Record<string, number>
  expandedChildSessionIds?: Set<string>
  inlineChildSessions?: Map<string, ApiSession[]>
  onSelectChildSession?: (session: ApiSession) => void
  workspaceDirectoriesByProjectId?: Map<string, string[]>
  pinnedSessions?: ApiSession[]
  unavailablePinnedEntries?: PinnedSessionEntry[]
  /** 就地筛选：匹配项目名或会话标题/目录；无匹配的项目隐藏 */
  search?: string
  // ---- 编辑模式 ----
  isEditMode?: boolean
  selectedSessionIds?: Set<string>
  selectedProjectIds?: Set<string>
  onToggleSessionSelection?: (sessionId: string, options?: { shiftKey?: boolean }) => void
  onToggleProjectSelection?: (projectId: string, options?: { shiftKey?: boolean }) => void
}

interface PendingDeleteSession {
  session: ApiSession
  removeLocal: () => void
}

interface FolderStatus {
  dot: string
  label: string
  pulse: boolean
  count?: number
}

function matchesAnyDirectory(directory: string | undefined, candidates: string[]) {
  if (!directory) return false
  return candidates.some(candidate => isSameDirectory(candidate, directory))
}

function buildFolderStatus(
  directories: string[],
  busySessions: ReturnType<typeof useBusySessions>,
  notifications: ReturnType<typeof useNotifications>,
  t: ReturnType<typeof useTranslation>['t'],
): FolderStatus | null {
  const dirSessions = busySessions.filter(entry => matchesAnyDirectory(entry.directory, directories))

  if (dirSessions.length > 0) {
    let hasPermission = false
    let hasQuestion = false
    let hasRetry = false

    for (const session of dirSessions) {
      if (session.pendingAction?.type === 'permission') hasPermission = true
      else if (session.pendingAction?.type === 'question') hasQuestion = true
      else if (session.status.type === 'retry') hasRetry = true
    }

    const count = dirSessions.length
    if (hasPermission) {
      return {
        dot: 'bg-warning-100',
        label: t('chat:activeSession.awaitingPermission'),
        pulse: false,
        count,
      }
    }
    if (hasQuestion) {
      return {
        dot: 'bg-info-100',
        label: t('chat:activeSession.awaitingAnswer'),
        pulse: false,
        count,
      }
    }
    if (hasRetry) {
      return {
        dot: 'bg-warning-100',
        label: t('chat:activeSession.retrying'),
        pulse: false,
        count,
      }
    }

    return {
      dot: 'bg-success-100',
      label: t('chat:activeSession.working'),
      pulse: true,
      count,
    }
  }

  const hasUnreadCompleted = notifications.some(
    notification =>
      notification.type === 'completed' &&
      !notification.read &&
      matchesAnyDirectory(notification.directory, directories),
  )

  if (hasUnreadCompleted) {
    return {
      dot: 'bg-accent-main-100',
      label: t('chat:notification.completed'),
      pulse: false,
    }
  }

  return null
}

function getInitialExpandedProjectIds(projects: FolderRecentProject[], currentDirectory?: string): string[] {
  if (projects.length === 0) return []

  const currentProject = currentDirectory
    ? projects.find(project => isSameDirectory(project.worktree, currentDirectory))
    : projects.find(project => project.id === 'global')

  return [currentProject?.id || projects[0].id]
}

function areProjectIdListsEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function getCurrentProjectId(projects: FolderRecentProject[], currentDirectory?: string) {
  if (!currentDirectory) {
    const globalProject = projects.find(project => project.id === 'global')
    return globalProject?.id
  }
  return projects.find(project => isSameDirectory(project.worktree, currentDirectory))?.id
}

function reconcileExpandedProjectIds(prev: string[], projects: FolderRecentProject[], currentDirectory?: string) {
  const next = prev.filter(id => projects.some(project => project.id === id))
  const fallback = next.length > 0 ? next : getInitialExpandedProjectIds(projects, currentDirectory)
  return areProjectIdListsEqual(fallback, prev) ? prev : fallback
}

function expandProjectId(prev: string[], projectId?: string) {
  if (!projectId || prev.includes(projectId)) return prev
  return [projectId, ...prev]
}

function toggleProjectId(prev: string[], projectId: string) {
  return prev.includes(projectId) ? prev.filter(id => id !== projectId) : [...prev, projectId]
}

function createDirectoryProject(directory: string, sectionKind: FolderRecentProject['sectionKind'] = 'project') {
  return {
    id: directory,
    worktree: directory,
    name: getDirectoryName(directory) || directory,
    sectionKind,
  } satisfies FolderRecentProject
}

function useCollapseExpandedIdsOnDrag(
  expandedIds: string[],
  setExpandedIds: React.Dispatch<React.SetStateAction<string[]>>,
) {
  const savedExpandedRef = useRef<string[] | null>(null)

  const handleDragActivated = useCallback(() => {
    savedExpandedRef.current = expandedIds
    setExpandedIds([])
  }, [expandedIds, setExpandedIds])

  const handleDragFinished = useCallback(() => {
    if (!savedExpandedRef.current) return
    setExpandedIds(savedExpandedRef.current)
    savedExpandedRef.current = null
  }, [setExpandedIds])

  return { handleDragActivated, handleDragFinished }
}

interface ReorderState {
  draggedId: string
  currentOrder: string[]
}

interface UseReorderableListOptions {
  ids: string[]
  canDrag: (id: string) => boolean
  onCommit: (draggedId: string, targetId: string) => void
  onDragActivated?: () => void
  onDragFinished?: () => void
}

function useReorderableList({ ids, canDrag, onCommit, onDragActivated, onDragFinished }: UseReorderableListOptions) {
  const refs = useRef<Map<string, HTMLDivElement>>(new Map())
  const registerRef = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) refs.current.set(id, element)
    else refs.current.delete(id)
  }, [])
  const [dragState, setDragState] = useState<ReorderState | null>(null)
  const dragStartY = useRef(0)
  const dragActive = useRef(false)
  const latestOrderRef = useRef<string[]>([])
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchMovedRef = useRef(false)
  const touchStartYRef = useRef(0)
  const touchDragIdRef = useRef<string | null>(null)

  const displayOrder = dragState?.currentOrder ?? ids
  const draggedId = dragState?.draggedId ?? null

  const calcNewOrder = useCallback((dragId: string, pointerY: number, baseOrder: string[]) => {
    const items: { id: string; centerY: number }[] = []

    for (const id of baseOrder) {
      if (id === dragId) continue
      const element = refs.current.get(id)
      if (!element) continue
      const rect = element.getBoundingClientRect()
      items.push({ id, centerY: rect.top + rect.height / 2 })
    }

    let insertIndex = items.length
    for (let i = 0; i < items.length; i++) {
      if (pointerY < items[i].centerY) {
        insertIndex = i
        break
      }
    }

    const withoutDragged = items.map(item => item.id)
    withoutDragged.splice(insertIndex, 0, dragId)
    return withoutDragged
  }, [])

  const finishDrag = useCallback(
    (draggedId: string, originalOrder: string[]) => {
      const finalOrder = latestOrderRef.current
      const originalIdx = originalOrder.indexOf(draggedId)
      const newIdx = finalOrder.indexOf(draggedId)

      if (originalIdx !== -1 && newIdx !== -1 && originalIdx !== newIdx) {
        const targetId = originalOrder[newIdx]
        if (targetId) onCommit(draggedId, targetId)
      }

      setDragState(null)
      dragActive.current = false
      latestOrderRef.current = []
      onDragFinished?.()
    },
    [onCommit, onDragFinished],
  )

  const handlePointerStart = useCallback(
    (id: string, event: React.PointerEvent) => {
      if (!canDrag(id)) return

      event.preventDefault()
      event.stopPropagation()
      dragStartY.current = event.clientY
      dragActive.current = false

      const currentOrder = [...ids]

      const onMove = (moveEvent: PointerEvent) => {
        const dy = Math.abs(moveEvent.clientY - dragStartY.current)

        if (!dragActive.current) {
          if (dy < 4) return
          dragActive.current = true
          onDragActivated?.()
          document.body.style.cursor = 'grabbing'
          document.body.style.userSelect = 'none'
          setDragState({ draggedId: id, currentOrder })
        }

        const newOrder = calcNewOrder(id, moveEvent.clientY, currentOrder)
        latestOrderRef.current = newOrder
        setDragState(prev => (prev ? { ...prev, currentOrder: newOrder } : null))
      }

      const onUp = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        document.removeEventListener('pointercancel', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''

        if (dragActive.current) finishDrag(id, currentOrder)

        dragActive.current = false
      }

      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
      document.addEventListener('pointercancel', onUp)
    },
    [calcNewOrder, canDrag, finishDrag, ids, onDragActivated],
  )

  const handleTouchStart = useCallback(
    (id: string, event: React.TouchEvent) => {
      if (!canDrag(id)) return

      touchMovedRef.current = false
      touchStartYRef.current = event.touches[0].clientY
      touchDragIdRef.current = null

      longPressTimer.current = setTimeout(() => {
        if (!touchMovedRef.current) {
          touchDragIdRef.current = id
          dragActive.current = true
          onDragActivated?.()
          const currentOrder = [...ids]
          latestOrderRef.current = currentOrder
          setDragState({ draggedId: id, currentOrder })
        }
      }, 400)
    },
    [canDrag, ids, onDragActivated],
  )

  const handleTouchMove = useCallback(
    (event: React.TouchEvent) => {
      const dy = Math.abs(event.touches[0].clientY - touchStartYRef.current)
      if (dy > 8) touchMovedRef.current = true

      if (longPressTimer.current && touchMovedRef.current && !touchDragIdRef.current) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }

      if (!touchDragIdRef.current) return

      event.stopPropagation()
      const touchY = event.touches[0].clientY
      const currentOrder = [...ids]
      const newOrder = calcNewOrder(touchDragIdRef.current, touchY, currentOrder)
      latestOrderRef.current = newOrder
      setDragState(prev => (prev ? { ...prev, currentOrder: newOrder } : null))
    },
    [calcNewOrder, ids],
  )

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }

    const dragId = touchDragIdRef.current
    if (dragId) {
      finishDrag(dragId, [...ids])
    }

    touchDragIdRef.current = null
  }, [finishDrag, ids])

  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current)
    }
  }, [])

  return {
    draggedId,
    isDragging: !!dragState,
    displayOrder,
    handlePointerStart,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    registerRef,
  }
}

export function FolderRecentList({
  projects,
  serverId,
  embedded = false,
  currentDirectory,
  selectedSessionId,
  expandedProjectIds,
  onExpandedProjectIdsChange,
  onSelectProject,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onReorderProject,
  onNewSessionInDirectory,
  onRemoveProject,
  projectLastUsedAt,
  expandedChildSessionIds,
  inlineChildSessions,
  onSelectChildSession,
  workspaceDirectoriesByProjectId,
  pinnedSessions = [],
  unavailablePinnedEntries = [],
  isEditMode = false,
  selectedSessionIds,
  selectedProjectIds,
  onToggleSessionSelection,
  onToggleProjectSelection,
  search = '',
}: FolderRecentListProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { preferTouchUi } = useInputCapabilities()
  const { sidebarFolderRecentsShowDiff } = useLayoutStore()
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteSession | null>(null)
  const allBusySessions = useBusySessions()
  const allNotifications = useNotifications()
  const projectById = useMemo(() => new Map(projects.map(project => [project.id, project])), [projects])
  const { handleDragActivated, handleDragFinished } = useCollapseExpandedIdsOnDrag(
    expandedProjectIds,
    onExpandedProjectIdsChange,
  )

  // 当 projects 列表变化时，过滤掉已不存在的展开项 + 确保当前目录对应的 project 展开
  useEffect(() => {
    onExpandedProjectIdsChange(prev => {
      const reconciled = reconcileExpandedProjectIds(prev, projects, currentDirectory)
      return expandProjectId(reconciled, getCurrentProjectId(projects, currentDirectory))
    })
  }, [projects, currentDirectory, onExpandedProjectIdsChange])

  const handleToggleProject = useCallback(
    (projectId: string) => onExpandedProjectIdsChange(prev => toggleProjectId(prev, projectId)),
    [onExpandedProjectIdsChange],
  )

  const {
    draggedId,
    isDragging,
    displayOrder,
    handlePointerStart,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    registerRef,
  } = useReorderableList({
    ids: projects.map(project => project.id),
    canDrag: id => !!projectById.get(id)?.canReorder && !isEditMode,
    onCommit: (draggedId, targetId) => {
      const draggedProject = projectById.get(draggedId)
      const targetProject = projectById.get(targetId)
      if (!draggedProject?.canReorder || !targetProject?.canReorder) return
      onReorderProject(draggedProject.id, targetProject.id)
    },
    onDragActivated: handleDragActivated,
    onDragFinished: handleDragFinished,
  })

  const handleSelectDirectory = useCallback(
    (directory: string, sectionKind: FolderRecentProject['sectionKind'] = 'project') => {
      onSelectProject(createDirectoryProject(directory, sectionKind))
    },
    [onSelectProject],
  )

  const folderStatusByProjectId = useMemo(() => {
    const map = new Map<string, FolderStatus>()

    for (const project of projects) {
      const isProjectExpanded = !isDragging && expandedProjectIds.includes(project.id)
      if (isProjectExpanded) continue

      const statusDirectories = workspaceDirectoriesByProjectId?.get(project.id) ?? [project.worktree]
      const status = buildFolderStatus(statusDirectories, allBusySessions, allNotifications, t)
      if (status) map.set(project.id, status)
    }

    return map
  }, [projects, expandedProjectIds, isDragging, allBusySessions, allNotifications, t, workspaceDirectoriesByProjectId])

  const folderStatusByWorkspaceDirectory = useMemo(() => {
    const map = new Map<string, FolderStatus>()
    const workspaceDirectories = new Set<string>()

    workspaceDirectoriesByProjectId?.forEach(directories => {
      directories.forEach(directory => workspaceDirectories.add(directory))
    })

    for (const directory of workspaceDirectories) {
      const status = buildFolderStatus([directory], allBusySessions, allNotifications, t)
      if (status) map.set(directory, status)
    }

    return map
  }, [allBusySessions, allNotifications, t, workspaceDirectoriesByProjectId])

  return (
    <>
      <div
        className={`custom-scrollbar select-none ${embedded ? '' : 'h-full overflow-y-auto px-1.5 py-1'}`}
      >
        {projects.length === 0 && pinnedSessions.length === 0 && unavailablePinnedEntries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center text-text-400 opacity-70">
            <p className="text-[length:var(--fs-sm)] font-medium text-text-300">{t('sidebar.noProjectFoldersYet')}</p>
            <p className="mt-1 text-[length:var(--fs-xs)] text-text-400/70">{t('sidebar.addProjectDesc')}</p>
          </div>
        ) : (
          <div onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
            {(pinnedSessions.length > 0 || unavailablePinnedEntries.length > 0) && (
              <PinnedFolderSection
                sessions={pinnedSessions}
                unavailableEntries={unavailablePinnedEntries}
                selectedSessionId={selectedSessionId}
                preferTouchUi={preferTouchUi}
                showSessionDiffStats={sidebarFolderRecentsShowDiff}
                onSelectSession={onSelectSession}
                onRenameSession={onRenameSession}
                onRequestDeleteSession={setPendingDelete}
                expandedChildSessionIds={expandedChildSessionIds}
                inlineChildSessions={inlineChildSessions}
                onSelectChildSession={onSelectChildSession}
                isEditMode={isEditMode}
                selectedSessionIds={selectedSessionIds}
                onToggleSessionSelection={onToggleSessionSelection}
              />
            )}
            {displayOrder.map((projectId, index) => {
              const project = projectById.get(projectId)
              if (!project) return null
              const isExpanded = !isDragging && expandedProjectIds.includes(project.id)
              const isProjectChecked = selectedProjectIds?.has(project.id) ?? false
              const prevId = index > 0 ? displayOrder[index - 1] : null
              const nextId = index < displayOrder.length - 1 ? displayOrder[index + 1] : null
              const nextProjectChecked = !!nextId && (selectedProjectIds?.has(nextId) ?? false)
              // 折叠时：和相邻文件夹拼接；展开时：和首条 session 的拼接在 section 内部处理
              const prevExpanded =
                !!prevId && !isDragging && expandedProjectIds.includes(prevId)
              const projectCheckedPrev =
                isEditMode &&
                isProjectChecked &&
                !!prevId &&
                !prevExpanded &&
                (selectedProjectIds?.has(prevId) ?? false)
              const projectCheckedNext =
                isEditMode &&
                isProjectChecked &&
                !!nextId &&
                !isExpanded &&
                nextProjectChecked
              return (
                <FolderRecentSection
                  key={project.id}
                  project={project}
                  serverId={serverId}
                  isExpanded={isExpanded}
                  search={search}
                  folderStatus={folderStatusByProjectId.get(project.id) ?? null}
                  preferTouchUi={preferTouchUi}
                  showSessionDiffStats={sidebarFolderRecentsShowDiff}
                  currentDirectory={currentDirectory}
                  selectedSessionId={selectedSessionId}
                  onSelectProject={() => handleSelectDirectory(project.worktree, project.sectionKind)}
                  onSelectDirectory={handleSelectDirectory}
                  onNewSessionInDirectory={onNewSessionInDirectory}
                  onRemoveProject={onRemoveProject}
                  projectLastUsedAt={projectLastUsedAt}
                  onToggle={() => handleToggleProject(project.id)}
                  onSelectSession={onSelectSession}
                  onRenameSession={onRenameSession}
                  onRequestDeleteSession={setPendingDelete}
                  expandedChildSessionIds={expandedChildSessionIds}
                  inlineChildSessions={inlineChildSessions}
                  onSelectChildSession={onSelectChildSession}
                  workspaceDirectories={workspaceDirectoriesByProjectId?.get(project.id)}
                  workspaceFolderStatusByDirectory={folderStatusByWorkspaceDirectory}
                  draggableWorkspaceDirectories={project.memberDirectories}
                  onReorderWorkspace={onReorderProject}
                  sectionKind={project.sectionKind ?? 'project'}
                  // 拖拽
                  canDrag={!!project.canReorder && !isEditMode}
                  isDragged={draggedId === project.id}
                  onDragStart={e => handlePointerStart(project.id, e)}
                  onTouchDragStart={e => handleTouchStart(project.id, e)}
                  registerRef={el => registerRef(project.id, el)}
                  // 编辑模式
                  isEditMode={isEditMode}
                  isProjectChecked={isProjectChecked}
                  projectCheckedPrev={projectCheckedPrev}
                  projectCheckedNext={projectCheckedNext}
                  nextProjectChecked={isEditMode && nextProjectChecked}
                  onToggleProjectCheck={
                    onToggleProjectSelection ? options => onToggleProjectSelection(project.id, options) : undefined
                  }
                  selectedSessionIds={selectedSessionIds}
                  onToggleSessionSelection={onToggleSessionSelection}
                />
              )
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (pendingDelete) {
            await onDeleteSession(pendingDelete.session)
            pendingDelete.removeLocal()
          }
          setPendingDelete(null)
        }}
        title={t('sidebar.deleteChat')}
        description={t('sidebar.deleteChatConfirm')}
        confirmText={t('common:delete')}
        variant="danger"
      />
    </>
  )
}

// ============================================
// Folder Section
// ============================================

interface PinnedFolderSectionProps {
  sessions: ApiSession[]
  unavailableEntries: PinnedSessionEntry[]
  selectedSessionId: string | null
  preferTouchUi: boolean
  showSessionDiffStats: boolean
  onSelectSession: (session: ApiSession) => void
  onRenameSession: (session: ApiSession, newTitle: string) => Promise<void>
  onRequestDeleteSession: (pending: PendingDeleteSession) => void
  expandedChildSessionIds?: Set<string>
  inlineChildSessions?: Map<string, ApiSession[]>
  onSelectChildSession?: (session: ApiSession) => void
  isEditMode?: boolean
  selectedSessionIds?: Set<string>
  onToggleSessionSelection?: (sessionId: string, options?: { shiftKey?: boolean }) => void
}

function PinnedFolderSection({
  sessions,
  unavailableEntries,
  selectedSessionId,
  preferTouchUi,
  showSessionDiffStats,
  onSelectSession,
  onRenameSession,
  onRequestDeleteSession,
  expandedChildSessionIds,
  inlineChildSessions,
  onSelectChildSession,
  isEditMode,
  selectedSessionIds,
  onToggleSessionSelection,
}: PinnedFolderSectionProps) {
  const { t } = useTranslation(['commands', 'chat'])
  const [isExpanded, setIsExpanded] = useState(true)

  return (
    <div className="relative transition-all duration-150 group/folder">
      <div className={cn('relative flex w-full items-center rounded-md select-none', interactive.row)}>
        <button
          onClick={() => setIsExpanded(value => !value)}
          className="flex flex-1 min-w-0 items-center gap-2 pl-2 pr-2 py-1.5 text-left cursor-default select-none"
          title={t('sessions.pinned')}
        >
          <span className="size-5 shrink-0 flex items-center justify-center">
            <PinIcon size={15} className="text-accent-main-100" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] font-medium text-text-300">
            {t('sessions.pinned')}
          </span>
        </button>
      </div>

      <ExpandableSection show={isExpanded}>
        <div onTouchStart={e => e.stopPropagation()}>
          {sessions.map((session, index) => {
            const isChecked = selectedSessionIds?.has(session.id) ?? false
            const prevChecked =
              isEditMode && index > 0 && (selectedSessionIds?.has(sessions[index - 1].id) ?? false)
            const nextChecked =
              isEditMode &&
              index < sessions.length - 1 &&
              (selectedSessionIds?.has(sessions[index + 1].id) ?? false)
            return (
            <div key={session.id}>
              <SessionListItem
                session={session}
                isSelected={!!selectedSessionId && session.id === splitSessionKey(selectedSessionId).sessionId}
                onSelect={() => onSelectSession(session)}
                onRename={newTitle => onRenameSession(session, newTitle)}
                onDelete={() => onRequestDeleteSession({ session, removeLocal: () => {} })}
                preferTouchUi={preferTouchUi}
                density="minimal"
                showStats={showSessionDiffStats}
                showDirectory={false}
                isEditMode={isEditMode}
                isChecked={isChecked}
                checkedPrev={prevChecked}
                checkedNext={nextChecked}
                onToggleCheck={
                  onToggleSessionSelection ? options => onToggleSessionSelection(session.id, options) : undefined
                }
              />
              {onSelectChildSession &&
                (expandedChildSessionIds?.has(session.id) || inlineChildSessions?.has(session.id)) && (
                  <SessionChildrenSlot
                    parentSession={session}
                    selectedSessionId={selectedSessionId}
                    fetchAll={expandedChildSessionIds?.has(session.id)}
                    children={inlineChildSessions?.get(session.id)}
                    onSelect={onSelectChildSession}
                    isEditMode={isEditMode}
                    selectedSessionIds={selectedSessionIds}
                    onToggleSessionSelection={onToggleSessionSelection}
                  />
                )}
            </div>
            )
          })}
          {unavailableEntries.map(entry => (
            <UnavailablePinnedSessionItem key={entry.sessionId} entry={entry} />
          ))}
        </div>
      </ExpandableSection>
    </div>
  )
}

function UnavailablePinnedSessionItem({ entry }: { entry: PinnedSessionEntry }) {
  const { t } = useTranslation(['commands'])
  const title = entry.title || entry.sessionId.slice(0, 12) + '...'
  // 对齐 minimal SessionListItem：单行布局，只把文字改灰
  return (
    <div className="group relative flex items-center gap-2 px-2 py-1.5 select-none text-text-500">
      <span className="relative shrink-0 flex items-center justify-center size-5" />
      <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-0 group-hover:pr-8 transition-[padding] duration-200">
        <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] text-text-500" title={title}>
          {title}
        </span>
        <span className="shrink-0 text-[length:var(--fs-xxs)] text-text-500 group-hover:hidden">
          {t('sessions.unavailable')}
        </span>
      </div>
      <button
        type="button"
        onClick={() => pinnedSessionsStore.unpin(entry.sessionId)}
        className={cn(
          'absolute right-2 z-10 p-1 rounded text-accent-main-100 hover:text-accent-main-200',
          'opacity-0 group-hover:opacity-100 transition-opacity',
          interactive.subtle,
        )}
        title={t('sessions.unpin')}
        aria-label={t('sessions.unpin')}
      >
        <PinIcon className="w-3 h-3" />
      </button>
    </div>
  )
}

interface FolderRecentSectionProps {
  project: FolderRecentProject
  /** 数据服务器（多服务器模式；缺省用活动服务器） */
  serverId?: string
  isExpanded: boolean
  /** 就地筛选：匹配项目名或会话标题/目录；无匹配的项目隐藏 */
  search?: string
  folderStatus: FolderStatus | null
  preferTouchUi: boolean
  showSessionDiffStats: boolean
  currentDirectory?: string
  selectedSessionId: string | null
  onSelectProject: () => void
  onSelectDirectory: (directory: string, sectionKind?: FolderRecentProject['sectionKind']) => void
  onNewSessionInDirectory?: (directory: string) => void
  /** 移除项目（从侧栏列表移除，不删文件）；无目录的项目（全局）不显示按钮 */
  onRemoveProject?: (project: FolderRecentProject) => void
  /** worktree → 最后使用时间戳；缺省退回本机 recentProjects 记录 */
  projectLastUsedAt?: Record<string, number>
  onToggle: () => void
  onSelectSession: (session: ApiSession) => void
  onRenameSession: (session: ApiSession, newTitle: string) => Promise<void>
  onRequestDeleteSession: (pending: PendingDeleteSession) => void
  expandedChildSessionIds?: Set<string>
  inlineChildSessions?: Map<string, ApiSession[]>
  onSelectChildSession?: (session: ApiSession) => void
  workspaceDirectories?: string[]
  workspaceFolderStatusByDirectory?: Map<string, FolderStatus>
  draggableWorkspaceDirectories?: string[]
  onReorderWorkspace?: (draggedPath: string, targetPath: string) => void
  sectionKind?: 'project' | 'workspace'
  // 拖拽
  canDrag: boolean
  isDragged: boolean
  onDragStart: (e: React.PointerEvent) => void
  onTouchDragStart: (e: React.TouchEvent) => void
  registerRef: (el: HTMLDivElement | null) => void
  // ---- 编辑模式 ----
  isEditMode?: boolean
  isProjectChecked?: boolean
  /** 上一项也选中时，去掉上圆角 */
  projectCheckedPrev?: boolean
  /** 下一项也选中时，去掉下圆角（折叠时连下一个文件夹） */
  projectCheckedNext?: boolean
  /** 下一个文件夹已选中：展开时最后一条 session 可与其拼接 */
  nextProjectChecked?: boolean
  onToggleProjectCheck?: (options?: { shiftKey?: boolean }) => void
  selectedSessionIds?: Set<string>
  onToggleSessionSelection?: (sessionId: string, options?: { shiftKey?: boolean }) => void
}

function FolderRecentSection({
  project,
  serverId,
  isExpanded,
  search = '',
  folderStatus,
  preferTouchUi,
  showSessionDiffStats,
  currentDirectory,
  selectedSessionId,
  onSelectProject,
  onSelectDirectory,
  onNewSessionInDirectory,
  onRemoveProject,
  projectLastUsedAt,
  onToggle,
  onSelectSession,
  onRenameSession,
  onRequestDeleteSession,
  expandedChildSessionIds,
  inlineChildSessions,
  onSelectChildSession,
  workspaceDirectories = [],
  workspaceFolderStatusByDirectory,
  draggableWorkspaceDirectories,
  onReorderWorkspace,
  sectionKind = 'project',
  canDrag,
  isDragged,
  onDragStart,
  onTouchDragStart,
  registerRef,
  isEditMode = false,
  isProjectChecked = false,
  projectCheckedPrev = false,
  projectCheckedNext = false,
  nextProjectChecked = false,
  onToggleProjectCheck,
  selectedSessionIds,
  onToggleSessionSelection,
}: FolderRecentSectionProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { ref: inViewRef, inView } = useInView({ rootMargin: '200px 0px', triggerOnce: true })
  const [hasActivated, setHasActivated] = useState(false)
  const shouldRenderBody = useDelayedRender(isExpanded)
  const hasWorkspaceTree = workspaceDirectories.length > 0
  const workspaceFallbackName = getDirectoryName(project.worktree) || project.worktree
  const isRemoteServer = !!serverId && serverId !== 'local'
  const { vcsInfo, isLoading: isBranchLoading } = useVcsInfo(
    isRemoteServer ? undefined : sectionKind === 'workspace' ? project.worktree : undefined,
  )
  const { recentProjects } = useDirectory()
  const normalizedWorktree = normalizeToForwardSlash(project.worktree || '')
  const lastUsedAt = projectLastUsedAt?.[normalizedWorktree] ?? recentProjects[normalizedWorktree]
  // 移除按钮二次点击防误触：第一次点击进入确认态，3 秒内再点才真正移除
  const [removeArmed, setRemoveArmed] = useState(false)
  const removeTimerRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (removeTimerRef.current) clearTimeout(removeTimerRef.current)
    }
  }, [])
  const handleRemoveClick = useCallback(() => {
    if (removeArmed) {
      if (removeTimerRef.current) clearTimeout(removeTimerRef.current)
      removeTimerRef.current = null
      setRemoveArmed(false)
      onRemoveProject?.(project)
      return
    }
    setRemoveArmed(true)
    if (removeTimerRef.current) clearTimeout(removeTimerRef.current)
    removeTimerRef.current = window.setTimeout(() => setRemoveArmed(false), 3000)
  }, [removeArmed, onRemoveProject, project])
  const disarmRemove = useCallback(() => {
    if (removeTimerRef.current) clearTimeout(removeTimerRef.current)
    removeTimerRef.current = null
    setRemoveArmed(false)
  }, [])

  useEffect(() => {
    if (isExpanded && inView) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 延迟加载闸门，只从 false→true
      setHasActivated(true)
    }
  }, [isExpanded, inView])

  const { sessions, isLoading, isLoadingMore, hasMore, loadMore, patchLocalSession, removeLocalSession } = useSessions({
    directory: project.worktree,
    pageSize: DIRECTORY_PAGE_SIZE,
    enabled: hasActivated && !hasWorkspaceTree,
    serverId,
  })
  const pinnedEntries = useSyncExternalStore(
    pinnedSessionsStore.subscribe,
    pinnedSessionsStore.getSnapshot,
    pinnedSessionsStore.getSnapshot,
  )
  const visibleSessions = useMemo(() => {
    const pinnedSet = new Set(pinnedEntries.map(entry => entry.sessionId))
    return sessions.filter(session => !pinnedSet.has(session.id))
  }, [pinnedEntries, sessions])

  const handleRename = useCallback(
    async (sessionId: string, newTitle: string) => {
      const session = sessions.find(item => item.id === sessionId)
      if (!session) return
      await onRenameSession(session, newTitle)
      patchLocalSession(sessionId, { title: newTitle })
    },
    [sessions, onRenameSession, patchLocalSession],
  )

  const handleDelete = useCallback(
    (sessionId: string) => {
      const session = sessions.find(item => item.id === sessionId)
      if (!session) return
      onRequestDeleteSession({
        session,
        removeLocal: () => removeLocalSession(sessionId),
      })
    },
    [sessions, onRequestDeleteSession, removeLocalSession],
  )

  // 归档：updateSession({ time: { archived: now } })，成功后本地移除
  const handleArchive = useCallback(
    async (sessionId: string) => {
      const session = sessions.find(item => item.id === sessionId)
      if (!session) return
      try {
        await updateSession(session.id, { time: { archived: Date.now() } }, session.directory, serverId)
        removeLocalSession(sessionId)
      } catch {
        // 归档失败静默（由列表刷新兜底）
      }
    },
    [sessions, serverId, removeLocalSession],
  )

  const projectName =
    sectionKind === 'workspace'
      ? (vcsInfo?.branch ?? (isBranchLoading ? '...' : workspaceFallbackName))
      : project.name || workspaceFallbackName
  const FolderDisplayIcon =
    project.id === 'global'
      ? GlobeIcon
      : sectionKind === 'workspace'
        ? GitBranchIcon
        : isExpanded
          ? FolderOpenIcon
          : FolderIcon

  // 当前打开的会话是否属于这个项目：是则文件夹图标上主题色（描边 + 填充），
  // 用于在长列表里快速定位"正在看的是哪个项目"。
  // selectedSessionId 形如 `${serverId}::${sessionId}`（多服务器模式），
  // 与 sessions 里的裸 id 比对前要先剥掉前缀。
  const activeSessionRawId = selectedSessionId ? splitSessionKey(selectedSessionId).sessionId : null
  const isProjectActive = !!activeSessionRawId && sessions.some(session => session.id === activeSessionRawId)

  // 展开时：文件夹与首条 session 可拼成连续选中块
  const firstVisibleSessionChecked =
    isEditMode &&
    isExpanded &&
    !hasWorkspaceTree &&
    visibleSessions.length > 0 &&
    (selectedSessionIds?.has(visibleSessions[0].id) ?? false)
  const folderCheckedNext = projectCheckedNext || firstVisibleSessionChecked

  // 就地筛选：匹配项目名或已加载会话的标题/目录；无匹配的项目整体隐藏
  const searchTerms = useMemo(
    () => search.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [search],
  )
  const filteredSessions = useMemo(() => {
    if (searchTerms.length === 0) return visibleSessions
    return visibleSessions.filter(session =>
      searchTerms.some(term => {
        const title = (session.title || '').toLowerCase()
        const dir = (session.directory || '').toLowerCase()
        return title.includes(term) || dir.includes(term)
      }),
    )
  }, [visibleSessions, searchTerms])
  const projectMatchesSearch =
    searchTerms.length === 0 ||
    searchTerms.some(term => {
      const name = projectName.toLowerCase()
      const worktree = (project.worktree || '').toLowerCase()
      return name.includes(term) || worktree.includes(term)
    })
  if (searchTerms.length > 0 && !projectMatchesSearch && filteredSessions.length === 0) return null

  return (
    <div ref={inViewRef}>
      <div
        ref={registerRef}
        onTouchStart={canDrag ? onTouchDragStart : undefined}
        className={`relative transition-all duration-150 group/folder ${
          isDragged
            ? 'z-10 shadow-lg shadow-black/20 ring-1 ring-inset ring-accent-main-100/30 rounded-md bg-bg-100'
            : ''
        }`}
      >
        {/* 文件夹行 — 选中用圆角底，连续选中拼成一条；整行可直接拖拽重排（点击仍是展开/收起） */}
        <div
          onPointerDown={canDrag ? onDragStart : undefined}
          className={cn(
            'relative flex w-full items-center transition-colors duration-150 select-none',
            getSelectionRoundClass(isEditMode && isProjectChecked, projectCheckedPrev, folderCheckedNext, 'md'),
            interactive.row,
            isEditMode && isProjectChecked && interactive.rowSelected,
          )}
          {...(isEditMode
            ? {
                'data-selection-kind': 'project' as const,
                'data-selection-id': project.id,
                'aria-selected': isProjectChecked,
              }
            : {})}
        >
          <button
            type="button"
            onMouseDown={e => {
              if (!isEditMode) return
              e.preventDefault()
              window.getSelection()?.removeAllRanges()
            }}
            onClick={e => {
              if (isEditMode) {
                // 管理模式：点文件夹 = 选中；Shift 点可范围选
                onToggleProjectCheck?.({ shiftKey: e.shiftKey })
                return
              }
              onSelectProject()
              onToggle()
            }}
            className={cn(
              'flex flex-1 min-w-0 items-center gap-1 pl-2 pr-2 py-1.5 text-left cursor-default select-none rounded-md',
              // 点击/展开反馈走 transition-colors，与 interactive 词汇表一致；
              // 再叠一个 150ms 的箭头旋转（见下方 ChevronDownIcon），
              // 让"点了一下"有明确反馈而不是瞬变。
              'transition-colors duration-150 active:bg-bg-200/60 active:duration-75',
            )}
            title={project.worktree}
          >
            {/* hover 时图标淡出、展开/收起箭头淡入（两者叠放做交叉淡入淡出）。
                箭头常态不可见但仍占位，避免 hover 瞬间撑开会引起文字位移。
                图标类型（地球/分支/文件夹）不丢失，鼠标移开即恢复。 */}
            <span className="relative size-5 shrink-0 flex items-center justify-center">
              <FolderDisplayIcon
                size={15}
                className={`transition-opacity duration-150 group-hover/folder:opacity-0 ${
                  isProjectActive ? 'text-accent-main-100' : 'text-text-400'
                }`}
                // 激活项目：主色描边 + 主色填充（fill 跟随 currentColor），
                // 与列内其他线性图标区分开；非激活保持原来的灰线框。
                {...(isProjectActive ? { fill: 'currentColor', fillOpacity: 0.22 } : {})}
              />
              <ChevronDownIcon
                size={13}
                className={`absolute text-text-300 opacity-0 transition-[opacity,transform] duration-150 group-hover/folder:opacity-100 ${
                  isExpanded ? '' : '-rotate-90'
                }`}
              />
            </span>
            <ProjectNameTitle
              text={projectName}
              // 颜色承担层级：项目名用最强文字色，比下属会话（text-300）明显更亮。
              // 字重上 medium 与 semibold 都解析到 600（字体只有 400/600 两档），
              // 无法再靠加粗区分，所以层级只能由颜色表达。
              className="text-text-100"
            />
          </button>
          {/* 项目行 hover 的 + 按钮：在该项目目录下新建会话（全局/无目录项目不显示）；hover 才显示，与移除按钮一致 */}
          {!isEditMode && onNewSessionInDirectory && project.worktree && (
            <button
              type="button"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation()
                onNewSessionInDirectory(project.worktree)
              }}
              className={cn(
                'shrink-0 flex items-center justify-center h-6 rounded-full overflow-hidden text-accent-main-100 hover:text-accent-main-200 w-0 mr-0 opacity-0 transition-all group-hover/folder:w-6 group-hover/folder:mr-0.5 group-hover/folder:opacity-100',
                interactive.accent,
              )}
              title={t('sidebar.newTaskInDirectory', { defaultValue: 'New conversation here' })}
              aria-label={t('sidebar.newTaskInDirectory', { defaultValue: 'New conversation here' })}
            >
              <PlusIcon size={13} />
            </button>
          )}
          {/* 移除项目：hover 显示；二次点击防误触（已保存=移除，服务器发现=隐藏；全局项不显示） */}
          {!isEditMode && onRemoveProject && project.worktree && (
            <button
              type="button"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation()
                handleRemoveClick()
              }}
              onMouseLeave={disarmRemove}
              className={cn(
                'shrink-0 flex items-center justify-center h-6 rounded-full overflow-hidden',
                removeArmed
                  ? 'w-6 mr-0.5 bg-danger-100/15 text-danger-100'
                  : 'w-0 mr-0 text-text-400 opacity-0 group-hover/folder:w-6 group-hover/folder:mr-0.5 group-hover/folder:opacity-100 hover:text-danger-100',
                !removeArmed && interactive.danger,
                'transition-all',
              )}
              title={removeArmed ? t('sidebar.removeProjectConfirmClick', { defaultValue: '再次点击确认移除' }) : t('sidebar.removeProject')}
              aria-label={removeArmed ? t('sidebar.removeProjectConfirmClick', { defaultValue: '再次点击确认移除' }) : t('sidebar.removeProject')}
            >
              {removeArmed ? <CheckIcon size={12} /> : <TrashIcon size={12} />}
            </button>
          )}
          {/* 管理模式下保留展开/收起，否则选不了内部会话 */}
          {isEditMode && (
            <button
              type="button"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation()
                onToggle()
              }}
              className={cn(
                'shrink-0 flex items-center justify-center w-6 h-6 mr-1 rounded-md text-text-500 hover:text-text-200',
                interactive.subtle,
              )}
              title={isExpanded ? t('common:collapse', { defaultValue: 'Collapse' }) : t('common:expand', { defaultValue: 'Expand' })}
              aria-expanded={isExpanded}
            >
              <ChevronDownIcon
                size={12}
                className={`transition-transform duration-150 ${isExpanded ? '' : '-rotate-90'}`}
              />
            </button>
          )}
          {/* 状态点紧挨时间：放在主按钮内会被 hover 按钮的透明占位隔开，位置看着不对；hover 时随时间一起隐藏 */}
          {folderStatus && (
            <span
              className="relative shrink-0 flex items-center justify-center w-3 h-3 group-hover/folder:hidden"
              title={folderStatus.count ? `${folderStatus.label} (${folderStatus.count})` : folderStatus.label}
            >
              <span className={`absolute w-1.5 h-1.5 rounded-full ${folderStatus.dot}`} />
              {folderStatus.pulse && (
                <span className={`absolute w-1.5 h-1.5 rounded-full ${folderStatus.dot} animate-ping opacity-50`} />
              )}
            </span>
          )}
          {/* 最后使用时间放行尾；hover 时隐藏，给 + / 移除按钮让位 */}
          {lastUsedAt ? (
            <span
              className="shrink-0 pl-1 pr-1.5 text-[length:var(--fs-xxs)] text-text-500 group-hover/folder:hidden"
              title={new Date(lastUsedAt).toLocaleString()}
            >
              {formatRelativeDay(lastUsedAt)}
            </span>
          ) : null}
        </div>

        {/* Session 列表 — mt-1 与项目行拉开：项目行自身 py-1.5(6px) + 这里 4px，
            合计约 10px，比会话之间的 4px 明显，层级更清楚 */}
        <ExpandableSection show={isExpanded} className="mt-1">
          {shouldRenderBody && (
            <div onTouchStart={e => e.stopPropagation()}>
              {!hasActivated || (!hasWorkspaceTree && isLoading) ? (
                // 与 minimal SessionListItem 对齐：状态点占位 + spinner 落在标题文字区
                <div className="flex items-center gap-2 px-2 py-1.5" aria-busy="true">
                  <span className="size-5 shrink-0" aria-hidden="true" />
                  <SpinnerIcon size={12} className="animate-spin text-accent-main-100" />
                </div>
              ) : hasWorkspaceTree ? (
                <WorkspaceFolderList
                  workspaceDirectories={workspaceDirectories}
                  currentDirectory={currentDirectory}
                  selectedSessionId={selectedSessionId}
                  search={search}
                  preferTouchUi={preferTouchUi}
                  showSessionDiffStats={showSessionDiffStats}
                  onSelectDirectory={onSelectDirectory}
                  onSelectSession={onSelectSession}
                  onRenameSession={onRenameSession}
                  onRequestDeleteSession={onRequestDeleteSession}
                  expandedChildSessionIds={expandedChildSessionIds}
                  inlineChildSessions={inlineChildSessions}
                  onSelectChildSession={onSelectChildSession}
                  isEditMode={isEditMode}
                  selectedSessionIds={selectedSessionIds}
                  onToggleSessionSelection={onToggleSessionSelection}
                  folderStatusByWorkspaceDirectory={workspaceFolderStatusByDirectory}
                  draggableWorkspaceDirectories={draggableWorkspaceDirectories}
                  onReorderWorkspace={onReorderWorkspace}
                />
              ) : filteredSessions.length === 0 ? (
                <div className="px-2 py-1 text-[length:var(--fs-xs)] text-text-400/50">
                  {searchTerms.length > 0
                    ? t('sidebar.searchNoMatches', { defaultValue: 'No matching chats' })
                    : t('sidebar.noChatsInFolder')}
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {filteredSessions.map((session, index) => {
                    const isChecked = selectedSessionIds?.has(session.id) ?? false
                    // 上：前一条 session，或（首条时）父文件夹已选中
                    const prevChecked =
                      isEditMode &&
                      (index > 0
                        ? (selectedSessionIds?.has(filteredSessions[index - 1].id) ?? false)
                        : isProjectChecked)
                    // 下：下一条 session，或（末条时）下一个文件夹已选中
                    const nextChecked =
                      isEditMode &&
                      (index < filteredSessions.length - 1
                        ? (selectedSessionIds?.has(filteredSessions[index + 1].id) ?? false)
                        : nextProjectChecked)
                    return (
                    <div key={session.id}>
                      <SessionListItem
                        session={session}
                        activeSessionKey={serverId ? `${serverId}::${session.id}` : undefined}
                        isSelected={!!selectedSessionId && session.id === splitSessionKey(selectedSessionId).sessionId}
                        onSelect={() => onSelectSession(session)}
                        onRename={newTitle => handleRename(session.id, newTitle)}
                        onDelete={() => handleDelete(session.id)}
                        onArchive={() => void handleArchive(session.id)}
                        preferTouchUi={preferTouchUi}
                        density="minimal"
                        showStats={showSessionDiffStats}
                        showDirectory={false}
                        isEditMode={isEditMode}
                        isChecked={isChecked}
                        checkedPrev={prevChecked}
                        checkedNext={nextChecked}
                        onToggleCheck={
                          onToggleSessionSelection
                            ? options => onToggleSessionSelection(session.id, options)
                            : undefined
                        }
                      />
                      {onSelectChildSession &&
                        (expandedChildSessionIds?.has(session.id) || inlineChildSessions?.has(session.id)) && (
                          <SessionChildrenSlot
                            parentSession={session}
                            serverId={serverId}
                            selectedSessionId={selectedSessionId}
                            fetchAll={expandedChildSessionIds?.has(session.id)}
                            children={inlineChildSessions?.get(session.id)}
                            onSelect={onSelectChildSession}
                            isEditMode={isEditMode}
                            selectedSessionIds={selectedSessionIds}
                            onToggleSessionSelection={onToggleSessionSelection}
                          />
                        )}
                    </div>
                    )
                  })}

                  {hasMore && (
                    <button
                      onClick={() => void loadMore()}
                      disabled={isLoadingMore}
                      aria-busy={isLoadingMore}
                      aria-label={isLoadingMore ? t('common:loadingMore') : t('sidebar.showMoreChats')}
                      className={cn(
                        'group w-full rounded-md px-2 py-1.5 text-[length:var(--fs-xs)] text-text-400/85 hover:text-text-200',
                        interactive.subtle,
                        'disabled:cursor-default disabled:opacity-70',
                      )}
                    >
                      <span className="flex items-center justify-center">
                        <span className="relative inline-flex shrink-0 items-center gap-1.5 font-medium">
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute right-full top-1/2 mr-2 h-px w-6 -translate-y-1/2 bg-text-600/35 transition-colors group-hover:bg-text-500/55"
                          />
                          <span>{t('sidebar.showMoreChats')}</span>
                          {isLoadingMore ? (
                            <SpinnerIcon size={12} className="animate-spin text-accent-main-100" />
                          ) : (
                            <ChevronDownIcon
                              size={12}
                              className="text-text-400/90 transition-colors group-hover:text-text-200"
                            />
                          )}
                        </span>
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </ExpandableSection>
      </div>
    </div>
  )
}

interface WorkspaceFolderListProps {
  workspaceDirectories: string[]
  currentDirectory?: string
  selectedSessionId: string | null
  preferTouchUi: boolean
  showSessionDiffStats: boolean
  onSelectDirectory: (directory: string, sectionKind?: FolderRecentProject['sectionKind']) => void
  onSelectSession: (session: ApiSession) => void
  onRenameSession: (session: ApiSession, newTitle: string) => Promise<void>
  onRequestDeleteSession: (pending: PendingDeleteSession) => void
  expandedChildSessionIds?: Set<string>
  inlineChildSessions?: Map<string, ApiSession[]>
  onSelectChildSession?: (session: ApiSession) => void
  isEditMode?: boolean
  selectedSessionIds?: Set<string>
  onToggleSessionSelection?: (sessionId: string, options?: { shiftKey?: boolean }) => void
  folderStatusByWorkspaceDirectory?: Map<string, FolderStatus>
  draggableWorkspaceDirectories?: string[]
  onReorderWorkspace?: (draggedPath: string, targetPath: string) => void
  /** 就地筛选（透传） */
  search?: string
}

function WorkspaceFolderList({
  workspaceDirectories,
  currentDirectory,
  selectedSessionId,
  preferTouchUi,
  showSessionDiffStats,
  onSelectDirectory,
  onSelectSession,
  onRenameSession,
  onRequestDeleteSession,
  expandedChildSessionIds,
  inlineChildSessions,
  onSelectChildSession,
  isEditMode = false,
  selectedSessionIds,
  onToggleSessionSelection,
  folderStatusByWorkspaceDirectory,
  draggableWorkspaceDirectories,
  onReorderWorkspace,
  search = '',
}: WorkspaceFolderListProps) {
  const workspaceProjects = useMemo<FolderRecentProject[]>(() => {
    const draggableSet = new Set(
      (draggableWorkspaceDirectories ?? []).map(directory => normalizeToForwardSlash(directory)),
    )

    return workspaceDirectories.map(directory => ({
      ...createDirectoryProject(directory, 'workspace'),
      canReorder: draggableSet.has(normalizeToForwardSlash(directory)),
    }))
  }, [draggableWorkspaceDirectories, workspaceDirectories])
  const workspaceById = useMemo(
    () => new Map(workspaceProjects.map(project => [project.id, project])),
    [workspaceProjects],
  )
  const [workspaceExpandedIds, setWorkspaceExpandedIds] = useState<string[]>(() =>
    getInitialExpandedProjectIds(workspaceProjects, currentDirectory),
  )
  const expandedWorkspaceIds = useMemo(
    () =>
      expandProjectId(
        reconcileExpandedProjectIds(workspaceExpandedIds, workspaceProjects, currentDirectory),
        getCurrentProjectId(workspaceProjects, currentDirectory),
      ),
    [workspaceExpandedIds, workspaceProjects, currentDirectory],
  )
  const { handleDragActivated, handleDragFinished } = useCollapseExpandedIdsOnDrag(
    expandedWorkspaceIds,
    setWorkspaceExpandedIds,
  )

  const handleToggleWorkspace = useCallback((workspaceId: string) => {
    setWorkspaceExpandedIds(prev => toggleProjectId(prev, workspaceId))
  }, [])

  const {
    draggedId,
    displayOrder,
    handlePointerStart,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    registerRef,
  } = useReorderableList({
    ids: workspaceProjects.map(project => project.id),
    canDrag: id => !!workspaceById.get(id)?.canReorder && !isEditMode,
    onCommit: (draggedId, targetId) => {
      const draggedWorkspace = workspaceById.get(draggedId)
      const targetWorkspace = workspaceById.get(targetId)
      if (!draggedWorkspace || !targetWorkspace || !onReorderWorkspace) return
      onReorderWorkspace(draggedWorkspace.worktree, targetWorkspace.worktree)
    },
    onDragActivated: handleDragActivated,
    onDragFinished: handleDragFinished,
  })

  return (
    <div className="space-y-1 pt-1" onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      {displayOrder.map(workspaceId => {
        const workspaceProject = workspaceById.get(workspaceId)
        if (!workspaceProject) return null
        const isWorkspaceExpanded = draggedId === null && expandedWorkspaceIds.includes(workspaceProject.id)

        return (
          <FolderRecentSection
            key={workspaceProject.id}
            project={workspaceProject}
            isExpanded={isWorkspaceExpanded}
            search={search}
            folderStatus={
              draggedId === workspaceProject.id || isWorkspaceExpanded
                ? null
                : (folderStatusByWorkspaceDirectory?.get(workspaceProject.worktree) ?? null)
            }
            preferTouchUi={preferTouchUi}
            showSessionDiffStats={showSessionDiffStats}
            currentDirectory={currentDirectory}
            selectedSessionId={selectedSessionId}
            onSelectProject={() => onSelectDirectory(workspaceProject.worktree, 'workspace')}
            onSelectDirectory={onSelectDirectory}
            onToggle={() => handleToggleWorkspace(workspaceProject.id)}
            onSelectSession={onSelectSession}
            onRenameSession={onRenameSession}
            onRequestDeleteSession={onRequestDeleteSession}
            expandedChildSessionIds={expandedChildSessionIds}
            inlineChildSessions={inlineChildSessions}
            onSelectChildSession={onSelectChildSession}
            workspaceDirectories={[]}
            sectionKind="workspace"
            canDrag={!!workspaceProject.canReorder && !isEditMode}
            isDragged={draggedId === workspaceProject.id}
            onDragStart={event => handlePointerStart(workspaceProject.id, event)}
            onTouchDragStart={event => handleTouchStart(workspaceProject.id, event)}
            registerRef={element => registerRef(workspaceProject.id, element)}
            isEditMode={isEditMode}
            selectedSessionIds={selectedSessionIds}
            onToggleSessionSelection={onToggleSessionSelection}
          />
        )
      })}
    </div>
  )
}
