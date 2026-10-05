import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { Sidebar } from './features/chat'
import { ChatPane } from './features/chat/ChatPane'
import { SplitContainer } from './features/chat/SplitContainer'
import type { CommandItem } from './components/CommandPalette'
import { ToastContainer } from './components/ToastContainer'
import { RightPanel } from './components/RightPanel'
import { BottomPanel } from './components/BottomPanel'
import { DesktopTitlebar } from './components/DesktopTitlebar'
import { useDirectory, useGlobalEvents, useGlobalKeybindings, useRouter } from './hooks'
import { useGlobalHaptics } from './hooks/useGlobalHaptics'
import { hapticTap } from './utils/haptics'
import { useInputCapabilities } from './hooks/useInputCapabilities'
import { useViewportHeight } from './hooks/useViewportHeight'
import { useCloseServiceDialog } from './hooks/useCloseServiceDialog'
import { useWakeLock } from './hooks/useWakeLock'
import type { KeybindingHandlers } from './hooks/useKeybindings'
import { keybindingStore } from './store/keybindingStore'
import {
  layoutStore,
  paneLayoutStore,
  useLayoutStore,
  usePaneController,
  usePaneControllers,
  usePaneLayout,
  updateStore,
} from './store'
import {
  ChatViewportProvider,
  CHAT_SURFACE_MIN_WIDTH,
  canUseSplitPane,
  useChatViewportController,
} from './features/chat/chatViewport'
import { uiErrorHandler, isSameDirectory, collectActiveDirectoriesByServer } from './utils'
import { makeSessionKey, sessionKeyToServerId, splitSessionKey } from './utils/sessionKey'
import { multiServerStore } from './store/multiServerStore'
import { hostWorkspaceStore } from './store/hostWorkspaceStore'
import { serverStore } from './store/serverStore'
import { initNotificationSound } from './utils/notificationSoundBridge'
import { initLiveUpdateSync } from './utils/liveUpdateSync'
import { createPtySession } from './api/pty'
import type { TerminalTab } from './store/layoutStore'
import type { SettingsTab } from './features/settings/SettingsDialog'
import { getDesktopPlatform, isTauri, isTauriMobile, usesCustomDesktopTitlebar } from './utils/tauri'
import { DESKTOP_SIDEBAR_MIN_WIDTH, DESKTOP_SIDEBAR_RAIL_WIDTH } from './constants'
import { InternalDragLayer } from './components/InternalDragLayer'

