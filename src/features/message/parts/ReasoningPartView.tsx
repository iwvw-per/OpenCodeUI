import { memo, useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { LightbulbIcon } from '../../../components/Icons'
import { ScrollArea } from '../../../components/ui'
import { DisclosureRow } from '../../../components/ui/DisclosureRow'
import { Spinner } from '../../../components/ui/Spinner'
import { useCompositorExpand, useDisclosureScrollLock } from '../../../hooks'
import { useDelayedRender } from '../../../hooks/useDelayedRender'
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

const TICKER_WINDOW_CHARS = 220
const TICKER_FADE_MASK = 'linear-gradient(to right, transparent 0, #000 28px, #000 100%)'
/**
 * 滚动速度参数（字符/秒）。
 * 显示游标以「速度」为单位平滑推进：目标速度按落后量成比例抬升，再夹在
 * 下限/上限之间，最后每帧做低通滤波。这样常态是匀速爬行，遇到网络突发
 * 只会短暂提速追赶，而不会整行瞬移，消除跳变感。
 */
const TICKER_MIN_SPEED = 45
const TICKER_MAX_SPEED = 900
const TICKER_SPEED_GAIN = 9
const TICKER_SPEED_SMOOTH = 0.15

/**
 * 流式文本的匀速揭示器。
 *
 * 直接渲染服务端增量会让大段文本在一帧内整体跳变，速度随网络抖动忽快忽慢。
 * 这里把「已揭示长度」作为独立游标，每帧按平滑速度朝目标推进，再把末尾窗口
 * 右对齐到容器边缘；新字符从右侧匀速涌入，观感平滑。
 * 通过 ref 直接改 DOM，避免每帧触发 React 重渲染。
 */
function useTickerReveal(target: string, active: boolean) {
  const containerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLSpanElement>(null)
  const targetRef = useRef(target)
  const shownRef = useRef(0)
  const speedRef = useRef(0)
  const lastTsRef = useRef(0)
  const lastVisibleRef = useRef<string | null>(null)
  const lastWidthRef = useRef(-1)
  const rafRef = useRef(0)

  useEffect(() => {
    targetRef.current = target
    if (shownRef.current > target.length) shownRef.current = target.length
  }, [target])

  useEffect(() => {
    if (!active) {
      lastVisibleRef.current = null
      return
    }
    // 进入流式瞬间对齐到当前长度，避免把已有内容重新「播放」一遍
    shownRef.current = targetRef.current.length
    speedRef.current = 0
    lastTsRef.current = 0

    const render = (shownFloat: number) => {
      const el = innerRef.current
      const container = containerRef.current
      if (!el || !container) return

      const shown = Math.floor(shownFloat)
      let start = Math.max(0, shown - TICKER_WINDOW_CHARS)
      // 左边界落在低位代理项上时右移一格，避免把 emoji 等代理对切半
      const startCode = targetRef.current.charCodeAt(start)
      if (startCode >= 0xdc00 && startCode <= 0xdfff) start += 1
      const visible = targetRef.current.slice(start, shown)
      const width = container.clientWidth
      // 文本与容器宽度都没变时跳过 DOM 写入与 scrollWidth 测量，避免每帧强制重排
      if (visible === lastVisibleRef.current && width === lastWidthRef.current) return
      lastVisibleRef.current = visible
      lastWidthRef.current = width
      el.textContent = visible

      const overflow = el.scrollWidth - container.clientWidth
      if (overflow > 1) {
        el.style.transform = `translateX(${-overflow}px)`
        container.style.maskImage = TICKER_FADE_MASK
        container.style.webkitMaskImage = TICKER_FADE_MASK
      } else {
        el.style.transform = ''
        container.style.maskImage = ''
        container.style.webkitMaskImage = ''
      }
    }

    const tick = (ts: number) => {
      const dt = lastTsRef.current === 0 ? 0 : Math.min(0.05, (ts - lastTsRef.current) / 1000)
      lastTsRef.current = ts

      const targetLen = targetRef.current.length
      const backlog = targetLen - shownRef.current

      if (backlog > 0) {
        const desired = Math.min(TICKER_MAX_SPEED, Math.max(TICKER_MIN_SPEED, backlog * TICKER_SPEED_GAIN))
        speedRef.current += (desired - speedRef.current) * TICKER_SPEED_SMOOTH
        shownRef.current = Math.min(targetLen, shownRef.current + speedRef.current * dt)
      } else {
        speedRef.current = 0
      }

      render(shownRef.current)
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [active])

  return { containerRef, innerRef }
}

/**
 * 块状模式：固定约 5 行的容器，内部纵向滚动，上下渐隐。
 *
 * 采用 Reveal Streaming 的核心思路（committed-layout 冻结）：
 * - 已换行的整行「冻结」成独立 div（contain: content），此后永不修改，浏览器可
 *   跳过其内部重排。之前每帧整段重写 textContent，会让所有已显示行反复重排，正是抖动源。
 * - 只有一个「活跃尾行」随网络增长，重排范围被限制在这一行内。
 * - 容器 overflow-anchor: none：关闭浏览器滚动锚定，避免它在尾部插入时自作主张
 *   跳动 scrollTop（实测可达每帧数百 px）。
 * - 滚动位置用整数像素 transform 平滑逼近目标，且每帧只写 transform，不读布局；
 *   布局测量交给 ResizeObserver 异步完成。
 */
const BLOCK_HEIGHT_PX = 100
/** 每行高度（leading-5 = 20px），也是冻结块与空白行的最小高度 */
const BLOCK_LINE_PX = 20
/** 预载：可视窗口下方额外多铺 2 行，作为缓冲 */
const BLOCK_PRELOAD_PX = BLOCK_LINE_PX * 2
/** 冻结块数量上限：超出从顶部移除，避免无限增长 */
const BLOCK_MAX_BLOCKS = 80
/** 结束后折叠动画时长：块高度收拢 + 淡出，随后摘要淡入 */
const BLOCK_COLLAPSE_MS = 200
const BLOCK_FADE_MASK = 'linear-gradient(to bottom, transparent 0, #000 18%, #000 82%, transparent 100%)'
/** 滚动速度（像素/秒）：缓冲内恒定，落后超过预载时按比例提速追赶 */
const BLOCK_SCROLL_SPEED = 26
const BLOCK_SCROLL_MAX_SPEED = 600
const BLOCK_SCROLL_SMOOTH = 0.12

/** 创建一个冻结行 / 尾行元素：固定行高、保留换行、长行可断行 */
function createBlockLine(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.contain = 'content'
  el.style.minHeight = `${BLOCK_LINE_PX}px`
  el.style.whiteSpace = 'pre-wrap'
  el.style.overflowWrap = 'break-word'
  return el
}

function useBlockReveal(target: string, active: boolean) {
  const containerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const tailRef = useRef<HTMLDivElement | null>(null)
  const blocksRef = useRef<HTMLDivElement[]>([])
  const committedEndRef = useRef(0)
  const scrollYRef = useRef(0)
  const scrollSpeedRef = useRef(0)
  const scrollTargetRef = useRef(0)
  const lastTsRef = useRef(0)
  const lastTailRef = useRef('')
  const lastMaskOnRef = useRef<boolean | null>(null)
  const lastTransformRef = useRef<string>('')
  const rafRef = useRef(0)

  const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // 0) 进入流式时重建结构：清空 + 建一个活跃尾行
  useLayoutEffect(() => {
    if (!active) return
    const inner = innerRef.current
    if (!inner) return

    inner.textContent = ''
    blocksRef.current = []
    committedEndRef.current = 0
    scrollYRef.current = 0
    scrollSpeedRef.current = 0
    scrollTargetRef.current = 0
    lastTsRef.current = 0
    lastTailRef.current = ''
    lastMaskOnRef.current = null
    lastTransformRef.current = ''

    const tail = createBlockLine()
    inner.appendChild(tail)
    tailRef.current = tail
  }, [active])

  // 1) 文本同步：把已完成的整行冻结为独立块，只更新活跃尾行（网络频率）
  useEffect(() => {
    if (!active) return
    const inner = innerRef.current
    const tail = tailRef.current
    if (!inner || !tail) return

    const text = target
    // 只把「最后一个换行之前」的整行冻结；最后一行仍在生成，留在尾行
    const lastNl = text.lastIndexOf('\n')
    let committedEnd = committedEndRef.current

    if (lastNl >= committedEnd) {
      let segStart = committedEnd
      while (segStart <= lastNl) {
        const nl = text.indexOf('\n', segStart)
        if (nl === -1 || nl > lastNl) break
        const block = createBlockLine()
        block.textContent = text.slice(segStart, nl)
        inner.insertBefore(block, tail)
        blocksRef.current.push(block)
        segStart = nl + 1
      }
      committedEnd = segStart
      committedEndRef.current = committedEnd

      // 顶部裁剪：移除最旧的冻结块，并把 scrollY 等量回补，画面不跳
      const blocks = blocksRef.current
      while (blocks.length > BLOCK_MAX_BLOCKS) {
        const removed = blocks.shift()
        if (!removed) break
        const height = removed.offsetHeight
        removed.remove()
        scrollYRef.current = Math.max(0, scrollYRef.current - height)
      }
    }

    // 活跃尾行：只重写这一行（很小），其余冻结块不受影响
    const tailText = text.slice(committedEnd)
    if (tailText !== lastTailRef.current) {
      lastTailRef.current = tailText
      tail.textContent = tailText
    }
  }, [target, active])

  // 2) 滚动动画：每帧只推进游标 + 写整数像素 transform，绝不读布局
  useEffect(() => {
    if (!active) return
    if (prefersReducedMotion()) return

    const tick = (ts: number) => {
      const dt = lastTsRef.current === 0 ? 0 : Math.min(0.05, (ts - lastTsRef.current) / 1000)
      lastTsRef.current = ts

      const distance = scrollTargetRef.current - scrollYRef.current
      let desiredSpeed = 0
      if (distance > 0.5) {
        desiredSpeed = Math.min(
          BLOCK_SCROLL_MAX_SPEED,
          BLOCK_SCROLL_SPEED * (1 + Math.max(0, distance - BLOCK_PRELOAD_PX) / BLOCK_PRELOAD_PX),
        )
      }
      scrollSpeedRef.current += (desiredSpeed - scrollSpeedRef.current) * BLOCK_SCROLL_SMOOTH
      scrollYRef.current = Math.min(scrollTargetRef.current, scrollYRef.current + scrollSpeedRef.current * dt)

      const el = innerRef.current
      if (el) {
        // 整数像素，避免亚像素重复栅格化
        const y = Math.round(scrollYRef.current)
        const transform = y > 0 ? `translate3d(0, ${-y}px, 0)` : ''
        if (transform !== lastTransformRef.current) {
          lastTransformRef.current = transform
          el.style.transform = transform
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [active])

  // 3) 布局测量：ResizeObserver 异步更新滚动目标与渐隐开关
  useEffect(() => {
    if (!active) return
    const el = innerRef.current
    const container = containerRef.current
    if (!el || !container) return

    const measure = () => {
      const maxScroll = Math.max(0, el.scrollHeight - container.clientHeight)
      scrollTargetRef.current = Math.max(0, maxScroll - BLOCK_PRELOAD_PX)

      const maskOn = maxScroll > 0
      if (maskOn !== lastMaskOnRef.current) {
        lastMaskOnRef.current = maskOn
        container.style.maskImage = maskOn ? BLOCK_FADE_MASK : ''
        container.style.webkitMaskImage = maskOn ? BLOCK_FADE_MASK : ''
      }

      if (prefersReducedMotion()) {
        scrollYRef.current = scrollTargetRef.current
        const y = Math.round(scrollYRef.current)
        const transform = y > 0 ? `translate3d(0, ${-y}px, 0)` : ''
        lastTransformRef.current = transform
        el.style.transform = transform
      }
    }

    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [active])

  return { containerRef, innerRef }
}

export const ReasoningPartView = memo(function ReasoningPartView({ part, isStreaming }: ReasoningPartViewProps) {
  const { t } = useTranslation('message')
  const { reasoningDisplayMode } = useTheme()
  const rawText = part.text || ''

  const isPartStreaming = isStreaming && !part.time?.end
  const hasContent = !!rawText.trim()

  const displayText = rawText
  const [expanded, setExpanded] = useUiDisclosureState(`message:${part.messageID}:reasoning:${part.id}`, false)
  // Android expand: 展开用 max-height 假高度，避免 WebView 在 grid-rows 动画中
  // 把思考内容画成空白（滚动中展开时闪一下）。与工具壳/过程壳同款处理。
  const {
    contentRef: reasoningExpandContentRef,
    layoutOpen: reasoningLayoutOpen,
    keepMounted: reasoningKeepMounted,
    panelClassName: reasoningPanelClassName,
  } = useCompositorExpand(expanded)
  const shouldRenderBody = useMessageExpandRender(reasoningKeepMounted)
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

  const isTickerMode = reasoningDisplayMode === 'ticker'
  const tickerStreaming = isTickerMode && !!isPartStreaming
  const tickerFlat = useMemo(() => rawText.replace(/\s+/g, ' ').trim(), [rawText])
  const { containerRef: tickerContainerRef, innerRef: tickerInnerRef } = useTickerReveal(
    tickerFlat,
    tickerStreaming,
  )

  const isBlockMode = reasoningDisplayMode === 'block'
  const blockStreaming = isBlockMode && !!isPartStreaming
  const { containerRef: blockContainerRef, innerRef: blockInnerRef } = useBlockReveal(rawText, blockStreaming)

  // 块状模式的收尾动画：流式结束后块不立即换成摘要，而是保持挂载 BLOCK_COLLAPSE_MS，
  // 期间把高度收拢到 0 并淡出（collapsing），动画走完再切摘要（done）。
  // 复用 useDelayedRender 做延迟卸载，避免在 effect 体内直接 setState。
  const blockKeepMounted = useDelayedRender(blockStreaming, BLOCK_COLLAPSE_MS)
  const blockCollapsing = blockKeepMounted && !blockStreaming


  const measureSummaryOverflow = useCallback(() => {
    if (
      reasoningDisplayMode !== 'italic' &&
      reasoningDisplayMode !== 'markdown' &&
      reasoningDisplayMode !== 'ticker' &&
      reasoningDisplayMode !== 'block'
    )
      return
    const containerEl = summaryContainerRef.current
    const measureEl = summaryMeasureRef.current
    if (!containerEl || !measureEl) return
    const overflow = measureEl.scrollWidth - containerEl.clientWidth > 1
    setSummaryOverflow(prev => (prev === overflow ? prev : overflow))
  }, [reasoningDisplayMode])

  useEffect(() => {
    let frameId: number | null = null

    if ((isTickerMode || isBlockMode) && isPartStreaming) {
      if (expanded) {
        frameId = requestAnimationFrame(() => {
          setExpanded(false, { touched: false, respectUser: true })
        })
      }
    } else if (isPartStreaming && hasContent) {
      if (!expanded) {
        frameId = requestAnimationFrame(() => {
          setExpanded(true, { touched: false, respectUser: true })
        })
      }
    } else if (!isPartStreaming) {
      if (expanded) {
        frameId = requestAnimationFrame(() => {
          setExpanded(false, { touched: false, respectUser: true })
        })
      }
    }

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [hasContent, isPartStreaming, setExpanded, isTickerMode, isBlockMode, expanded])

  useEffect(() => {
    if (reasoningDisplayMode !== 'capsule') return
    if (isPartStreaming && expanded && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [displayText, isPartStreaming, expanded, reasoningDisplayMode])

  useEffect(() => {
    if (
      reasoningDisplayMode !== 'italic' &&
      reasoningDisplayMode !== 'markdown' &&
      reasoningDisplayMode !== 'ticker' &&
      reasoningDisplayMode !== 'block'
    )
      return
    if (tickerStreaming || blockStreaming) return
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
  }, [reasoningDisplayMode, summaryText, measureSummaryOverflow, tickerStreaming, blockStreaming])

  if (!hasContent) return null

  if (tickerStreaming) {
    return (
      <div ref={rootRef} className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-1.5 items-start">
        <span className="mt-1 inline-flex h-5 w-4 shrink-0 items-center justify-center text-text-500">
          <Spinner size="sm" tone="muted" variant="drive" />
        </span>
        <div ref={tickerContainerRef} className={`relative flex min-w-0 overflow-hidden ${MSG_SPACING.header}`}>
          <span
            ref={tickerInnerRef}
            className="shrink-0 text-[length:var(--fs-sm)] leading-5 reasoning-shimmer-text whitespace-nowrap"
          />
        </div>
        <span className="sr-only" role="status" aria-live="polite">
          {tickerFlat}
        </span>
      </div>
    )
  }

  if (isBlockMode && blockKeepMounted) {
    const collapsing = blockCollapsing
    return (
      <div ref={rootRef} className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-1.5 items-start">
        <span className="mt-1 inline-flex h-5 w-4 shrink-0 items-center justify-center text-text-500">
          {collapsing ? <LightbulbIcon size={13} /> : <Spinner size="sm" tone="muted" variant="drive" />}
        </span>
        <div
          ref={blockContainerRef}
          className={`relative overflow-hidden ${MSG_SPACING.header}`}
          style={{
            height: collapsing ? 0 : BLOCK_HEIGHT_PX,
            opacity: collapsing ? 0 : 1,
            contain: 'layout paint',
            overflowAnchor: 'none',
            transition: `height ${BLOCK_COLLAPSE_MS}ms cubic-bezier(0.25, 1, 0.5, 1), opacity ${BLOCK_COLLAPSE_MS}ms ease-out`,
          }}
        >
          {collapsing ? (
            <div className="block text-[length:var(--fs-sm)] leading-5 text-text-400 whitespace-pre-wrap break-words">
              {displayText}
            </div>
          ) : (
            <div
              ref={blockInnerRef}
              className="block text-[length:var(--fs-sm)] leading-5 text-text-400"
              style={{ willChange: 'transform', backfaceVisibility: 'hidden', overflowAnchor: 'none' }}
            />
          )}
        </div>
        <span className="sr-only" role="status" aria-live="polite">
          {displayText}
        </span>
      </div>
    )
  }

  if (
    reasoningDisplayMode === 'italic' ||
    reasoningDisplayMode === 'markdown' ||
    reasoningDisplayMode === 'ticker' ||
    reasoningDisplayMode === 'block'
  ) {
    const isMarkdownMode =
      reasoningDisplayMode === 'markdown' || reasoningDisplayMode === 'ticker' || reasoningDisplayMode === 'block'
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
          icon={isPartStreaming ? <Spinner size="sm" tone="muted" variant="drive" /> : <LightbulbIcon size={13} />}
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

        <MessageExpandPanel
          open={reasoningLayoutOpen}
          panelClassName={reasoningPanelClassName}
          contentRef={reasoningExpandContentRef}
          clip
        >
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
      <div className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-1.5 items-start">
        {/* 静态单行：无可折叠内容。mt-1 让 h-5 图标盒与右侧 py-1 + leading-5 的首行行盒同心 */}
        <span className="mt-1 inline-flex h-5 w-4 shrink-0 items-center justify-center text-text-500">
          {isPartStreaming ? <Spinner size="sm" tone="muted" variant="drive" /> : <LightbulbIcon size={13} />}
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
        icon={isPartStreaming ? <Spinner size="md" tone="current" variant="drive" /> : <LightbulbIcon className="shrink-0" size={14} />}
        label={
          <span className="text-[length:var(--fs-sm)] font-medium leading-5 whitespace-nowrap text-left">
            {isPartStreaming ? t('reasoning.thinking') : t('reasoning.thinkingLabel')}
          </span>
        }
      />

      <MessageExpandPanel
        open={reasoningLayoutOpen}
        panelClassName={reasoningPanelClassName}
        contentRef={reasoningExpandContentRef}
        clip
      >
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
