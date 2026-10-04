import { describe, expect, it } from 'vitest'

// 本文件位于 src/locales/，语言资源在其一级子目录 en/、zh-CN/ 下。
// glob 必须相对本文件写 './*/*.json'；写成 './locales/*/*.json' 会解析到
// 不存在的 src/locales/locales/，集合恒为空，断言空对空「假通过」。
const modules = import.meta.glob('./*/*.json', { eager: true }) as Record<
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

/** i18next 复数后缀：英文按数量产生 _one/_other，中文无复数。比较时归一化掉。 */
function stripPluralSuffix(key: string): string {
  return key.replace(/_(zero|one|two|few|many|other)$/, '')
}

function parse(path: string): { lang: string; ns: string } | null {
  const match = path.match(/\.\/([^/]+)\/([^/]+)\.json$/)
  if (!match) return null
  return { lang: match[1], ns: match[2] }
}

function keysFor(lang: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const [path, mod] of Object.entries(modules)) {
    const parsed = parse(path)
    if (!parsed || parsed.lang !== lang) continue
    out.set(parsed.ns, new Set(flatten(mod.default ?? mod).map(stripPluralSuffix)))
  }
  return out
}

function allNamespaces(): string[] {
  const ns = new Set<string>()
  for (const path of Object.keys(modules)) {
    const parsed = parse(path)
    if (parsed) ns.add(parsed.ns)
  }
  return [...ns].sort()
}

describe('locale key parity', () => {
  it('loads locale resources (guards against a broken glob)', () => {
    expect(Object.keys(modules).length).toBeGreaterThan(0)
  })

  it('has the same namespaces for every language', () => {
    const namespaces = allNamespaces()
    expect(namespaces.length).toBeGreaterThan(0)
    for (const lang of ['en', 'zh-CN']) {
      expect([...keysFor(lang).keys()].sort(), lang).toEqual(namespaces)
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
