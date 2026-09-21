// ============================================
// WorkStatus sections — 各板块实现
// ============================================
//
// 每个板块在无内容时返回 null，面板因此向顶部收拢，而不是为空气留位置。
//
// 数据全部复用既有 store / hook：不新增轮询，MCP 与 Skills 走一次性懒加载。

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckIcon,
  CircleIcon,
  ClockIcon,
  DatabaseIcon,
  GitBranchIcon,
  LayersIcon,
  PinIcon,
  PlugIcon,
  StatsIcon,
  TeachIcon,
  UsersIcon,
} from '../../components/Icons'
import { Spinner } from '../../components/ui/Spinner'
import { Switch } from '../../components/ui/Switch'
import { getDirectoryName } from '../../utils/directoryUtils'
import { formatCost, formatDuration } from '../../utils/formatUtils'
import { useTodos } from '../../store/todoStore'
import { useChildSessions } from '../../store/childSessionStore'
import { pinnedMessagesStore, usePinnedMessages } from '../../store/pinnedMessagesStore'
import { useSessionStatsFor } from '../../hooks/useSessionStatsFor'
import { useSessionTurnStats } from '../../hooks/useSessionTurnStats'
import { useVcsInfo } from '../../hooks/useVcsInfo'
import { getMcpStatus, connectMcpServer, disconnectMcpServer } from '../../api/mcp'
import { getSkills } from '../../api/skill'
import {
  WorkStatusCollapsibleSection,
  WorkStatusMeter,
  WorkStatusRow,
  WorkStatusRowAction,
  WorkStatusRows,
  WorkStatusSection,
  WorkStatusValue,
} from './WorkStatusPrimitives'
import type { MCPStatus } from '../../types/api/mcp'

export interface WorkStatusSectionContext {
  sessionId: string | null
  directory?: string
  serverId?: string
  contextLimit: number
  onScrollToMessage: (messageId: string) => void
}

// ─── 会话：上下文占用 + 成本 ──────────────────

const DEFAULT_CONTEXT_LIMIT = 200_000

export const WorkStatusSessionSection = memo(function WorkStatusSessionSection({
  sessionId,
  contextLimit,
}: WorkStatusSectionContext) {
  const { t } = useTranslation('chat')
  const limit = contextLimit > 0 ? contextLimit : DEFAULT_CONTEXT_LIMIT
  const stats = useSessionStatsFor(sessionId, limit)
  const hasUsage = stats.contextUsed > 0
  const percent = hasUsage ? stats.contextPercent : null
  const cost = stats.totalCost > 0 ? stats.totalCost : null

  const rounded = percent === null ? null : Math.round(percent)
  const meterColor =
    rounded === null
      ? 'hsl(var(--success-100))'
      : rounded >= 90
        ? 'hsl(var(--danger-100))'
        : rounded >= 70
          ? 'hsl(var(--warning-100))'
          : 'hsl(var(--success-100))'

  // 标题常驻：新会话 / 空白窗口还没有 token 用量，但「会话」这一段仍要可辨识，
  // 否则刚开面板会像缺了一块。用量行与进度条则只在有数据时出现。
  return (
    <WorkStatusSection title={t('workStatus.section.session')}>
      {hasUsage ? (
        <>
          <WorkStatusRow
            icon={<DatabaseIcon size={14} />}
            label={t('workStatus.context.label')}
            value={
              <>
                <WorkStatusValue>{percent === null ? '\u2014' : `${Math.min(percent, 999).toFixed(1)}%`}</WorkStatusValue>
                {cost !== null ? <WorkStatusValue tone="muted">{formatCost(cost)}</WorkStatusValue> : null}
              </>
            }
          />
          <WorkStatusMeter percent={percent ?? 0} color={meterColor} />
        </>
      ) : (
        <WorkStatusRow label={t('workStatus.context.label')} value={<WorkStatusValue tone="muted">—</WorkStatusValue>} />
      )}
    </WorkStatusSection>
  )
})

// ─── 项目：名称 + 分支 ────────────────────────

