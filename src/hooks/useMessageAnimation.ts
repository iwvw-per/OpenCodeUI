import { useCallback, useRef, useEffect } from 'react'

interface AnimationRefs {
  messageRefs: Map<string, HTMLElement>
  inputBoxRef: HTMLElement | null
}

export function useMessageAnimation() {
  const refs = useRef<AnimationRefs>({
    messageRefs: new Map(),
    inputBoxRef: null,
  })

  // 追踪所有 timeout，用于清理
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  // 输入框脉冲动画句柄（WAAPI）。脉冲必须走 Web Animations API：输入框本体
  // [data-input-box] 的 width/height/border-radius 过渡由 CSS 的 data-morphing
  // 列表驱动，写内联 style.transition 会整条覆盖该列表、把进行中的收起/展开
  // 过渡打断成瞬跳；WAAPI 动画独立于 style.transition，不会干扰几何变形。
  const pulseAnimationsRef = useRef<Set<globalThis.Animation>>(new Set())

  const cancelPulses = useCallback(() => {
    pulseAnimationsRef.current.forEach(animation => animation.cancel())
    pulseAnimationsRef.current.clear()
  }, [])

  // 清理所有 timeout
  useEffect(() => {
    const timeouts = timeoutsRef.current

    return () => {
      timeouts.forEach(id => clearTimeout(id))
      timeouts.clear()
    }
  }, [])

  // 输入框脉冲
  useEffect(() => {
    return () => {
      cancelPulses()
    }
  }, [cancelPulses])

  // 包装 setTimeout，自动追踪和清理
  const safeTimeout = useCallback((fn: () => void, delay: number) => {
    const id = setTimeout(() => {
      timeoutsRef.current.delete(id)
      fn()
    }, delay)
    timeoutsRef.current.add(id)
    return id
  }, [])

  const pulseInputBox = useCallback(
    (frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const inputBoxEl = refs.current.inputBoxRef
      if (!inputBoxEl || typeof inputBoxEl.animate !== 'function') return
      cancelPulses()
      const animation = inputBoxEl.animate(frames, { fill: 'none', ...options })
      pulseAnimationsRef.current.add(animation)
      animation.onfinish = () => pulseAnimationsRef.current.delete(animation)
      return animation
    },
    [cancelPulses],
  )

  // 注册消息元素（所有消息都注册，不只是用户消息）
  const registerMessage = useCallback((id: string, element: HTMLElement | null) => {
    if (element) {
      refs.current.messageRefs.set(id, element)
    } else {
      refs.current.messageRefs.delete(id)
    }
  }, [])

  // 注册输入框元素
  const registerInputBox = useCallback((element: HTMLElement | null) => {
    refs.current.inputBoxRef = element
  }, [])

  // 撤销动画：消息淡出 + 输入框脉冲
  // messageIds: 要撤销的所有消息 ID（包括用户消息和助手消息）
  const animateUndo = useCallback(
    (messageIds: string[]): Promise<void> => {
      return new Promise(resolve => {
        // 给每个消息添加消失动画，带有交错延迟
        messageIds.forEach((id, index) => {
          const el = refs.current.messageRefs.get(id)
          if (el) {
            const delay = index * 30 // 交错延迟
            el.style.transition = `all 220ms cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms`
            el.style.opacity = '0'
            el.style.transform = 'translateY(8px) scale(0.98)'
          }
        })

        // 输入框脉冲效果（WAAPI，不碰 style.transition，见 pulseInputBox 注释）
        safeTimeout(() => {
          pulseInputBox(
            [
              { transform: 'scale(1)', boxShadow: '0 0 0 0 hsl(var(--accent-main-100) / 0)', offset: 0 },
              { transform: 'scale(1.005)', boxShadow: '0 0 0 2px hsl(var(--accent-main-100) / 0.3)', offset: 0.4 },
              { transform: 'scale(1)', boxShadow: '0 0 0 0 hsl(var(--accent-main-100) / 0)', offset: 1 },
            ],
            { duration: 200, easing: 'ease-out' },
          )
        }, 100)

        // 等待所有动画完成
        const totalDuration = 220 + (messageIds.length - 1) * 30 + 50
        safeTimeout(resolve, Math.min(totalDuration, 350))
      })
    },
    [pulseInputBox, safeTimeout],
  )

  // 恢复动画：输入框收缩 + 消息准备进入
  const animateRedo = useCallback((): Promise<void> => {
    return new Promise(resolve => {
      // 输入框脉冲（WAAPI，不碰 style.transition，见 pulseInputBox 注释）
      pulseInputBox(
        [
          { transform: 'scale(1)', boxShadow: '0 0 0 0 hsl(var(--accent-main-100) / 0)', offset: 0 },
          { transform: 'scale(0.995)', boxShadow: '0 0 0 1px hsl(var(--accent-main-100) / 0.2)', offset: 0.5 },
          { transform: 'scale(1)', boxShadow: '0 0 0 0 hsl(var(--accent-main-100) / 0)', offset: 1 },
        ],
        { duration: 180, easing: 'ease-out' },
      )

      safeTimeout(resolve, 80)
    })
  }, [pulseInputBox, safeTimeout])

  return {
    registerMessage,
    registerInputBox,
    animateUndo,
    animateRedo,
  }
}
