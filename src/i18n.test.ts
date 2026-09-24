import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('document language sync', () => {
  it('keeps <html lang> aligned with the resolved i18n language', async () => {
    // i18n 资源现在是按语言懒加载的，初始化是异步的：
    // 必须 await i18nReady，否则断言会跑在资源注入之前。
    const { default: i18n, i18nReady } = await import('./i18n')
    await i18nReady

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

describe('lazy language initialization', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('honors the stored language on first load instead of falling back to en', async () => {
    // 回归：init 时只有 en 资源，i18next 会把 zh-CN 解析失败后退回 en，并把
    // 这个错误结果写回 localStorage。于是用户选择的 zh-CN 永远不生效，
    // 偏好还被改写成 en。必须在 init 前先加载目标语言资源。
    localStorage.setItem('i18nextLng', 'zh-CN')

    const { default: i18n, i18nReady } = await import('./i18n')
    await i18nReady

    expect(i18n.resolvedLanguage).toBe('zh-CN')
    expect(i18n.getResourceBundle('zh-CN', 'common')).toBeTruthy()
    // 存储偏好不得被改写成 en
    expect(localStorage.getItem('i18nextLng')).toBe('zh-CN')
  })

  it('falls back to en when nothing is stored', async () => {
    const { default: i18n, i18nReady } = await import('./i18n')
    await i18nReady

    expect(i18n.resolvedLanguage).toBe('en')
  })
})