export const WorkStatusProjectSection = memo(function WorkStatusProjectSection({
  directory,
  serverId,
}: WorkStatusSectionContext) {
  const { t } = useTranslation('chat')
  const { vcsInfo, isLoading } = useVcsInfo(directory, serverId)
  const projectLabel = directory ? getDirectoryName(directory) : null
  const branch = vcsInfo?.branch?.trim() || null
  // 非 git 仓库时 vcsInfo 已返回（branch 为 null），此时不再是「加载中」。
  // 只有首次、尚无任何结果时才显示转圈，避免轮询期间一直闪。
  const showLoading = isLoading && vcsInfo === null

  if (!projectLabel && !branch && !showLoading) return null

  return (
    <WorkStatusSection
      title={t('workStatus.section.project')}
      icon={<GitBranchIcon size={14} />}
      summary={projectLabel}
    >
      {branch || showLoading ? (
        <WorkStatusRow
          icon={<GitBranchIcon size={14} />}
          label={
            branch ? (
              <span className="font-mono">{branch}</span>
            ) : (
              <Spinner size="xs" tone="muted" />
            )
          }
        />
      ) : null}
    </WorkStatusSection>
  )
})

// ─── 轮次统计 ─────────────────────────────────

export const WorkStatusTurnStatsSection = memo(function WorkStatusTurnStatsSection({
  sessionId,
}: WorkStatusSectionContext) {
  const { t } = useTranslation('chat')
  const stats = useSessionTurnStats(sessionId)
  if (stats.turns === 0 && stats.steps === 0) return null

  return (
    <WorkStatusCollapsibleSection
      title={t('workStatus.section.turnStats')}
      icon={<StatsIcon size={14} />}
      id="turnStats"
      summary={t('workStatus.turnStats.summary', { turns: stats.turns, steps: stats.steps })}
    >
      <WorkStatusRows>
        <WorkStatusRow
          label={t('workStatus.turnStats.modelTime')}
          value={stats.modelMs > 0 ? formatDuration(stats.modelMs) : '—'}
        />
        <WorkStatusRow
          label={t('workStatus.turnStats.toolTime')}
          value={stats.toolMs > 0 ? formatDuration(stats.toolMs) : '—'}
        />
        <WorkStatusRow
          label={t('workStatus.turnStats.ttft')}
          value={stats.ttftMs !== null ? formatDuration(stats.ttftMs) : '—'}
        />
        <WorkStatusRow
          label={t('workStatus.turnStats.tps')}
          value={stats.tokensPerSec !== null ? `${stats.tokensPerSec.toFixed(1)} tok/s` : '—'}
        />
        <WorkStatusRow
          label={t('workStatus.turnStats.cacheHit')}
          value={stats.cacheHitPercent !== null ? `${Math.round(stats.cacheHitPercent)}%` : '—'}
        />
      </WorkStatusRows>
    </WorkStatusCollapsibleSection>
  )
})

// ─── 子代理 ───────────────────────────────────

export const WorkStatusSubagentsSection = memo(function WorkStatusSubagentsSection({
  sessionId,
}: WorkStatusSectionContext) {
  const { t } = useTranslation('chat')
  const children = useChildSessions(sessionId)
  if (children.length === 0) return null

  const busyCount = children.filter(child => child.status === 'running').length

  return (
    <WorkStatusCollapsibleSection
      title={t('workStatus.section.subagents')}
      icon={<UsersIcon size={14} />}
      id="subagents"
      summary={busyCount > 0 ? `${busyCount}/${children.length}` : String(children.length)}
    >
      <WorkStatusRows className="max-h-56 overflow-y-auto">
        {children.map(child => (
          <WorkStatusRow
            key={child.id}
            label={child.title}
            value={
              child.status === 'running' ? (
                <WorkStatusValue tone="info">{t('workStatus.subagent.working')}</WorkStatusValue>
              ) : child.status === 'error' ? (
                <WorkStatusValue tone="error">{t('workStatus.subagent.failed')}</WorkStatusValue>
              ) : (
                <WorkStatusValue tone="muted">{t('workStatus.subagent.done')}</WorkStatusValue>
              )
            }
          />
        ))}
      </WorkStatusRows>
    </WorkStatusCollapsibleSection>
  )
})

// ─── 任务 ─────────────────────────────────────

const STATUS_RANK: Record<string, number> = { in_progress: 0, pending: 1, completed: 2 }

