/**
 * 补充测量：完整性与可达性（真实浏览器）
 *
 * 对比修复前后：
 *   A. 首屏渲染后，最顶端能否看到首轮用户消息
 *   B. 通过真实滚轮手势上滑后，能到达的最早消息下标
 *   C. 内存中消息条数（用时间轴/滚动高度等 DOM 代理 + 消息 id 可达范围）
 *   D. 「加载历史记录」指示条出现次数
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:5176'
const DOMAIN = 'https://dsukhub.com'
const INSTANCE = 'inst_66c93fc9641c3f55dab4cde8'
const SESSION = 'ses_f025d74e3ffeAFiATAbOPjoivR'
const SID = `aiagent:${INSTANCE}::${SESSION}`
const DIR = 'E:/Code/OpenCodeUI'
const outPath = process.argv[2] ?? 'perf-reach.json'

const res = await fetch(`${DOMAIN}/api/aiagent/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'salen', password: 'ssln5014.' }),
})
const token = (await res.json()).data.token

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()

let spinnerCount = 0
const sampler = setInterval(async () => {
  try {
    if (await page.evaluate(() => !!document.querySelector('[aria-live=polite]'))) spinnerCount++
  } catch {}
}, 200)

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

await page.goto(`${BASE}/#/session/${encodeURIComponent(SID)}?dir=${encodeURIComponent(DIR)}`, {
  waitUntil: 'domcontentloaded',
})
await page.waitForFunction(() => document.querySelectorAll('[data-timeline-key]').length > 0, { timeout: 180_000 })
await page.waitForTimeout(12_000)

// 用真实滚轮手势一路向上，直到最顶端不再变化
let stagnant = 0
let lastTop = null
let lastHeight = 0
for (let i = 0; i < 40; i++) {
  await page.evaluate(() => {
    const el = document.querySelector('[data-chat-scroll-root=true]')
    if (el) el.scrollTop = 0
  })
  await page.mouse.move(720, 450)
  await page.mouse.wheel(0, -800)
  await page.waitForTimeout(1200)
  const snap = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-timeline-key]')].sort(
      (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
    )
    const root = document.querySelector('[data-chat-scroll-root=true]')
    return { top: rows[0]?.dataset.timelineKey ?? null, height: root?.scrollHeight ?? 0 }
  })
  if (snap.top === lastTop && snap.height === lastHeight) stagnant++
  else stagnant = 0
  lastTop = snap.top
  lastHeight = snap.height
  if (stagnant >= 5) break
}

const final = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-timeline-key]')].sort(
    (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
  )
  const root = document.querySelector('[data-chat-scroll-root=true]')
  const text = document.body.innerText
  const turnMatch = text.match(/(\d+)\s*轮\s*[·\s]*(\d+)\s*步/)
  return {
    topKey: rows[0]?.dataset.timelineKey ?? null,
    topText: (rows[0]?.innerText ?? '').slice(0, 80),
    scrollHeight: root?.scrollHeight ?? 0,
    turns: turnMatch ? Number(turnMatch[1]) : null,
    steps: turnMatch ? Number(turnMatch[2]) : null,
  }
})

clearInterval(sampler)

// 服务端权威顺序：limit=N 返回「最新 N 条」且按时间升序，
// 因此要拿「最早一条」必须拉全量后取 [0]。limit=1 拿到的是**最新**一条。
const authoritative = await fetch(
  `${DOMAIN}/api/aiagent/gw/${INSTANCE}/session/${SESSION}/message?limit=100000`,
  { headers: { Authorization: `Bearer ${token}`, 'X-Lightweight': '1' } },
)
  .then(r => r.json())
  .then(a => ({
    first: Array.isArray(a) ? a[0]?.info?.id ?? null : null,
    last: Array.isArray(a) ? a[a.length - 1]?.info?.id ?? null : null,
    total: Array.isArray(a) ? a.length : 0,
  }))
  .catch(() => ({ first: null, last: null, total: 0 }))

const result = {
  mode: 'fixed(after)',
  reached_first_message: final.topKey !== null && final.topKey === authoritative.first,
  top_key: final.topKey,
  server_first_key: authoritative.first,
  server_last_key: authoritative.last,
  server_total: authoritative.total,
  top_text: final.topText,
  scroll_height: final.scrollHeight,
  visible_turns: final.turns,
  visible_steps: final.steps,
  spinner_samples: spinnerCount,
}
console.log(JSON.stringify(result, null, 2))
const fs = await import('node:fs')
fs.writeFileSync(outPath, JSON.stringify(result, null, 2))
await browser.close()
