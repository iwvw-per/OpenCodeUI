// ============================================
// Haptics - 触觉反馈（震动）
// ============================================
//
// 分级语义：
// - light  轻触：普通点击、选择、切换
// - medium 中：打开/提交/发送等有明确结果的操作
// - strong 强：删除、批准/拒绝、长按等破坏性或高权重操作
//
// 触发链路（按可用性回退）：
// 1. Android 原生桥 __opencode_android.vibratePattern(durations, amplitudes)（支持振幅）
// 2. Android 原生桥 __opencode_android.vibrate(ms)（旧版，无振幅）
// 3. W3C Vibration API navigator.vibrate(pattern)
//
// 开关门控读 hapticStore：关闭时不震动。所有调用都应经此模块，不要直接 navigator.vibrate。

import { hapticStore, type HapticIntensity } from '../store/hapticStore'

export type HapticStrength = 'light' | 'medium' | 'strong'

interface AndroidBridge {
  vibrate?: (ms: number) => void
  vibratePattern?: (durations: string, amplitudes: string) => void
}

function getBridge(): AndroidBridge | undefined {
  return (window as unknown as { __opencode_android?: AndroidBridge }).__opencode_android
}

/** 当前环境是否具备震动能力（原生桥或 Vibration API）。 */
export function hapticsSupported(): boolean {
  if (typeof window === 'undefined') return false
  if (getBridge()?.vibrate || getBridge()?.vibratePattern) return true
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

// 每档的时长与振幅（振幅 1-255，仅原生桥支持）。pattern 为 [震动, 间隔, 震动…]。
const STRENGTH_PROFILE: Record<HapticStrength, { durations: number[]; amplitudes: number[]; fallbackMs: number }> = {
  light: { durations: [8], amplitudes: [80], fallbackMs: 8 },
  medium: { durations: [16], amplitudes: [140], fallbackMs: 16 },
  strong: { durations: [22, 30, 22], amplitudes: [200, 0, 200], fallbackMs: 30 },
}

// 全局强度档对「时长」与「振幅」的缩放系数。时长向下取整后至少保留 1ms。
const INTENSITY_SCALE: Record<HapticIntensity, { duration: number; amplitude: number }> = {
  subtle: { duration: 0.6, amplitude: 0.5 },
  standard: { duration: 1, amplitude: 1 },
  strong: { duration: 1.4, amplitude: 1.3 },
}

function scaleProfile(
  profile: { durations: number[]; amplitudes: number[]; fallbackMs: number },
  intensity: HapticIntensity,
) {
  const scale = INTENSITY_SCALE[intensity]
  return {
    durations: profile.durations.map(d => (d === 0 ? 0 : Math.max(1, Math.round(d * scale.duration)))),
    amplitudes: profile.amplitudes.map(a => (a === 0 ? 0 : Math.min(255, Math.max(1, Math.round(a * scale.amplitude))))),
    fallbackMs: Math.max(1, Math.round(profile.fallbackMs * scale.duration)),
  }
}

/**
 * 触发一次触觉反馈。默认轻触。
 * 关闭开关或环境不支持时静默无操作。时长/振幅按全局强度档缩放。
 */
export function hapticTap(strength: HapticStrength = 'light'): void {
  const settings = hapticStore.getSnapshot()
  if (!settings.enabled) return
  const profile = scaleProfile(STRENGTH_PROFILE[strength], settings.intensity)
  try {
    const bridge = getBridge()
    if (bridge?.vibratePattern) {
      bridge.vibratePattern(profile.durations.join(','), profile.amplitudes.join(','))
      return
    }
    if (bridge?.vibrate) {
      // 旧版原生桥只接受单次时长，用总时长近似。
      const total = profile.durations.reduce((sum, d) => sum + d, 0)
      bridge.vibrate(Math.min(total, 50))
      return
    }
    navigator.vibrate?.(profile.fallbackMs)
  } catch {
    /* 触觉反馈是增强体验，失败不应影响主流程 */
  }
}