function TodoStatusIcon({ status }: { status: string }) {
  if (status === 'in_progress') return <CircleIcon size={13} className="text-info-100" />
  if (status === 'completed') return <CheckIcon size={13} className="text-success-100" />
  return <ClockIcon size={13} className="text-text-500" />
}

export const WorkStatusTasksSection = memo(function WorkStatusTasksSection({
  sessionId,
}: WorkStatusSectionContext) {
  const { t } = useTranslation('chat')
  const todos = useTodos(sessionId)

  // 先做、再做待办、最后已完成：面板自上而下回答「现在在做什么」，
  // 已完成项永远不是答案。与输入框下拉不同，完成项保留——这是会话记录，不是待清队列。
  const visibleTodos = useMemo(
    () =>
      todos
        .map((todo, index) => ({ todo, index }))
        .filter(({ todo }) => todo.status !== 'cancelled')
        .sort((left, right) => {
          const rank = (STATUS_RANK[left.todo.status] ?? 1) - (STATUS_RANK[right.todo.status] ?? 1)
          return rank !== 0 ? rank : left.index - right.index
        })
        .map(({ todo }) => todo),
    [todos],
  )

  if (visibleTodos.length === 0) return null

  const doneCount = visibleTodos.filter(todo => todo.status === 'completed').length
  const activeTodo = visibleTodos.find(todo => todo.status === 'in_progress')

  const renderRow = (todo: (typeof visibleTodos)[number], key: string) => {
    const done = todo.status === 'completed'
    return (
      <WorkStatusRow
        key={key}
        leading={<TodoStatusIcon status={todo.status} />}
        muted={done}
        label={<span className={done ? 'line-through' : undefined}>{todo.content}</span>}
      />
    )
  }

  return (
    <WorkStatusCollapsibleSection
      title={t('workStatus.section.todos')}
      icon={<LayersIcon size={14} />}
      id="tasks"
      summary={`${doneCount}/${visibleTodos.length}`}
      collapsedContent={activeTodo ? <WorkStatusRows>{renderRow(activeTodo, 'collapsed-active')}</WorkStatusRows> : null}
    >
      <WorkStatusRows>
        {visibleTodos.map((todo, index) => renderRow(todo, `${todo.status}-${index}-${todo.content}`))}
      </WorkStatusRows>
    </WorkStatusCollapsibleSection>
  )
})

// ─── MCP ──────────────────────────────────────

export const WorkStatusMcpSection = memo(function WorkStatusMcpSection({
  directory,
}: WorkStatusSectionContext) {
  const { t } = useTranslation('chat')
  const [status, setStatus] = useState<Record<string, MCPStatus> | null>(null)
  const [busyServer, setBusyServer] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setStatus(await getMcpStatus(directory))
    } catch {
      setStatus({})
    }
  }, [directory])

  useEffect(() => {
    void load()
  }, [load])

  const servers = useMemo(
    () => Object.entries(status ?? {}).sort(([left], [right]) => left.localeCompare(right)),
    [status],
  )
  const connectedCount = servers.filter(([, entry]) => entry?.status === 'connected').length

  const handleToggle = useCallback(
    async (name: string, next: boolean) => {
      setBusyServer(name)
      try {
        if (next) await connectMcpServer(name, directory)
        else await disconnectMcpServer(name, directory)
        // 后端处理有延迟，稍等再拉一次状态
        await new Promise(resolve => setTimeout(resolve, 500))
        await load()
      } catch {
        // 失败时重读，让开关回到真实状态
        await load()
      } finally {
        setBusyServer(current => (current === name ? null : current))
      }
    },
    [directory, load],
  )

  if (servers.length === 0) return null

  return (
    <WorkStatusCollapsibleSection
      title={t('workStatus.section.mcp')}
      icon={<PlugIcon size={14} />}
      id="mcp"
      summary={`${connectedCount}/${servers.length}`}
    >
      <WorkStatusRows>
        {servers.map(([name, entry]) => {
          const connected = entry?.status === 'connected'
          const busy = busyServer === name
          const needsAuth = entry?.status === 'needs_auth' || entry?.status === 'needs_client_registration'
          const failed = entry?.status === 'failed'
          return (
            <WorkStatusRow
              key={name}
              leading={
                // scale 不改变布局盒，所以外层给一个等于缩放后宽度的定宽容器，
                // 同板块各行的名称才会左对齐（36 × 0.72 ≈ 26px）
                <span className="inline-flex w-[26px] shrink-0 items-center">
                  <Switch
                    checked={connected}
                    disabled={busy}
                    className="origin-left scale-[0.72]"
                    aria-label={t('workStatus.mcp.toggle', { name })}
                    onCheckedChange={checked => void handleToggle(name, checked)}
                  />
                </span>
              }
              label={name}
              muted={!connected}
              value={
                needsAuth ? (
                  <WorkStatusRowAction tone="warning" disabled={busy} onClick={() => void load()}>
                    {t('workStatus.mcp.needsAuth')}
                  </WorkStatusRowAction>
                ) : failed ? (
                  <WorkStatusRowAction tone="error" disabled={busy} onClick={() => void handleToggle(name, true)}>
                    {t('workStatus.mcp.failed')}
                  </WorkStatusRowAction>
                ) : undefined
              }
            />
          )
        })}
      </WorkStatusRows>
    </WorkStatusCollapsibleSection>
  )
})

