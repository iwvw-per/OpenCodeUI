import { describe, expect, it } from 'vitest'
import { builtinThemes, type ThemeColors } from './index'

function lightness(color: string): number {
  const parts = color.trim().split(/\s+/)
  return Number.parseFloat(parts[parts.length - 1])
}

function textScale(colors: ThemeColors): number[] {
  return [
    colors.text.text100,
    colors.text.text200,
    colors.text.text300,
    colors.text.text400,
    colors.text.text500,
    colors.text.text600,
  ].map(lightness)
}

describe('theme palettes', () => {
  it('keeps the dark text scale strictly descending', () => {
    // 层级必须单调：text100 最亮（正文），越靠后越淡（分隔线）。
    // draculaDark 曾把 text300 与 text400 写反，导致「越靠后越亮」。
    for (const theme of builtinThemes) {
      const scale = textScale(theme.dark)
      for (let i = 0; i < scale.length - 1; i += 1) {
        expect(
          scale[i],
          `${theme.id}.dark text${(i + 1) * 100} (${scale[i]}%) 应亮于 text${(i + 2) * 100} (${scale[i + 1]}%)`,
        ).toBeGreaterThan(scale[i + 1])
      }
    }
  })

  it('keeps the light text scale strictly ascending', () => {
    for (const theme of builtinThemes) {
      const scale = textScale(theme.light)
      for (let i = 0; i < scale.length - 1; i += 1) {
        expect(
          scale[i],
          `${theme.id}.light text${(i + 1) * 100} (${scale[i]}%) 应暗于 text${(i + 2) * 100} (${scale[i + 1]}%)`,
        ).toBeLessThan(scale[i + 1])
      }
    }
  })

  it('keeps the background scale strictly ordered in both modes', () => {
    for (const theme of builtinThemes) {
      const lightBg = [theme.light.background.bg000, theme.light.background.bg400].map(lightness)
      expect(lightBg[0], `${theme.id}.light`).toBeGreaterThan(lightBg[1])

      const darkBg = [theme.dark.background.bg000, theme.dark.background.bg400].map(lightness)
      expect(darkBg[0], `${theme.id}.dark`).toBeGreaterThan(darkBg[1])
    }
  })
})
