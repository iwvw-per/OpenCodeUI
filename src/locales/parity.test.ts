import { describe, expect, it } from 'vitest'

const modules = import.meta.glob('./locales/*/*.json', { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>

function flatten(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  const keys: string[] = []
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    keys.push(...flatten(child, prefix ? `${prefix}.${key}` : key))
  }
  return keys
}

function byLangNamespace(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const [path, mod] of Object.entries(modules)) {
    const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/)
    if (!match) continue
    const [, lang, ns] = match
    out.set(`${ns}`, out.get(`${ns}`) ?? new Set())
    for (const key of flatten(mod.default ?? mod)) {
      out.get(ns)!.add(`${lang}:${key}`)
    }
  }
  return out
}

/** 把某语言的全部键映射为「去掉语言前缀」的集合，便于跨语言比较。 */
function keysFor(lang: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const [path, mod] of Object.entries(modules)) {
    const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/)
    if (!match) continue
    const [, entryLang, ns] = match
    if (entryLang !== lang) continue
    out.set(ns, new Set(flatten(mod.default ?? mod)))
  }
  return out
}

describe('locale key parity', () => {
  it('has the same namespaces for every language', () => {
    const namespaces = Object.keys(byLangNamespace())
    const langs = ['en', 'zh-CN']
    for (const lang of langs) {
      expect([...keysFor(lang).keys()].sort(), lang).toEqual(namespaces.sort())
    }
  })

  it('keeps en and zh-CN keys in sync per namespace', () => {
    // 翻译是用户可见文案：某个键只加了中文没加英文时，英文界面会回退成 key 本身。
    const en = keysFor('en')
    const zh = keysFor('zh-CN')
    const missing: string[] = []
    for (const ns of new Set([...en.keys(), ...zh.keys()])) {
      const enKeys = en.get(ns) ?? new Set<string>()
      const zhKeys = zh.get(ns) ?? new Set<string>()
      for (const key of zhKeys) if (!enKeys.has(key)) missing.push(`en/${ns}: ${key}`)
      for (const key of enKeys) if (!zhKeys.has(key)) missing.push(`zh-CN/${ns}: ${key}`)
    }
    expect(missing).toEqual([])
  })
})
