import { memo, useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { LightbulbIcon } from '../../../components/Icons'
import { ScrollArea } from '../../../components/ui'
import { DisclosureRow } from '../../../components/ui/DisclosureRow'
import { Spinner } from '../../../components/ui/Spinner'
import { useDisclosureScrollLock } from '../../../hooks'
import { useTheme } from '../../../hooks/useTheme'
import { MarkdownRenderer } from '../../../components/MarkdownRenderer'
import type { ReasoningPart } from '../../../types/message'
import { useUiDisclosureState } from '../../../utils/uiDisclosureState'
import { MSG_SPACING } from '../messageSpacing'
import { MessageExpandPanel } from '../messageExpand'
import { useMessageExpandRender } from '../messageExpandShared'
import { firstMeaningfulLine } from './reasoningSummary'

interface ReasoningPartViewProps {
  part: ReasoningPart
  isStreaming?: boolean
}

export const ReasoningPartView = memo(function ReasoningPartView({ part, isStreaming }: ReasoningPartViewProps) {
  const { t } = useTranslation('message')
  const { reasoningDisplayMode } = useTheme()
  const rawText = part.text || ''

  const isPartStreaming = isStreaming && !part.time?.end
  const hasContent = !!rawText.trim()

  const displayText = rawText
  const [expanded, setExpanded] = useUiDisclosureState(`message:${part.messageID}:reasoning:${part.id}`, false)
  const shouldRenderBody = useMessageExpandRender(expanded)
  const { rootRef, headerRef, withScrollLock } = useDisclosureScrollLock()
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const summaryContainerRef = useRef<HTMLDivElement>(null)
  const summaryMeasureRef = useRef<HTMLSpanElement>(null)
  const [summaryOverflow, setSummaryOverflow] = useState(false)
  const toggleExpanded = useCallback(() => {
    withScrollLock(() => setExpanded(!expanded))
  }, [expanded, setExpanded, withScrollLock])

  const collapsedPreview = useMemo(() => (displayText || '').replace(/\s+/g, ' ').trim(), [displayText])
  // markdown 折叠取第一条有内容的行（跳过代码块/分隔线），避免摘要只剩 ``` 这类符号
  const collapsedMarkdownPreview = useMemo(
    () => firstMeaningfulLine(displayText) || collapsedPreview,
    [displayText, collapsedPreview],
  )
  const thoughtDurationLabel = useMemo(() => {
    const start = part.time?.start
    const end = part.time?.end
    if (!start || !end || end <= start) return null
    const durationMs = end - start
    if (durationMs < 1000) return `${Math.max(1, Math.round(durationMs))}ms`
    if (durationMs < 10000) return `${(durationMs / 1000).toFixed(1)}s`
    return `${Math.round(durationMs / 1000)}s`
  }, [part.time?.start, part.time?.end])
  const summaryText = collapsedPreview || (isPartStreaming ? t('reasoning.thinking') : '')
  const hasLineBreak = /[\r\n]/.test(rawText)

  const measureSummaryOverflow = useCallback(() => {
    if (reasoningDisplayMode !== 'italic' && reasoningDisplayMode !== 'markdown') return
    const containerEl = summaryContainerRef.current
    const measureEl = summaryMeasureRef.current
    if (!containerEl || !measureEl) return
    const overflow = measureEl.scrollWidth - containerEl.clientWidth > 1
    setSummaryOverflow(prev => (prev === overflow ? prev : overflow))
  }, [reasoningDisplayMode])

  useEffect(() => {
    let frameId: number | null = null

    if (isPartStreaming && hasContent) {
      frameId = requestAnimationFrame(() => {
        setExpanded(true, { touched: false, respectUser: true })
      })
    } else if (!isPartStreaming) {
      frameId = requestAnimationFrame(() => {
        setExpanded(false, { touched: false, respectUser: true })
      })
    }

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [hasContent, isPartStreaming, setExpanded])

  useEffect(() => {
    if (reasoningDisplayMode !== 'capsule') return
    if (isPartStreaming && expanded && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [displayText, isPartStreaming, expanded, reasoningDisplayMode])

  useEffect(() => {
    if (reasoningDisplayMode !== 'italic' && reasoningDisplayMode !== 'markdown') return
    measureSummaryOverflow()

    const raf = requestAnimationFrame(measureSummaryOverflow)
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && summaryContainerRef.current) {
      ro = new ResizeObserver(measureSummaryOverflow)
      ro.observe(summaryContainerRef.current)
    }

    const fontsReady = document.fonts?.ready
    if (fontsReady && typeof fontsReady.then === 'function') {
      fontsReady.then(() => measureSummaryOverflow()).catch(() => {})
    }

    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
    }
  }, [reasoningDisplayMode, summaryText, measureSummaryOverflow])

  if (!hasContent) return null

  if (reasoningDisplayMode === 'italic' || reasoningDisplayMode === 'markdown') {
    const isMarkdownMode = reasoningDisplayMode === 'markdown'
    const shouldUseToggle = isPartStreaming || hasLineBreak || summaryOverflow
    const expandedMetaText = isPartStreaming
      ? t('reasoning.thinking')
      : thoughtDurationLabel
        ? t('reasoning.thoughtFor', { duration: thoughtDurationLabel })
        : t('reasoning.thoughtProcess')
    // 展开态状态行：inline-block 按文字宽度铺渐变（block 会铺满父级，短词像整段闪）
    // italic 模式保留斜体；扫光靠 layout，不靠去掉 italic
    const expandedMetaClassName = [
      'inline-block text-[length:var(--fs-sm)] leading-5',
      isMarkdownMode ? '' : 'italic',
      isPartStreaming ? 'reasoning-shimmer-text' : 'text-text-500',
    ]
      .filter(Boolean)
      .join(' ')
    const summaryClassName = isPartStreaming
      ? 'text-[length:var(--fs-sm)] leading-5 text-text-300 whitespace-nowrap overflow-hidden text-ellipsis'
      : 'text-[length:var(--fs-sm)] leading-5 text-text-400 whitespace-nowrap overflow-hidden text-ellipsis'
    // 折叠态 markdown：只渲染第一行 + 单行省略号（对齐斜体）
    const collapsedMarkdownClassName = [
      'h-5 max-h-5 overflow-hidden whitespace-nowrap text-ellipsis',
      isPartStreaming ? 'text-text-300' : 'text-text-400',
      isPartStreaming ? 'reasoning-shimmer-text' : '',
      // 第一行 markdown 压成单行，才能吃到 text-ellipsis
      '[&_.markdown-stream-block]:!my-0 [&_.markdown-stream-block]:inline',
      '[&_p]:!my-0 [&_p]:inline',
      '[&_h1]:!my-0 [&_h1]:inline [&_h2]:!my-0 [&_h2]:inline [&_h3]:!my-0 [&_h3]:inline',
      '[&_ul]:!my-0 [&_ol]:!my-0 [&_li]:inline [&_li]:!my-0',
      '[&_pre]:!my-0 [&_pre]:inline',
      '[&_code]:inline',
      '[&_blockquote]:!my-0 [&_blockquote]:inline',
      '[&_br]:hidden',
    ].join(' ')

    // 与工具 steps / 过程折叠块对齐：统一走 DisclosureRow（py-1 行高 + chevron）
    const content = shouldUseToggle ? (
      <div className="flex flex-col">
        <DisclosureRow
          ref={headerRef}
          expanded={expanded}
          onClick={toggleExpanded}
          size="sm"
          className="group/reasoning"
          truncateLabel={false}
          labelTone="idle"
          icon={isPartStreaming ? <Spinner size="sm" tone="muted" variant="pixel" /> : <LightbulbIcon size={13} />}
          label={
            <span ref={summaryContainerRef} className="relative block min-w-0 max-w-full overflow-hidden">
              <span className="relative block min-w-0 max-w-full">
                {expanded ? (
                  <span className={expandedMetaClassName}>{expandedMetaText}</span>
                ) : isMarkdownMode ? (
                  <div className={`min-w-0 text-[length:var(--fs-sm)] leading-5 ${collapsedMarkdownClassName}`}>
                    <MarkdownRenderer
                      content={collapsedMarkdownPreview}
                      variant="reasoning"
                      isStreaming={isPartStreaming}
                    />
                  </div>
                ) : (
                  <span
                    className={[
                      'block min-w-0 italic',
                      summaryClassName,
                      isPartStreaming ? 'reasoning-shimmer-text' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {summaryText}
                  </span>
                )}
              </span>
              <span
                ref={summaryMeasureRef}
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 invisible whitespace-nowrap text-[length:var(--fs-sm)] leading-5 ${
                  isMarkdownMode ? '' : 'italic'
                }`}
              >
                {summaryText}
              </span>
            </span>
          }
        />

        <MessageExpandPanel open={expanded} clip>
          {shouldRenderBody &&
            (isMarkdownMode ? (
              <div className={`${MSG_SPACING.body} text-[length:var(--fs-sm)]`}>
                <MarkdownRenderer content={displayText} variant="reasoning" isStreaming={isPartStreaming} />
              </div>
            ) : (
              <div
                className={`${MSG_SPACING.body} text-[length:var(--fs-sm)] leading-6 italic whitespace-pre-wrap break-words overflow-x-hidden text-text-400`}
              >
                {displayText}
              </div>
            ))}
        </MessageExpandPanel>
      </div>
    ) : (
      <div className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-1.5 items-start">
        {/* 静态单行：无可折叠内容。mt-1 让 h-5 图标盒与右侧 py-1 + leading-5 的首行行盒同心 */}
        <span className="mt-1 inline-flex h-5 w-[14px] shrink-0 items-center justify-center text-text-500">
          {isPartStreaming ? <Spinner size="sm" tone="muted" variant="pixel" /> : <LightbulbIcon size={13} />}
        </span>
        <div
          ref={summaryContainerRef}
          className={`relative min-w-0 overflow-hidden ${MSG_SPACING.header} text-[length:var(--fs-sm)]`}
        >
          {isMarkdownMode ? (
            <MarkdownRenderer content={displayText} variant="reasoning" isStreaming={isPartStreaming} />
          ) : (
            <span className="block min-w-0 text-[length:var(--fs-sm)] leading-5 italic whitespace-pre-wrap break-words text-text-400">
              {displayText}
            </span>
          )}
          <span
            ref={summaryMeasureRef}
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 invisible whitespace-nowrap text-[length:var(--fs-sm)] leading-5 ${
              isMarkdownMode ? '' : 'italic'
            }`}
          >
            {summaryText}
          </span>
        </div>
      </div>
    )

    return (
      <div ref={rootRef}>
        {content}

        <span className="sr-only" role="status" aria-live="polite">
          {summaryText}
        </span>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className={`ring-1 ring-inset ring-border-300/20 rounded-lg overflow-hidden transition-all duration-300 ease-out ${
        expanded ? 'w-full' : 'w-[260px]'
      }`}
    >
      <DisclosureRow
        ref={headerRef}
        expanded={expanded}
        onClick={toggleExpanded}
        disabled={!hasContent && !isPartStreaming}
        inset={false}
        size="md"
        className={`grid grid-cols-[14px_minmax(0,1fr)_14px] gap-x-1.5 rounded-none text-text-500 ${
          !hasContent ? 'cursor-default' : ''
        }`}
        icon={isPartStreaming ? <Spinner size="md" tone="current" variant="pixel" /> : <LightbulbIcon className="shrink-0" size={14} />}
        label={
          <span className="text-[length:var(--fs-sm)] font-medium leading-5 whitespace-nowrap text-left">
            {isPartStreaming ? t('reasoning.thinking') : t('reasoning.thinkingLabel')}
          </span>
        }
      />

      <MessageExpandPanel open={expanded} clip>
        {shouldRenderBody && (
          <ScrollArea ref={scrollAreaRef} maxHeight={192} className="border-t border-border-300/20 bg-bg-200/30">
            <div className="px-2 py-2 text-text-400 text-[length:var(--fs-sm)] font-mono whitespace-pre-wrap break-words overflow-x-hidden">
              {displayText}
            </div>
          </ScrollArea>
        )}
      </MessageExpandPanel>
    </div>
  )
})