const SettingsDialog = lazy(() =>
  import('./features/settings/SettingsDialog').then(module => ({ default: module.SettingsDialog })),
)
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then(module => ({ default: module.CommandPalette })),
)
const CloseServiceDialog = lazy(() =>
  import('./components/CloseServiceDialog').then(module => ({ default: module.CloseServiceDialog })),
)
const ScheduledTasksDialog = lazy(() =>
  import('./features/settings/components/ScheduledTasksDialog').then(module => ({
    default: module.ScheduledTasksDialog,
  })),
)
function App() {
  const { t } = useTranslation(['commands', 'chat', 'common', 'components'])
  const router = useRouter()
  const {
    sessionId: routeSessionId,
    serverId: routeServerId,
    directory: routeDirectory,
    navigateToSession: navigateRouteToSession,
    navigateHome: navigateRouteHome,
    replaceSession,
    restoreWorkspace,
  } = router
  // 路由里 sessionId 直接是「服务器作用域复合 key」（serverId::sessionId）；
  // 旧书签（无 :: 前缀）视为活动服务器，合成复合 key
  const routeSessionKey = useMemo(() => {
    if (!routeSessionId) return null
    if (routeSessionId.includes('::')) return routeSessionId
    return makeSessionKey(serverStore.getActiveServerId(), routeSessionId)
  }, [routeSessionId])
  const { currentDirectory, savedDirectories, sidebarExpanded, setSidebarExpanded, setCurrentDirectory } =
    useDirectory()
  const { rightPanelOpen, rightPanelWidth, wakeLock } = useLayoutStore()
  const { surfaceRef, value: chatViewport } = useChatViewportController({
    sidebarExpanded,
    rightPanelOpen,
    requestedRightPanelWidth: rightPanelWidth,
    // Windows 全高侧栏：收起最小宽度 = 顶部工具栏按钮行宽度（rail 只保留开关按钮）
    sidebarRailWidth: getDesktopPlatform() === 'windows' ? DESKTOP_SIDEBAR_RAIL_WIDTH : undefined,
    // Windows 全高侧栏：拖拽调节宽度的下限 = 顶部 6 个按钮合计宽度（不被挤压）
    sidebarHardMinWidth: getDesktopPlatform() === 'windows' ? DESKTOP_SIDEBAR_MIN_WIDTH : undefined,
  })
  const splitPaneEnabled = canUseSplitPane(chatViewport)
  const paneLayout = usePaneLayout()
  const focusedController = usePaneController(paneLayout.focusedPaneId)
  const paneControllers = usePaneControllers()
  const syncingFromRouteRef = useRef(false)
  const lastRouteSessionIdRef = useRef<string | null | undefined>(undefined)
  // 当 currentDirectory 为 undefined 时表示全局模式，
  // 不应 fallback 到 session 自身的 directory，否则 replaceSession 会把 dir 参数写回 URL
  const focusedRouteDirectory =
    currentDirectory !== undefined
      ? paneLayout.focusedSessionId === routeSessionId
        ? routeDirectory || focusedController?.effectiveDirectory || currentDirectory
        : focusedController?.effectiveDirectory || currentDirectory
      : undefined

  useEffect(() => {
    const cleanup = initNotificationSound()
    return cleanup
  }, [])

  // Android 实况通知（ColorOS 流体云）：会话进行中时发布/更新，结束时取消。
  useEffect(() => initLiveUpdateSync(), [])

  useEffect(() => {
    if (!isTauri() || isTauriMobile()) return

    void invoke('desktop_window_ready').catch(() => {
      // best effort only
    })
  }, [])

  useEffect(() => {
    if (import.meta.env.DEV) return
    void updateStore.checkForUpdates()
  }, [])

  useViewportHeight()
  useWakeLock(wakeLock)

  // 移动端全局触觉反馈：一处 document 级监听覆盖全站可交互操作。
  // 仅在触摸优先设备启用，桌面/混合设备不震。
  const { preferTouchUi } = useInputCapabilities()
  useGlobalHaptics(preferTouchUi)

  const activeDirectories = useMemo(
    () =>
      collectActiveDirectoriesByServer({
        activeServerId: serverStore.getActiveServerId(),
        routeServerId,
        routeDirectory,
        currentDirectory,
        panes: paneControllers.map(controller => ({
          serverId: controller.sessionId ? sessionKeyToServerId(controller.sessionId) : undefined,
          directory: controller.effectiveDirectory,
        })),
        projectDirectories: (Array.isArray(savedDirectories) ? savedDirectories : []).map(directory => directory.path),
      }),
    [routeServerId, routeDirectory, currentDirectory, paneControllers, savedDirectories],
  )

  // 全局唯一 SSE 连接。所有 pane 通过 consumer 机制接收自己的 session 事件。
  useGlobalEvents(activeDirectories)

  // 活动服务器：home 态下焦点服务器要跟随它（见下方 effect）
  const activeServerId = useSyncExternalStore(
    cb => serverStore.subscribe(cb),
    () => serverStore.getActiveServerId(),
    () => serverStore.getActiveServerId(),
  )

  // ── 每主机工作区快照 ──
  // 让「主机」成为顶层上下文：每台主机各记住自己当前打开的会话与目录，
  // 切主机时整体切换、切回来恢复。避免旧主机的会话/项目泄漏到新主机。
  // 用 ref 追踪「最近一次已知的 active server」，以便在 server-switch 时
  // 判断「刚刚离开的是哪台」并把它的工作区先存下来。
  const lastActiveServerRef = useRef<string | null>(null)
  const workspaceRef = useRef<{ sessionKey: string | null; directory: string | undefined }>({
    sessionKey: null,
    directory: undefined,
  })

  useEffect(() => {
    workspaceRef.current = { sessionKey: routeSessionKey, directory: currentDirectory }
  }, [routeSessionKey, currentDirectory])

  useEffect(() => {
    // 首次挂载：只记录当前主机，不做切换
    if (lastActiveServerRef.current === null) {
      lastActiveServerRef.current = activeServerId
      return
    }
    if (lastActiveServerRef.current === activeServerId) return

    const previousServer = lastActiveServerRef.current
    // 1) 快照刚离开的主机（它的会话与目录）
    hostWorkspaceStore.set(previousServer, workspaceRef.current)
    lastActiveServerRef.current = activeServerId

    // 2) 恢复目标主机的快照：有会话则打开，无则回它的 home
    const target = hostWorkspaceStore.get(activeServerId)
    restoreWorkspace(activeServerId, target.sessionKey, target.directory)
  }, [activeServerId, restoreWorkspace])

  // URL -> focused pane session
  useEffect(() => {
    if (lastRouteSessionIdRef.current === routeSessionKey) return
    lastRouteSessionIdRef.current = routeSessionKey
    if (paneLayoutStore.getFocusedSessionId() === routeSessionKey) return
    syncingFromRouteRef.current = true
    paneLayoutStore.setFocusedSession(routeSessionKey)
  }, [routeSessionKey])

  // home（无 session）且 URL 指定了服务器：同步 active server（恢复链接/新建会话的服务器上下文）
  useEffect(() => {
    if (routeSessionKey || !routeServerId) return
    if (serverStore.getActiveServerId() === routeServerId) return
    serverStore.setActiveServer(routeServerId)
  }, [routeSessionKey, routeServerId])

  // 项目选择器焦点跟随当前聚焦 pane 的 session（切换 pane / 分屏聚焦时同步）。
  // 始终生效：多服务器是默认行为，不再由模式开关门控。
  useEffect(() => {
    const focusedSessionKey = paneLayout.focusedSessionId
    if (!focusedSessionKey) return
    // 只同步焦点服务器；目录由 URL 派生（pane -> URL 同步会写入对应 dir，不再手动 setCurrentDirectory
    // 以免清掉 session 路由）
    multiServerStore.setFocusedServerId(splitSessionKey(focusedSessionKey).serverId)
  }, [paneLayout.focusedSessionId])

  // home（没有聚焦会话）时，焦点服务器跟随活动服务器。
  //
  // 否则在底部主机条切换主机只会改 active、不改 focus：项目列表已按新主机展示，
  // 点「新建项目」打开的却是旧主机的目录选择器。有聚焦会话时焦点由上面的
  // effect 跟随会话，这里不介入。
  useEffect(() => {
    multiServerStore.syncFocusToActiveServerWhenIdle(!!paneLayout.focusedSessionId)
  }, [paneLayout.focusedSessionId, activeServerId])

  // focused pane session -> URL（路由只反映当前 focused pane）
  useEffect(() => {
    if (syncingFromRouteRef.current) {
      syncingFromRouteRef.current = false
      return
    }
    if (paneLayoutStore.getFocusedSessionId() !== paneLayout.focusedSessionId) return
    const focusedSessionKey = paneLayout.focusedSessionId
    if (focusedSessionKey === routeSessionKey && isSameDirectory(routeDirectory, focusedRouteDirectory)) return
    // 复合 key 直接写入 URL（本身携带服务器身份）
    replaceSession(focusedSessionKey, focusedRouteDirectory)
  }, [
    paneLayout.focusedPaneId,
    paneLayout.focusedSessionId,
    routeSessionKey,
    routeDirectory,
    replaceSession,
    focusedRouteDirectory,
  ])

  const navigatePaneToSession = useCallback(
    (paneId: string, sessionKey: string, directory?: string) => {
      paneLayoutStore.focusPane(paneId)
      paneLayoutStore.setPaneSession(paneId, sessionKey)
      // 项目选择器焦点跟随打开的 session：服务器 + 工作区目录
      // （注意：不用 setCurrentDirectory——它会把 URL 清成 #/?dir= 导致 session 路由丢失；
      //  目录通过 navigateRouteToSession 写入 URL，currentDirectory 由 URL 派生自动跟随）
      const { serverId } = splitSessionKey(sessionKey)
      multiServerStore.setFocusedServerId(serverId)
      navigateRouteToSession(sessionKey, directory)
    },
    [navigateRouteToSession],
  )

  const navigatePaneHome = useCallback(
    (paneId: string) => {
      paneLayoutStore.focusPane(paneId)
      paneLayoutStore.setPaneSession(paneId, null)
      // 多服务器模式：进入 home（新建对话）时切到焦点服务器。
      // 切到不同服务器：server-switch 会清掉 currentDirectory/目录参数（新服务器不一定有旧目录）；
      // 同一服务器内新建：保留当前工作区目录
      const focusedServerId = multiServerStore.getFocusedServerId()
      if (serverStore.getActiveServerId() !== focusedServerId) {
        serverStore.setActiveServer(focusedServerId)
      }
      navigateRouteHome(focusedServerId)
    },
    [navigateRouteHome],
  )

  const handleSelectSession = useCallback(
    (session: { id: string; serverId?: string; directory?: string }) => {
      const paneId = paneLayout.focusedPaneId ?? paneLayoutStore.getFocusedPaneId()
      if (!paneId) return
      const sessionKey = makeSessionKey(session.serverId ?? serverStore.getActiveServerId(), session.id)
      navigatePaneToSession(paneId, sessionKey, session.directory)
    },
    [paneLayout.focusedPaneId, navigatePaneToSession],
  )

  const handleNewSession = useCallback(
    (target?: { serverId?: string; directory?: string }) => {
      const paneId = paneLayout.focusedPaneId ?? paneLayoutStore.getFocusedPaneId()
      if (!paneId) return
      // 项目行的「新对话」会带上该项目所属服务器与目录：此时必须切到它，
      // 否则会沿用「焦点服务器」，在焦点与项目所属服务器不同时跳到别的主机。
      if (target?.serverId) {
        paneLayoutStore.focusPane(paneId)
        paneLayoutStore.setPaneSession(paneId, null)
        multiServerStore.setFocusedServerId(target.serverId)
        if (serverStore.getActiveServerId() !== target.serverId) {
          serverStore.setActiveServer(target.serverId)
        }
        navigateRouteHome(target.serverId)
        // navigateHome 只带服务器，目录需单独写入（项目行的按钮要求落到该项目目录）。
        // 此时本就进入 home（无 session 路由），不存在「清掉 session 路由」的问题。
        if (target.directory) setCurrentDirectory(target.directory)
        return
      }
      navigatePaneHome(paneId)
    },
    [paneLayout.focusedPaneId, navigatePaneHome, navigateRouteHome, setCurrentDirectory],
  )

  const handleEnterSplitMode = useCallback(() => {
    paneLayoutStore.enterSplitMode(paneLayout.focusedSessionId)
  }, [paneLayout.focusedSessionId])

  const handleToggleFocusedPaneFullscreen = useCallback(() => {
    const paneId = paneLayout.focusedPaneId ?? paneLayoutStore.getFocusedPaneId()
    if (!paneId) return
    paneLayoutStore.togglePaneFullscreen(paneId)
  }, [paneLayout.focusedPaneId])

  const isMobilePanelLayout = chatViewport.interaction.sidebarBehavior === 'overlay'

  // 移动端 overlay 侧栏的开合是临时浏览状态，不该参与偏好同步：进入该布局时
  // 标记为 transient，同步拉取不再改写它；回到桌面端则恢复持久化语义。
  // 同时把 overlay 侧栏收起，移动端始终以对话页为起点，避免桌面端偏好把侧栏
  // 在手机上默认盖住内容。
  const wasMobilePanelLayoutRef = useRef(false)
  useEffect(() => {
    layoutStore.setSidebarExpandedTransientMode(isMobilePanelLayout)
    if (isMobilePanelLayout && !wasMobilePanelLayoutRef.current) {
      // 进入移动端：收起 overlay 侧栏，始终以对话页为起点
      layoutStore.setSidebarExpandedTransient(false)
    } else if (!isMobilePanelLayout && wasMobilePanelLayoutRef.current) {
      // 回到桌面端：恢复持久化的侧栏偏好，避免沿用移动端的临时收起状态
      layoutStore.reloadFromStorage()
    }
    wasMobilePanelLayoutRef.current = isMobilePanelLayout
  }, [isMobilePanelLayout])

  const handleOpenSidebar = useCallback(() => {
    if (isMobilePanelLayout && rightPanelOpen) {
      layoutStore.closeRightPanel()
    }
    if (isMobilePanelLayout) {
      // 移动端 overlay 侧栏是浏览动作，不写同步键（否则会关掉桌面端的侧栏）
      layoutStore.setSidebarExpandedTransient(true)
      return
    }
    setSidebarExpanded(true)
  }, [isMobilePanelLayout, rightPanelOpen, setSidebarExpanded])

  const handleCloseSidebar = useCallback(() => {
    if (isMobilePanelLayout) {
      layoutStore.setSidebarExpandedTransient(false)
      return
    }
    setSidebarExpanded(false)
  }, [isMobilePanelLayout, setSidebarExpanded])

  const handleToggleSidebar = useCallback(() => {
    if (sidebarExpanded) {
      handleCloseSidebar()
    } else {
      handleOpenSidebar()
    }
  }, [handleCloseSidebar, handleOpenSidebar, sidebarExpanded])

  const handleToggleRightPanel = useCallback(() => {
    if (!isMobilePanelLayout) {
      layoutStore.toggleRightPanel()
      return
    }

    if (rightPanelOpen) {
      layoutStore.closeRightPanel()
      return
    }

    // 移动端：右栏是覆盖式 overlay；切到右栏时收起侧栏（临时交互，不落盘同步）
    if (sidebarExpanded) layoutStore.setSidebarExpandedTransient(false)
    layoutStore.openRightPanel()
  }, [isMobilePanelLayout, rightPanelOpen, sidebarExpanded])

  // ── 主界面左右滑动开抽屉 ──
  // 从主界面向右滑开侧栏、向左滑开右栏。只处理横向手势（纵向滚动对话放行），
  // 且仅在两个抽屉都未打开时生效（抽屉打开后由抽屉自身负责关闭手势）。
  const mainSwipeRef = useRef<{ startX: number; startY: number; axis: 'x' | 'y' | null } | null>(null)
  const MAIN_SWIPE_AXIS_PX = 12
  const MAIN_SWIPE_TRIGGER_PX = 60

  const handleMainTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!isMobilePanelLayout || sidebarExpanded || rightPanelOpen) {
        mainSwipeRef.current = null
        return
      }
      const touch = e.touches[0]
      if (!touch) return
      mainSwipeRef.current = { startX: touch.clientX, startY: touch.clientY, axis: null }
    },
    [isMobilePanelLayout, rightPanelOpen, sidebarExpanded],
  )

  const handleMainTouchMove = useCallback((e: React.TouchEvent) => {
    const swipe = mainSwipeRef.current
    const touch = e.touches[0]
    if (!swipe || !touch) return
    if (swipe.axis === null) {
      const dx = touch.clientX - swipe.startX
      const dy = touch.clientY - swipe.startY
      if (Math.abs(dx) < MAIN_SWIPE_AXIS_PX && Math.abs(dy) < MAIN_SWIPE_AXIS_PX) return
      // 横向意图明显强于纵向才接管，避免与对话滚动打架
      swipe.axis = Math.abs(dx) > Math.abs(dy) * 1.25 ? 'x' : 'y'
    }
  }, [])

  const handleMainTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const swipe = mainSwipeRef.current
      mainSwipeRef.current = null
      if (!swipe || swipe.axis !== 'x') return
      const touch = e.changedTouches[0]
      if (!touch) return
      const dx = touch.clientX - swipe.startX
      if (dx >= MAIN_SWIPE_TRIGGER_PX) {
        // 右滑：开侧栏
        hapticTap('medium')
        handleOpenSidebar()
      } else if (dx <= -MAIN_SWIPE_TRIGGER_PX) {
        // 左滑：开右栏
        hapticTap('medium')
        handleToggleRightPanel()
      }
    },
    [handleOpenSidebar, handleToggleRightPanel],
  )

  const focusedDirectory = focusedRouteDirectory || ''

  // 右侧面板（文件/diff/终端）绑定焦点 session 的服务器：
  // 切换焦点 session 到另一服务器时，右侧面板内容跟随该服务器而不是活动服务器
  const focusedServerId = useMemo(() => {
    if (!paneLayout.focusedSessionId) return undefined
    return sessionKeyToServerId(paneLayout.focusedSessionId)
  }, [paneLayout.focusedSessionId])

  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('servers')
  const openSettingsTab = useCallback((tab: SettingsTab) => {
    setSettingsInitialTab(tab)
    setSettingsDialogOpen(true)
  }, [])
  const openSettings = useCallback(() => {
    openSettingsTab('servers')
  }, [openSettingsTab])
  const openAboutSettings = useCallback(() => {
    openSettingsTab('about')
  }, [openSettingsTab])
  const closeSettings = useCallback(() => setSettingsDialogOpen(false), [])

  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const openProject = useCallback(() => setProjectDialogOpen(true), [])
  const closeProjectDialog = useCallback(() => setProjectDialogOpen(false), [])

  const [scheduledTasksOpen, setScheduledTasksOpen] = useState(false)
  const openScheduledTasks = useCallback(() => setScheduledTasksOpen(true), [])
  const closeScheduledTasks = useCallback(() => setScheduledTasksOpen(false), [])

  const renderPaneLeaf = useCallback(
    (paneId: string, paneSessionId: string | null) => (
      <ChatPane
        key={paneId}
        paneId={paneId}
        sessionId={paneSessionId}
        isFocused={paneLayout.focusedPaneId === paneId}
        paneCount={paneLayout.paneCount}
        displayMode={paneLayout.isSplit && paneLayout.fullscreenPaneId !== paneId ? 'split' : 'single'}
        isPaneFullscreen={paneLayout.fullscreenPaneId === paneId}
        onOpenSidebar={handleOpenSidebar}
        onToggleRightPanel={handleToggleRightPanel}
        showSidebarButton={chatViewport.interaction.sidebarBehavior === 'overlay'}
        onSplitPane={splitPaneEnabled && !paneLayout.fullscreenPaneId ? handleEnterSplitMode : undefined}
        onTogglePaneFullscreen={paneLayout.isSplit ? handleToggleFocusedPaneFullscreen : undefined}
        onOpenSettings={openSettings}
        onOpenProject={openProject}
        navigatePaneToSession={navigatePaneToSession}
        navigatePaneHome={navigatePaneHome}
      />
    ),
    [
      paneLayout.focusedPaneId,
      paneLayout.paneCount,
      paneLayout.isSplit,
      paneLayout.fullscreenPaneId,
      chatViewport.interaction.sidebarBehavior,
      splitPaneEnabled,
      handleOpenSidebar,
      handleToggleRightPanel,
      handleEnterSplitMode,
      handleToggleFocusedPaneFullscreen,
      openSettings,
      openProject,
      navigatePaneToSession,
      navigatePaneHome,
    ],
  )

  // 桌面端把应用顶栏并入标题栏：仅当聚焦 pane 是 single（非 split，或 split 中被全屏）
  // 时传入 Header handlers，让 DesktopTitlebar 内嵌渲染 Header 内容。
  const focusedIsSingleMode = !paneLayout.isSplit || paneLayout.fullscreenPaneId === paneLayout.focusedPaneId
  const desktopTitlebarHeaderProps = focusedIsSingleMode
    ? {
        onOpenSidebar: handleOpenSidebar,
        onToggleRightPanel: handleToggleRightPanel,
        onSplitPane: splitPaneEnabled && !paneLayout.fullscreenPaneId ? handleEnterSplitMode : undefined,
        isPaneFullscreen: paneLayout.fullscreenPaneId !== null,
        onTogglePaneFullscreen: paneLayout.isSplit ? handleToggleFocusedPaneFullscreen : undefined,
      }
    : undefined

  // Windows 桌面：侧栏全高贯穿，标题栏只覆盖主区上方；macOS 保留全宽标题栏
  // （红绿灯位于窗口左上，需要全宽标题栏承载）。
  const desktopPlatform = getDesktopPlatform()
  const desktopFullHeightSidebar = desktopPlatform === 'windows' && !isMobilePanelLayout

  // 桌面标题栏通过 CustomEvent 触发打开项目/设置
  useEffect(() => {
    const onOpenProject = () => openProject()
    const onOpenSettings = () => openSettings()
    window.addEventListener('titlebar:open-project', onOpenProject)
    window.addEventListener('titlebar:open-settings', onOpenSettings)
    return () => {
      window.removeEventListener('titlebar:open-project', onOpenProject)
      window.removeEventListener('titlebar:open-settings', onOpenSettings)
    }
  }, [openProject, openSettings])

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  const handleNewTerminal = useCallback(async () => {
    try {
      const pty = await createPtySession({ cwd: focusedDirectory }, focusedDirectory)
      const tab: TerminalTab = {
        id: pty.id,
        title: pty.title || t('components:terminal.terminal'),
        status: 'connecting',
      }
      layoutStore.addTerminalTab(tab, true)
    } catch (error) {
      uiErrorHandler('create terminal', error)
    }
  }, [focusedDirectory, t])

  const keybindingHandlers = useMemo<KeybindingHandlers>(
    () => ({
      openSettings,
      openProject,
      commandPalette: () => setCommandPaletteOpen(true),
      toggleSidebar: handleToggleSidebar,
      toggleRightPanel: handleToggleRightPanel,
      focusInput: () => {
        const input = document.querySelector<HTMLTextAreaElement>('[data-input-box] textarea')
        input?.focus()
      },
      newSession: () => focusedController?.newSession(),
      archiveSession: () => focusedController?.archiveSession(),
      previousSession: () => focusedController?.previousSession(),
      nextSession: () => focusedController?.nextSession(),
      toggleTerminal: () => layoutStore.toggleBottomPanel(),
      newTerminal: handleNewTerminal,
      selectModel: () => focusedController?.openModelSelector(),
      toggleAgent: () => focusedController?.toggleAgent(),
      cancelMessage: () => focusedController?.cancelMessage(),
      copyLastResponse: () => focusedController?.copyLastResponse(),
      toggleFullAuto: () => focusedController?.toggleFullAuto(),
      // Pane
      focusNextPane: () => {
        paneLayoutStore.focusNextPane()
        requestAnimationFrame(() => {
          const pid = paneLayoutStore.getFocusedPaneId()
          if (pid) {
            const input = document.querySelector<HTMLTextAreaElement>(`[data-pane-id="${pid}"] textarea`)
            input?.focus()
          }
        })
      },
      focusPrevPane: () => {
        paneLayoutStore.focusPrevPane()
        requestAnimationFrame(() => {
          const pid = paneLayoutStore.getFocusedPaneId()
          if (pid) {
            const input = document.querySelector<HTMLTextAreaElement>(`[data-pane-id="${pid}"] textarea`)
            input?.focus()
          }
        })
      },
      splitRight: () => {
        const pid = paneLayout.focusedPaneId ?? paneLayoutStore.getFocusedPaneId()
        if (pid && splitPaneEnabled) paneLayoutStore.splitPane(pid, 'horizontal')
      },
      splitDown: () => {
        const pid = paneLayout.focusedPaneId ?? paneLayoutStore.getFocusedPaneId()
        if (pid && splitPaneEnabled) paneLayoutStore.splitPane(pid, 'vertical')
      },
      closePane: () => {
        const pid = paneLayout.focusedPaneId ?? paneLayoutStore.getFocusedPaneId()
        if (pid && paneLayout.isSplit) paneLayoutStore.closePane(pid)
      },
      togglePaneFullscreen: () => {
        if (paneLayout.isSplit) handleToggleFocusedPaneFullscreen()
      },
    }),
    [
      openSettings,
      openProject,
      focusedController,
      handleToggleSidebar,
      handleToggleRightPanel,
      handleNewTerminal,
      paneLayout.focusedPaneId,
      paneLayout.isSplit,
      splitPaneEnabled,
      handleToggleFocusedPaneFullscreen,
    ],
  )

  useGlobalKeybindings(keybindingHandlers)

  const commands = useMemo<CommandItem[]>(() => {
    const getShortcut = (action: string) =>
      keybindingStore.getKey(action as import('./store/keybindingStore').KeybindingAction)

    return [
      {
        id: 'openSettings',
        label: t('commands:openSettings'),
        description: t('commands:openSettingsDesc'),
        category: t('commands:categories.general'),
        shortcut: getShortcut('openSettings'),
        action: openSettings,
      },
      {
        id: 'openProject',
        label: t('commands:openProject'),
        description: t('commands:openProjectDesc'),
        category: t('commands:categories.general'),
        shortcut: getShortcut('openProject'),
        action: openProject,
      },
      {
        id: 'openSettingsShortcuts',
        label: t('commands:openShortcutsSettings'),
        description: t('commands:openShortcutsSettingsDesc'),
        category: t('commands:categories.general'),
        action: () => {
          openSettingsTab('keybindings')
        },
      },
      {
        id: 'openScheduledTasks',
        label: t('commands:openScheduledTasks', { defaultValue: '定时任务' }),
        description: t('commands:openScheduledTasksDesc', { defaultValue: '管理定时任务' }),
        category: t('commands:categories.general'),
        action: openScheduledTasks,
      },
      {
        id: 'toggleSidebar',
        label: t('commands:toggleSidebar'),
        description: t('commands:toggleSidebarDesc'),
        category: t('commands:categories.general'),
        shortcut: getShortcut('toggleSidebar'),
        action: handleToggleSidebar,
      },
      {
        id: 'toggleRightPanel',
        label: t('commands:toggleRightPanel'),
        description: t('commands:toggleRightPanelDesc'),
        category: t('commands:categories.general'),
        shortcut: getShortcut('toggleRightPanel'),
        action: handleToggleRightPanel,
      },
      {
        id: 'focusInput',
        label: t('commands:focusInput'),
        description: t('commands:focusInputDesc'),
        category: t('commands:categories.general'),
        shortcut: getShortcut('focusInput'),
        action: () => {
          const input = document.querySelector<HTMLTextAreaElement>('[data-input-box] textarea')
          input?.focus()
        },
      },
      {
        id: 'newSession',
        label: t('commands:newSession'),
        description: t('commands:newSessionDesc'),
        category: t('commands:categories.session'),
        shortcut: getShortcut('newSession'),
        action: () => focusedController?.newSession(),
      },
      {
        id: 'archiveSession',
        label: t('commands:archiveSession'),
        description: t('commands:archiveSessionDesc'),
        category: t('commands:categories.session'),
        shortcut: getShortcut('archiveSession'),
        action: () => focusedController?.archiveSession(),
      },
      {
        id: 'previousSession',
        label: t('commands:previousSession'),
        description: t('commands:previousSessionDesc'),
        category: t('commands:categories.session'),
        shortcut: getShortcut('previousSession'),
        action: () => focusedController?.previousSession(),
      },
      {
        id: 'nextSession',
        label: t('commands:nextSession'),
        description: t('commands:nextSessionDesc'),
        category: t('commands:categories.session'),
        shortcut: getShortcut('nextSession'),
        action: () => focusedController?.nextSession(),
      },
      {
        id: 'toggleTerminal',
        label: t('commands:toggleTerminal'),
        description: t('commands:toggleTerminalDesc'),
        category: t('commands:categories.terminal'),
        shortcut: getShortcut('toggleTerminal'),
        action: () => layoutStore.toggleBottomPanel(),
      },
      {
        id: 'newTerminal',
        label: t('commands:newTerminal'),
        description: t('commands:newTerminalDesc'),
        category: t('commands:categories.terminal'),
        shortcut: getShortcut('newTerminal'),
        action: handleNewTerminal,
      },
      {
        id: 'selectModel',
        label: t('commands:selectModel'),
        description: t('commands:selectModelDesc'),
        category: t('commands:categories.model'),
        shortcut: getShortcut('selectModel'),
        action: () => focusedController?.openModelSelector(),
      },
      {
        id: 'toggleAgent',
        label: t('commands:toggleAgent'),
        description: t('commands:toggleAgentDesc'),
        category: t('commands:categories.model'),
        shortcut: getShortcut('toggleAgent'),
        action: () => focusedController?.toggleAgent(),
      },
      {
        id: 'copyLastResponse',
        label: t('commands:copyLastResponse'),
        description: t('commands:copyLastResponseDesc'),
        category: t('commands:categories.message'),
        shortcut: getShortcut('copyLastResponse'),
        action: () => focusedController?.copyLastResponse(),
      },
      {
        id: 'cancelMessage',
        label: t('commands:cancelMessage'),
        description: t('commands:cancelMessageDesc'),
        category: t('commands:categories.message'),
        shortcut: getShortcut('cancelMessage'),
        action: () => focusedController?.cancelMessage(),
        when: () => !!focusedController?.isStreaming,
      },
      // Pane
      {
        id: 'focusNextPane',
        label: t('commands:focusNextPane'),
        description: t('commands:focusNextPaneDesc'),
        category: t('commands:categories.pane'),
        shortcut: getShortcut('focusNextPane'),
        action: () => paneLayoutStore.focusNextPane(),
      },
      {
        id: 'focusPrevPane',
        label: t('commands:focusPrevPane'),
        description: t('commands:focusPrevPaneDesc'),
        category: t('commands:categories.pane'),
        shortcut: getShortcut('focusPrevPane'),
        action: () => paneLayoutStore.focusPrevPane(),
      },
      {
        id: 'splitRight',
        label: t('commands:splitRight'),
        description: t('commands:splitRightDesc'),
        category: t('commands:categories.pane'),
        shortcut: getShortcut('splitRight'),
        action: () => {
          const pid = paneLayout.focusedPaneId ?? paneLayoutStore.getFocusedPaneId()
          if (pid && splitPaneEnabled) paneLayoutStore.splitPane(pid, 'horizontal')
        },
      },
      {
        id: 'splitDown',
        label: t('commands:splitDown'),
        description: t('commands:splitDownDesc'),
        category: t('commands:categories.pane'),
        shortcut: getShortcut('splitDown'),
        action: () => {
          const pid = paneLayout.focusedPaneId ?? paneLayoutStore.getFocusedPaneId()
          if (pid && splitPaneEnabled) paneLayoutStore.splitPane(pid, 'vertical')
        },
      },
      {
        id: 'closePane',
        label: t('commands:closePane'),
        description: t('commands:closePaneDesc'),
        category: t('commands:categories.pane'),
        shortcut: getShortcut('closePane'),
        action: () => {
          const pid = paneLayout.focusedPaneId ?? paneLayoutStore.getFocusedPaneId()
          if (pid && paneLayout.isSplit) paneLayoutStore.closePane(pid)
        },
        when: () => paneLayout.isSplit,
      },
      {
        id: 'togglePaneFullscreen',
        label: t('commands:togglePaneFullscreen'),
        description: t('commands:togglePaneFullscreenDesc'),
        category: t('commands:categories.pane'),
        shortcut: getShortcut('togglePaneFullscreen'),
        action: () => {
          if (paneLayout.isSplit) handleToggleFocusedPaneFullscreen()
        },
        when: () => paneLayout.isSplit,
      },
    ]
  }, [
    t,
    openSettings,
    openProject,
    openScheduledTasks,
    openSettingsTab,
    handleToggleSidebar,
    handleToggleRightPanel,
    focusedController,
    handleNewTerminal,
    paneLayout.focusedPaneId,
    paneLayout.isSplit,
    splitPaneEnabled,
    handleToggleFocusedPaneFullscreen,
  ])

  const { showCloseDialog, handleCloseDialogConfirm, handleCloseDialogCancel } = useCloseServiceDialog()

  // 主区：surface + RightPanel 并排。Windows 全高侧栏模式下右侧列已有标题栏横跨整个宽度
  // （覆盖 RightPanel 上方），RightPanel 天然位于标题栏下方；网页/非全高模式没有全局标题栏，
  // 需用一条与主区 chat-topbar 同高同框的顶栏线横跨主区和右侧面板上方，并将 RightPanel
  // 整体下移到该顶栏下方，视觉上和桌面端保持一致。
  // 网页/Linux 桌面端没有固定的全宽顶栏：右侧面板以浮层从右侧滑入顶栏下方。
  // 为避免盖住工作状态面板（会话信息卡片）与对话内容，把主区内容让出面板宽度，
  // 通过 --right-drawer-width 下发给对话区与底部面板；Windows/macOS 桌面走 docked，
  // 移动端右栏是覆盖式 overlay（不挤压主区），二者都恒为 0。
  const rightPanelDrawerWidth =
    !isMobilePanelLayout && !desktopFullHeightSidebar && !usesCustomDesktopTitlebar() && rightPanelOpen
      ? chatViewport.layout.rightPanel.dockedWidth || rightPanelWidth
      : 0

  // 网页/Linux 桌面端（无自定义桌面标题栏）：主区顶部那条装饰顶栏是 absolute z-10 的
  // 不透明 bg-bg-100 条。分屏时 pane 外层带 contain 形成独立层叠上下文，PaneHeader 的
  // z-20 被锁在里面，无法再与装饰条比高低，装饰条会盖住整条 pane 工具栏（表现为分屏后
  // 顶部工具栏消失）。single 模式 pane 没有这层包裹，Header 的 z-20 高于装饰条，所以只有
  // 分屏暴露问题。把 surface 抬到 z-20 即可，装饰条只在右侧面板那一列露出，仍是原来的
  // 视觉分隔线；右面板抽屉 z-30 依旧在其之上。Windows/macOS 桌面不涉及这条装饰栏，保持原样。
  const webMainAreaTopBar = !desktopFullHeightSidebar && !usesCustomDesktopTitlebar()

  const desktopMainArea = (
    <div
      className="flex-1 flex min-w-0 h-full overflow-hidden bg-bg-000 relative"
      style={{ '--right-drawer-width': `${rightPanelDrawerWidth}px` } as React.CSSProperties}
    >
      {!desktopFullHeightSidebar && (
        <div
          className="absolute top-0 left-0 right-0 z-10 pointer-events-none bg-bg-100 border-b border-border-200/60"
          style={{ height: 'var(--chat-header-height, 2.75rem)' }}
        />
      )}
      <div
        ref={surfaceRef}
        className={`flex-1 flex flex-col min-w-0 overflow-hidden ${webMainAreaTopBar ? 'z-20' : ''}`}
        style={{ minWidth: `${CHAT_SURFACE_MIN_WIDTH}px` }}
      >
        <div className="flex-1 min-h-0">
          <SplitContainer
            node={paneLayout.root}
            renderLeaf={renderPaneLeaf}
            fullscreenPaneId={paneLayout.fullscreenPaneId}
          />
        </div>

        <BottomPanel
          directory={focusedDirectory}
          serverId={focusedServerId}
          className="transition-[padding] duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]"
          style={{ paddingRight: 'var(--right-drawer-width, 0px)' }}
        />
      </div>

      {desktopFullHeightSidebar ? (
        <RightPanel directory={focusedDirectory} sessionId={paneLayout.focusedSessionId} serverId={focusedServerId} />
      ) : usesCustomDesktopTitlebar() ? (
        // Windows/macOS 桌面：标题栏已横跨面板上方且固定，面板 docked 在其下方
        <div className="flex flex-col min-w-0 h-full" style={{ paddingTop: 'var(--chat-header-height, 2.75rem)' }}>
          <div className="flex-1 min-h-0 min-w-0">
            <RightPanel
              directory={focusedDirectory}
              sessionId={paneLayout.focusedSessionId}
              serverId={focusedServerId}
            />
          </div>
        </div>
      ) : (
        // 网页/Linux：没有固定的全宽顶栏，右侧面板作为浮层从右边滑入顶栏下方，
        // 顶栏（对话区 Header）保持全宽不动，主区宽度也不被面板挤压。
        <div
          className="absolute top-0 bottom-0 right-0 z-30 flex flex-col pointer-events-none"
          style={{ paddingTop: 'var(--chat-header-height, 2.75rem)' }}
        >
          <div className="flex-1 min-h-0 min-w-0 pointer-events-auto">
            <RightPanel
              directory={focusedDirectory}
              sessionId={paneLayout.focusedSessionId}
              serverId={focusedServerId}
            />
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="relative flex h-full flex-col bg-bg-100 overflow-hidden">
      <InternalDragLayer />
      <ChatViewportProvider value={chatViewport}>
        {desktopFullHeightSidebar ? (
          // Windows 桌面：侧栏全高贯穿（竖线延伸到顶部），标题栏只覆盖主内容区上方
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            <Sidebar
              isOpen={sidebarExpanded}
              selectedSessionId={paneLayout.focusedSessionId}
              onSelectSession={handleSelectSession}
              onNewSession={handleNewSession}
              onOpen={handleOpenSidebar}
              onClose={handleCloseSidebar}
              contextLimit={focusedController?.contextLimit}
              onOpenSettings={openSettings}
              projectDialogOpen={projectDialogOpen}
              onProjectDialogClose={closeProjectDialog}
            />
            <div className="flex flex-col min-w-0 flex-1 h-full overflow-hidden">
              <DesktopTitlebar headerProps={desktopTitlebarHeaderProps} showNav={false} />
              {desktopMainArea}
            </div>
          </div>
        ) : (
          <>
            <DesktopTitlebar headerProps={desktopTitlebarHeaderProps} />
            <div className="relative flex min-h-0 flex-1 overflow-hidden">
              {/* 侧栏：移动端为覆盖式 overlay 抽屉（主界面不缩放、无 3D）；
                  桌面端为 docked 常驻列。 */}
              <Sidebar
                isOpen={sidebarExpanded}
                selectedSessionId={paneLayout.focusedSessionId}
                onSelectSession={handleSelectSession}
                onNewSession={handleNewSession}
                onOpen={handleOpenSidebar}
                onClose={handleCloseSidebar}
                contextLimit={focusedController?.contextLimit}
                onOpenSettings={openSettings}
                projectDialogOpen={projectDialogOpen}
                onProjectDialogClose={closeProjectDialog}
              />

              {/* 主界面：移动端挂左右滑动手势（右滑开侧栏、左滑开右栏）。 */}
              {isMobilePanelLayout ? (
                <div
                  className="relative flex min-h-0 min-w-0 flex-1"
                  onTouchStart={handleMainTouchStart}
                  onTouchMove={handleMainTouchMove}
                  onTouchEnd={handleMainTouchEnd}
                  onTouchCancel={handleMainTouchEnd}
                >
                  {desktopMainArea}
                </div>
              ) : (
                desktopMainArea
              )}
            </div>
            <ToastContainer onOpenAbout={openAboutSettings} />
          </>
        )}

        <Suspense fallback={null}>
          <SettingsDialog isOpen={settingsDialogOpen} onClose={closeSettings} initialTab={settingsInitialTab} />
          <ScheduledTasksDialog
            isOpen={scheduledTasksOpen}
            onClose={closeScheduledTasks}
            defaultDirectory={routeDirectory || currentDirectory || ''}
          />
          <CommandPalette
            isOpen={commandPaletteOpen}
            onClose={() => setCommandPaletteOpen(false)}
            commands={commands}
          />
        </Suspense>

        <Suspense fallback={null}>
          <CloseServiceDialog
            isOpen={showCloseDialog}
            onConfirm={handleCloseDialogConfirm}
            onCancel={handleCloseDialogCancel}
          />
        </Suspense>
      </ChatViewportProvider>
    </div>
  )
}

export default App
