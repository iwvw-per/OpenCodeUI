import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// ============================================
// 按语言懒加载翻译资源
//
// 之前用 import.meta.glob(..., { eager: true }) 把所有语言的全部 namespace 打进
// 首屏 chunk：用户只用一种语言，却要下载 en + zh-CN 共 110KB JSON，并付出对应的
// 解析开销。
//
// 现在只静态引入 fallback 语言（en）作为兜底，其余语言在真正需要时（用户切换
// 或导航器检测命中）通过 import.meta.glob 的懒加载形态按需拉取。glob 的键是构建期
// 静态字面量，因此 Vite 仍可为每个语言/namespace 生成独立 chunk。
// ============================================

type LocaleModule = { default: Record<string, unknown> }

/** 构建期收集：./locales/{lang}/{ns}.json → () => Promise<模块> */
const lazyLocaleModules = import.meta.glob<LocaleModule>('./locales/*/*.json')

/** en 作为 fallback，静态加载，保证任何情况下都有可渲染的文案。 */
const FALLBACK_LANGUAGE = 'en'

const localeLoaders = new Map<string, Map<string, () => Promise<LocaleModule>>>()

for (const path in lazyLocaleModules) {
  // path 形如 ./locales/en/common.json
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/)
  if (!match) continue
  const [, lang, ns] = match
  let namespaces = localeLoaders.get(lang)
  if (!namespaces) {
    namespaces = new Map()
    localeLoaders.set(lang, namespaces)
  }
  namespaces.set(ns, lazyLocaleModules[path])
}

/** 命名空间列表来自 en 目录结构（所有语言保持同一套 namespace）。 */
const NAMESPACES = [...(localeLoaders.get(FALLBACK_LANGUAGE)?.keys() ?? [])]

/** 已加载完成的语言，避免重复请求。 */
const loadedLanguages = new Set<string>()

/** 语言 → 映射到实际存在的语言键（zh / zh-Hans → zh-CN）。 */
function resolveLanguageKey(language: string | undefined): string {
  if (!language) return FALLBACK_LANGUAGE
  if (localeLoaders.has(language)) return language
  const lower = language.toLowerCase()
  const exact = [...localeLoaders.keys()].find(key => key.toLowerCase() === lower)
  if (exact) return exact
  const base = lower.split('-')[0]
  const byBase = [...localeLoaders.keys()].find(key => key.toLowerCase().split('-')[0] === base)
  return byBase ?? FALLBACK_LANGUAGE
}

/** 读取某个语言的全部 namespace，返回 { ns: resource } 映射（不注入）。 */
async function readLanguageResources(
  language: string,
): Promise<{ key: string; resources: Record<string, Record<string, unknown>> } | null> {
  const key = resolveLanguageKey(language)
  const namespaces = localeLoaders.get(key)
  if (!namespaces) return null

  const entries = await Promise.all(
    [...namespaces.entries()].map(async ([ns, load]) => {
      const module = await load()
      return [ns, module.default ?? module] as const
    }),
  )

  return { key, resources: Object.fromEntries(entries) }
}

/**
 * 按需加载某个语言的资源并注入 i18next。
 *
 * 注意：addResourceBundle 必须在 i18n.init() 之后调用，否则实例尚未建立
 * resource store，会抛 "addResourceBundle is not a function"。
 * fallback 语言的资源走 init({ resources })，不走这里。
 */
async function loadLanguageResources(language: string): Promise<void> {
  const key = resolveLanguageKey(language)
  if (loadedLanguages.has(key)) return
  // 先登记再 await：并发调用时避免同一语言被重复加载。
  loadedLanguages.add(key)

  const loaded = await readLanguageResources(key)
  if (!loaded) return

  for (const [ns, resource] of Object.entries(loaded.resources)) {
    // addResourceBundle(lng, ns, resources, deep, overwrite)
    // overwrite=false：已存在的键保留，避免懒加载回来时覆盖 fallback 已渲染的内容。
    i18n.addResourceBundle(loaded.key, ns, resource, true, false)
  }
}

/**
 * 切换语言前先补齐资源。
 *
 * i18next 在 setLanguage 时若目标语言没有任何 resource bundle，会把该语言视为
 * 不可用并退回 fallback（resolvedLanguage 仍是 en）。因此不能只在
 * 'languageChanged' 里补资源——那时切换已经完成且失败了。
 *
 * 这里包一层 changeLanguage：先 await 资源，再交给 i18next 切过去，
 * 保证调用方 await 结束后语言与文案都已生效。
 */
const originalChangeLanguage = i18n.changeLanguage.bind(i18n)

