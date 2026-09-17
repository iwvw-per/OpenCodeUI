import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// Eager-load all translation JSON files via Vite glob import
// Structure: src/locales/{lang}/{namespace}.json
const modules = import.meta.glob('./locales/*/*.json', { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>

const resources: Record<string, Record<string, Record<string, unknown>>> = {}

for (const path in modules) {
  // path example: ./locales/en/common.json
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/)
  if (!match) continue
  const [, lang, ns] = match
  if (!resources[lang]) resources[lang] = {}
  resources[lang][ns] = modules[path].default ?? modules[path]
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: Object.keys(resources['en'] || {}),
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
  })

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

syncDocumentLang()
i18n.on('languageChanged', syncDocumentLang)

export default i18n
