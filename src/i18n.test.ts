import { describe, expect, it } from 'vitest'

describe('document language sync', () => {
  it('keeps <html lang> aligned with the resolved i18n language', async () => {
    const { default: i18n } = await import('./i18n')

    // 初始化后即应写入；且必须是实际加载资源的语言键，
    // 而非 en-US 这类区域变体（否则 lang 与真实资源不一致）。
    expect(i18n.resolvedLanguage).toBeTruthy()
    expect(document.documentElement.lang).toBe(i18n.resolvedLanguage)

    await i18n.changeLanguage('zh-CN')
    expect(document.documentElement.lang).toBe('zh-CN')

    await i18n.changeLanguage('en')
    expect(document.documentElement.lang).toBe('en')
  })
})
