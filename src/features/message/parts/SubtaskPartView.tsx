import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { SubtaskPart } from '../../../types/message'
import { useChildSessions, useSessionStatus, type ChildSessionInfo } from '../../../store'
import { useSessionNavigation } from '../../../contexts/SessionNavigationContext'
import { useDisclosureScrollLock } from '../../../hooks'
import { UsersIcon, ChevronDownIcon, LayersIcon, TerminalIcon, ReturnIcon } from '../../../components/Icons'
import { Chip } from '../../../components/ui/Chip'
import { StatusDot } from '../../../components/ui/StatusDot'
import { useUiDisclosureState } from '../../../utils/uiDisclosureState'
import { MessageExpandPanel } from '../messageExpand'
import { chevronClass, useMessageExpandRender } from '../messageExpandShared'
import { cn } from '../../../utils/cn'
import { interactive } from '../../../utils/interaction'

interface SubtaskPartViewProps {
  part: SubtaskPart
}

/**
 * 子任务 Part 视图
 *
 * 显示子 agent 任务的状态，支持：
 * 1. 折叠/展开查看进度
 * 2. 点击进入子 session 全屏视图
 */
export const SubtaskPartView = memo(function SubtaskPartView({ part }: SubtaskPartViewProps) {
  const { t } = useTranslation('message')
  const [expanded, setExpanded] = useUiDisclosureState(`message:${part.messageID}:subtask:${part.id}`, false)
  const shouldRenderBody = useMessageExpandRender(expanded)
  const { rootRef, headerRef, withScrollLock } = useDisclosureScrollLock()
  const { navigateToSession, openSessionInSplit } = useSessionNavigation()

  // 获取子 session 信息（如果已创建）
  // 注意：part.sessionID 是父 session，我们需要找到这个 subtask 创建的子 session
  // 子 session 的 parentID 应该等于 part.sessionID
  const childSessions = useChildSessions(part.sessionID)
  const parentStatus = useSessionStatus(part.sessionID)
  const parentRunning = parentStatus?.type === 'busy' || parentStatus?.type === 'retry'

  // 找到匹配这个 subtask 的子 session
  // 通常是最近创建的那个，或者通过 agent 名称匹配
  const childSession = findMatchingChildSession(childSessions, part)

  // 找不到子 session 时不能直接当成 running：父会话若已完成，子代理必然也已结束，
  // 否则历史上完成的任务会一直挂着「正在工作」。只在父会话仍在运行时才显示运行态。
  const fallbackStatus: ChildSessionInfo['status'] = parentRunning ? 'running' : 'idle'
  const status = childSession?.status ?? fallbackStatus
  const isRunning = status === 'running'

  // 进入子 session：未分屏时优先在分屏视图中打开
  const handleEnter = () => {
    if (childSession) {
      if (openSessionInSplit?.(childSession.id)) return
      navigateToSession(childSession.id)
    }
  }

  return (
    <div ref={rootRef} className="rounded-md border border-border-200/60 bg-bg-100/50 overflow-hidden">
      {/* Header */}
      <div
        ref={headerRef}
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-bg-200 transition-colors"
        onClick={() => withScrollLock(() => setExpanded(!expanded))}
      >
        {/* Status indicator */}
        <StatusDot tone={isRunning ? 'running' : status === 'error' ? 'failed' : 'completed'} className="flex-shrink-0" />

        {/* Agent icon & name */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <UsersIcon size={16} className="text-text-400 flex-shrink-0" />
          {childSession ? (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation()
                handleEnter()
              }}
              className="min-w-0 max-w-full flex-shrink text-left bg-transparent border-none p-0"
              title={t('subtask.viewFullSession')}
            >
              <SubtaskTitle part={part} status={status} isRunning={isRunning} />
            </button>
          ) : (
            <div className="flex-1 min-w-0">
              <SubtaskTitle part={part} status={status} isRunning={isRunning} />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {childSession && (
            <button
              onClick={e => {
                e.stopPropagation()
                handleEnter()
              }}
              className="px-2.5 py-1 text-[length:var(--fs-sm)] font-medium text-text-300 hover:bg-bg-200 rounded-sm transition-colors"
            >
              {t('subtask.enter')}
            </button>
          )}
          <ChevronDownIcon className={chevronClass(expanded, 'md', 'text-text-400')} />
        </div>
      </div>

      {/* Expanded content */}
      <MessageExpandPanel open={expanded} innerClassName="overflow-hidden">
        {shouldRenderBody && (
          <div className="px-4 py-3 border-t border-border-200/40 space-y-3">
            {/* Prompt preview */}
            <div>
              <p className="text-[length:var(--fs-xxs)] text-text-500 uppercase tracking-wider mb-1">{t('subtask.task')}</p>
              <p className="text-[length:var(--fs-sm)] text-text-300 whitespace-pre-wrap line-clamp-4">{part.prompt}</p>
            </div>

            {/* Model info */}
            {part.model && (
              <div className="flex items-center gap-2 text-[length:var(--fs-xxs)] text-text-500">
                <LayersIcon size={12} />
                <span>
                  {part.model.providerID}/{part.model.modelID}
                </span>
              </div>
            )}

            {/* Command (if slash command) */}
            {part.command && (
              <div className="flex items-center gap-2 text-[length:var(--fs-xxs)] text-text-500">
                <TerminalIcon size={12} />
                <span className="font-mono">{part.command}</span>
              </div>
            )}

            {/* Child session info */}
            {childSession && (
              <div className="pt-2 border-t border-border-200/30">
                <button
                  onClick={handleEnter}
                  className={cn(
                    'w-full flex items-center justify-center gap-2 py-2 text-[length:var(--fs-sm)] font-medium text-accent-main-100 rounded-sm',
                    interactive.accent,
                  )}
                >
                  <ReturnIcon size={14} />
                  {t('subtask.viewFullSession')}
                </button>
              </div>
            )}
          </div>
        )}
      </MessageExpandPanel>
    </div>
  )
})

function SubtaskTitle({ part, status, isRunning }: { part: SubtaskPart; status: string; isRunning: boolean }) {
  const { t } = useTranslation('message')

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-[length:var(--fs-base)] font-medium text-text-200 truncate">{part.agent}</span>
        {isRunning && <Chip tone="accent">{t('subtask.running')}</Chip>}
        {status === 'idle' && <Chip tone="success">{t('subtask.done')}</Chip>}
        {status === 'error' && <Chip tone="danger">{t('subtask.error')}</Chip>}
      </div>
      <p className="text-[length:var(--fs-sm)] text-text-400 truncate mt-0.5">{part.description}</p>
    </>
  )
}

/**
 * 找到匹配 subtask 的子 session
 * 策略：匹配 agent 名称，取最近创建的
 */
function findMatchingChildSession(childSessions: ChildSessionInfo[], part: SubtaskPart): ChildSessionInfo | undefined {
  if (childSessions.length === 0) return undefined

  // 优先匹配 agent 名称
  const matchingAgent = childSessions.filter(s => s.agent === part.agent)
  if (matchingAgent.length > 0) {
    // 取最近创建的
    return matchingAgent.sort((a, b) => b.createdAt - a.createdAt)[0]
  }

  // 没有匹配的 agent，取最近创建的
  return childSessions.sort((a, b) => b.createdAt - a.createdAt)[0]
}
