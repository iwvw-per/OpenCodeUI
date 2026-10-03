/**
 * 点击左侧会话 → 右侧渲染完成 的真实耗时测量
 *
 * 目的：定位「点一个对话右侧要十几秒」的耗时构成。
 *
 * 采集：
 *   - 侧栏渲染的会话条目数（回答「左侧是否全加载」）
 *   - 点第一个会话的 click→首条消息可见耗时
 *   - 期间发出的所有网络请求（URL/limit/耗时/字节），按耗时排序
 *   - 是否存在重复请求、串行瀑布
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:5176'
const DOMAIN = 'https://dsukhub.com'
const INSTANCE = 'inst_66c93fc9641c3f55dab4cde8'
const PROJECT_DIR = 'E:/Code/OpenCodeUI'
const CLICK_INDEX = Number(process.argv[2] ?? 0)

const res = await fetch(`${DOMAIN}/api/aiagent/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'salen', password: 'ssln5014.' }),
})
const token = (await res.json()).data.token

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()

// ── 全量网络记录 ──
const reqs = []
page.on('request', r => {
  const u = r.url()
  if (u.startsWith('data:') || u.includes('/@vite/') || u.includes('/node_modules/') || u.endsWith('.css')) return
  reqs.push({ url: u, method: r.method(), start: Date.now() })
})
page.on('response', async r => {
  const u = r.url()
  if (u.startsWith('data:') || u.includes('/@vite/') || u.includes('/node_modules/') || u.endsWith('.css')) return
  const e = reqs.filter(x => x.url === u && x.ms === undefined).pop()
  if (!e) return
  e.ms = Date.now() - e.start
  e.status = r.status()
  try {
    e.bytes = (await r.body()).length
  } catch {
    e.bytes = 0
  }
})

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
await page.evaluate(
  ([tk]) => {
    localStorage.setItem(
      'opencode-aiagent-account',
      JSON.stringify({ domain: 'https://dsukhub.com', username: 'salen', token: tk, loginAt: Date.now() }),
    )
  },
  [token],
)
await page.evaluate(async () => {
  const m = await import('/src/api/aiagent.ts')
  await m.syncInstances()
})
// 注册实例之后再切换活动服务器（syncInstances 会重建服务器列表）
await page.evaluate(
  ([inst, dir]) => {
    localStorage.setItem('opencode-active-server', `aiagent:${inst}`)
    sessionStorage.setItem('opencode-active-server', `aiagent:${inst}`)
    // 侧栏按「已登记的项目文件夹」分组展示会话；不登记就没有任何条目
    localStorage.setItem(
      `srv:aiagent:${inst}:opencode-saved-directories`,
      JSON.stringify([{ path: dir, name: 'OpenCodeUI', addedAt: Date.now() }]),
    )
  },
  [INSTANCE, PROJECT_DIR],
)

// 切到笔电主机，等待侧栏加载
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(9000)

// 展开项目文件夹（会话条目默认折叠在文件夹里）
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button,[role=button]')].find(b =>
    (b.innerText || '').includes('OpenCodeUI'),
  )
  btn?.click()
})
await page.waitForTimeout(6000)

// 会话条目的稳定标识：FolderRecentList 里会话行按钮带 "peer flex min-w-0 flex-1"
// 且位于左栏（x < 300）。不依赖标题里的时间后缀格式（时/分/天可能缺席）。
const SESSION_ROW_JS = `(() => {
  return [...document.querySelectorAll('button')].filter(el => {
    const cls = (el.className || '').toString()
    const r = el.getBoundingClientRect()
    if (r.left >= 300 || r.width <= 60 || r.height <= 12) return false
    return cls.includes('peer') && cls.includes('flex-1')
  })
})()`

// ── 侧栏规模 ──
const sidebar = await page.evaluate(js => {
  const rows = eval(js)
  const text = document.body.innerText
  return {
    sessionRows: rows.length,
    titles: rows.map(el => (el.innerText || '').replace(/\n/g, ' ').slice(0, 45)),
    hasMoreButton: text.includes('展开更多会话'),
  }
}, SESSION_ROW_JS)

const sidebarReqs = reqs
  .filter(r => r.url.includes('/experimental/session'))
  .map(r => ({ url: r.url.replace(DOMAIN, '').replace(BASE, '').slice(0, 100), ms: r.ms, bytes: r.bytes }))

// ── 点击第 N 个会话，测 click→首条消息可见 ──
const before = reqs.length
const clicked = await page.evaluate(
  ([js, idx]) => {
    const rows = eval(js)
    const el = rows[idx]
    if (!el) return null
    document.querySelectorAll('[data-timeline-key]').forEach(n => n.removeAttribute('data-timeline-key'))
    const label = (el.innerText || '').replace(/\n/g, ' ').slice(0, 50)
    el.click()
    return label
  },
  [SESSION_ROW_JS, CLICK_INDEX],
)

const t0 = Date.now()
let tFirstRow = null
try {
  await page.waitForFunction(() => document.querySelectorAll('[data-timeline-key]').length > 0, { timeout: 120_000 })
  tFirstRow = Date.now() - t0
} catch {
  tFirstRow = null
}

// 等加载稳定（消息行数 + spinner 都不再变）
let stable = 0
let prev = -1
for (let i = 0; i < 45; i++) {
  await page.waitForTimeout(1000)
  const s = await page.evaluate(
    () =>
      `${document.querySelectorAll('[data-timeline-key]').length}|${!!document.querySelector('[aria-live=polite]')}`,
  )
  if (s === prev) stable++
  else stable = 0
  prev = s
  if (stable >= 5) break
}
const tStable = Date.now() - t0

const clickReqs = reqs
  .slice(before)
  .filter(r => r.url.includes('/api/aiagent/'))
  .map(r => ({
    full: r.url.replace(DOMAIN, ''),
    path: r.url.replace(DOMAIN, '').replace(/^.*\/gw\/[^/]+/, '').slice(0, 95),
    start_ms: r.start - t0,
    end_ms: r.ms !== undefined ? r.start - t0 + r.ms : null,
    ms: r.ms,
    bytes: r.bytes,
    status: r.status,
  }))
  .sort((a, b) => a.start_ms - b.start_ms)

const final = await page.evaluate(() => {
  const text = document.body.innerText
  const turnMatch = text.match(/(\d+)\s*轮\s*[·\s]*(\d+)\s*步/)
  const rows = [...document.querySelectorAll('[data-timeline-key]')]
  return {
    rows: rows.length,
    turns: turnMatch ? Number(turnMatch[1]) : null,
    steps: turnMatch ? Number(turnMatch[2]) : null,
  }
})

const report = {
  clicked: clicked ?? null,
  sidebar_session_rows: sidebar.sessionRows,
  sidebar_titles: sidebar.titles,
  sidebar_has_more_button: sidebar.hasMoreButton,
  sidebar_requests: sidebarReqs,
  t_click_to_first_row_ms: tFirstRow,
  t_click_to_stable_ms: tStable,
  click_requests: clickReqs,
  final_rows: final.rows,
  final_turns: final.turns,
  final_steps: final.steps,
}

const outFile = process.argv[3] ?? 'perf-click-open.json'
const fs = await import('node:fs')
fs.writeFileSync(outFile, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()