export async function changeLanguageWithResources(language: string): Promise<void> {
  // i18next 的 init() 内部会经由 changeLanguage 收尾，此刻 isInitialized 仍为
  // false、resource store 尚未建立：此时调用 addResourceBundle 会抛错。而启动
  // 阶段的资源已由 initI18n 预加载，这里直接交给原始实现即可。
  //
  // 也不能在这里 await i18nReady：那条 Promise 正等 init 结束，而 init 又正等
  // 本次调用返回，会形成自等待死锁。
  if (i18n.isInitialized) {
    await loadLanguageResources(language)
  }
  await originalChangeLanguage(language)
}

// 把包装后的实现挂回 i18n 实例：项目内所有 i18n.changeLanguage(...) 调用点
// （如设置页的语言选择器）无需改动即可获得"先加载再切换"的行为。
i18n.changeLanguage = ((language?: string, callback?: (error: unknown, t: unknown) => void) => {
  const promise = changeLanguageWithResources(language ?? FALLBACK_LANGUAGE)
  if (typeof callback === 'function') {
    promise.then(t => callback(null, t as unknown), error => callback(error, undefined))
    return promise as unknown as ReturnType<typeof originalChangeLanguage>
  }
  return promise as unknown as ReturnType<typeof originalChangeLanguage>
}) as typeof i18n.changeLanguage

/** 只有 en 静态加载；其余语言在首帧前按需补齐。 */
async function initI18n(): Promise<void> {
  // 先确定首帧要用的语言，并把它的资源加载好，再 init。
  //
  // 关键：init 时若目标语言没有任何 resource bundle，i18next 会把它解析失败、
  // 退回 fallback（en），并通过 languageDetector.cacheUserLanguage 把这个错误
  // 结果写回 localStorage —— 用户存的 zh-CN 就此被改成 en，且永远不再生效。
  // 所以「补齐资源」必须发生在 init 之前，而不是 init 之后的补救。
  const detectedLanguage = detectInitialLanguage()

  const bundles: Record<string, Record<string, Record<string, unknown>>> = {}
  for (const language of new Set([FALLBACK_LANGUAGE, detectedLanguage])) {
    const loaded = await readLanguageResources(language)
    if (!loaded) continue
    bundles[loaded.key] = loaded.resources
    loadedLanguages.add(loaded.key)
  }

  await i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      // 显式指定语言，避免 detector 拿到 'zh' 这类区域变体后因资源键是 'zh-CN'
      // 而匹配失败、退回 en。detectedLanguage 已经做过键归一化，且对应资源
      // 已在上方加载完毕。
      lng: detectedLanguage,
      resources: bundles,
      fallbackLng: FALLBACK_LANGUAGE,
      defaultNS: 'common',
      ns: NAMESPACES,
      interpolation: {
        escapeValue: false, // React already escapes
      },
      detection: {
        order: ['localStorage', 'navigator'],
        caches: ['localStorage'],
        lookupLocalStorage: 'i18nextLng',
      },
    })
}

/**
 * 解析首帧语言：localStorage 优先，其次 navigator，最后回落 en。
 *
 * 这里刻意不依赖 i18next 的 detector 结果 —— init 之前 detector 尚未注册，
 * 而 init 之后拿到的是「资源缺失时被兜底成 en」的结果，无法区分
 * 「用户真的要 en」与「用户要 zh-CN 但资源没加载」。因此自己读一遍。
 */
function detectInitialLanguage(): string {
  try {
    const stored = localStorage.getItem('i18nextLng')
    if (stored) return resolveLanguageKey(stored)
  } catch {
    // 隐私模式等场景读不到 localStorage，继续走 navigator
  }
  const navigatorLanguage = typeof navigator !== 'undefined' ? navigator.language : undefined
  return resolveLanguageKey(navigatorLanguage)
}

/** 初始化 Promise：调用方（含测试）可 await，确保资源就绪。 */
export const i18nReady = initI18n()

/**
 * 让 <html lang> 跟随当前界面语言。
 *
 * index.html 里的初始值是静态的，用户在设置里切换语言（或首次按浏览器语言
 * 自动识别）后就会与实际内容不符。lang 影响断词、字体回退与屏幕阅读器发音，
 * 因此这里在初始化与每次切换时同步。
 *
 * 用 resolvedLanguage 而非 language：前者是实际加载到资源的语言键（如 en），
 * 后者可能是区域变体（如 en-US）。languageChanged 回调传入的正是后者，
 * 直接采用会让 lang 与真实资源不一致。
 */
function syncDocumentLang(): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = i18n.resolvedLanguage || i18n.language || 'en'
}

i18n.on('languageChanged', syncDocumentLang)

// 首帧先同步一次，避免 <html lang> 长时间滞后于实际语言。
void i18nReady.then(syncDocumentLang)

export default i18n