// ─── 已固定的消息 ─────────────────────────────

export const WorkStatusPinnedSection = memo(function WorkStatusPinnedSection({
  sessionId,
  onScrollToMessage,
}: WorkStatusSectionContext) {
  const { t } = useTranslation('chat')
  const pinned = usePinnedMessages(sessionId)

  if (pinned.length === 0) return null

  return (
    <WorkStatusCollapsibleSection
      title={t('workStatus.section.pinnedMessages')}
      icon={<PinIcon size={14} />}
      id="pinnedMessages"
      summary={String(pinned.length)}
    >
      {pinned.map(entry => (
        <WorkStatusRow
          key={entry.messageId}
          leading={
            <button
              type="button"
              aria-label={t('workStatus.pinned.unpin')}
              onClick={event => {
                event.stopPropagation()
                if (sessionId) pinnedMessagesStore.unpin(sessionId, entry.messageId)
              }}
              className="shrink-0 rounded p-0.5 text-accent-main-100 transition-opacity hover:opacity-70"
            >
              <PinIcon size={13} />
            </button>
          }
          muted
          label={entry.excerpt || t('workStatus.pinned.unavailable')}
          onClick={() => onScrollToMessage(entry.messageId)}
          ariaLabel={t('workStatus.pinned.reveal')}
        />
      ))}
    </WorkStatusCollapsibleSection>
  )
})

// ─── 上下文来源 ───────────────────────────────

export const WorkStatusContextSourcesSection = memo(function WorkStatusContextSourcesSection({
  directory,
}: WorkStatusSectionContext) {
  const { t } = useTranslation('chat')
  const [skillCount, setSkillCount] = useState<number | null>(null)
  const [mcpCount, setMcpCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const skills = await getSkills(directory)
        if (!cancelled) setSkillCount(skills.length)
      } catch {
        if (!cancelled) setSkillCount(0)
      }
      try {
        // 只数已连接的服务器：断开的服务器对上下文没有贡献，
        // 在这里计入会和上方的 MCP 板块自相矛盾
        const status = await getMcpStatus(directory)
        if (!cancelled) {
          setMcpCount(Object.values(status).filter(entry => entry?.status === 'connected').length)
        }
      } catch {
        if (!cancelled) setMcpCount(0)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [directory])

  const resolvedSkills = skillCount ?? 0
  const resolvedMcp = mcpCount ?? 0
  if (skillCount === null && mcpCount === null) return null
  if (resolvedSkills === 0 && resolvedMcp === 0) return null

  const summaryParts: string[] = []
  if (resolvedSkills > 0) summaryParts.push(t('workStatus.breakdown.skillCount', { count: resolvedSkills }))
  if (resolvedMcp > 0) summaryParts.push(t('workStatus.breakdown.mcpCount', { count: resolvedMcp }))

  return (
    <WorkStatusCollapsibleSection
      title={t('workStatus.section.contextSources')}
      icon={<TeachIcon size={14} />}
      id="contextSources"
      summary={summaryParts.join(' · ')}
    >
      <WorkStatusRow label={t('workStatus.breakdown.skills')} value={String(resolvedSkills)} />
      <WorkStatusRow label={t('workStatus.breakdown.mcp')} value={String(resolvedMcp)} />
    </WorkStatusCollapsibleSection>
  )
})
