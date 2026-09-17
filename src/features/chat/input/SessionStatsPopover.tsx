// ============================================
// SessionStatsPopover - 点击 footer 上的速率区域弹出的会话统计面板
//
// 结构对齐 DeepSeek harness 的「会话统计」浮层：标题 + 若干「标签 / 数值」行。
// 数据来自 useSessionTurnStats，在 InputFooter 内计算后传入，避免重复订阅。
// 浮层用 Radix Popover 承载：一侧对齐触发元素，自动避让视口边缘。
// ============================================

import { useTranslation } from 'react-i18next'
import { Popover, PopoverTrigger, PopoverContent } from '../../../components/ui'
import { StatsIcon, GaugeIcon, DatabaseIcon } from '../../../components/Icons'
import { formatDuration } from '../../../utils/formatUtils'
import type { SessionTurnStats } from '../../../hooks/useSessionTurnStats'

interface SessionStatsPopoverProps {
  stats: SessionTurnStats
  tokensPerSec: number
}

export function SessionStatsPopover({ stats, tokensPerSec }: SessionStatsPopoverProps) {
  const { t } = useTranslation(['chat', 'common'])

  // 触发按钮显示「最后一轮」速率（与旧行为一致，空闲时为 0 tok/s）；
  // 面板内其余行都是整段会话的累计值，TPS 一并用会话平均，口径才统一
  const rateLabel = formatTokenRate(tokensPerSec)
  const averageRate = stats.tokensPerSec !== null ? formatTokenRate(stats.tokensPerSec) : '—'

  const rows: { label: string; value: string }[] = [
    { label: t('sessionStats.modelTime'), value: stats.modelMs > 0 ? formatDuration(stats.modelMs) : '—' },
    { label: t('sessionStats.toolTime'), value: stats.toolMs > 0 ? formatDuration(stats.toolMs) : '—' },
    {
      label: t('sessionStats.ttft'),
      value: stats.ttftMs !== null ? formatDuration(stats.ttftMs) : '—',
    },
    { label: t('sessionStats.tps'), value: averageRate },
    {
      label: t('sessionStats.cacheHit'),
      value: stats.cacheHitPercent !== null ? `${Math.round(stats.cacheHitPercent)}%` : '—',
    },
    { label: t('sessionStats.outputTokens'), value: formatTokenCount(stats.outputTokens) },
  ]

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="shrink-0 flex items-center gap-1 tabular-nums hover:text-text-100 transition-colors data-[state=open]:text-text-100"
          title={t('inputFooter.tokenRate')}
        >
          <StatsIcon size={11} className="shrink-0" />
          <span>{rateLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" sideOffset={8} className="w-72 p-0">
        <div className="flex items-center gap-2 border-b border-border-200/50 px-4 py-2.5 text-[length:var(--fs-sm)] font-medium text-text-200">
          <StatsIcon size={13} className="shrink-0 text-text-400" />
          <span>{t('sessionStats.title')}</span>
        </div>

        <dl className="flex flex-col gap-2.5 px-4 py-3.5">
          {rows.map(row => (
            <div key={row.label} className="flex items-center justify-between gap-4">
              <dt className="text-[length:var(--fs-sm)] text-text-400">{row.label}</dt>
              <dd className="text-[length:var(--fs-sm)] tabular-nums text-text-200">{row.value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex items-center justify-between gap-3 border-t border-border-200/50 px-4 py-2.5 text-[length:var(--fs-xxs)] text-text-500">
          <span className="flex items-center gap-1.5">
            <GaugeIcon size={11} className="shrink-0" />
            <span className="tabular-nums">{t('sessionStats.counts', { turns: stats.turns, steps: stats.steps })}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <DatabaseIcon size={11} className="shrink-0" />
            <span className="tabular-nums">{formatTokenCount(stats.inputTokens)}</span>
          </span>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** 速率显示：<10 保留一位小数，其余取整 */
export function formatTokenRate(rate: number): string {
  if (rate < 0.05) return '0 tok/s'
  return `${rate < 10 ? rate.toFixed(1) : Math.round(rate)} tok/s`
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}
