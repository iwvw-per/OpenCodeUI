/**
 * 性能测量脚本（真实浏览器环境）
 *
 * 通过 Playwright 驱动 http://localhost:5176，加载指定的真实远程会话，
 * 采集首屏加载的客观指标。用于「修复前 vs 修复后」对比。
 *
 * 用法：
 *   node scripts/measure-session-perf.mjs <label> <outputJson>
 *
 * 采集指标：
 *   - t_probe_ms        能力探测（limit=1）耗时
 *   - t_full_ms         全量拉取（limit=100000）耗时
 *   - t_visible_ms      从导航到首条消息可见（用户实际感知的首屏时间）
 *   - full_bytes        全量响应体积
 *   - req_count_message 该会话的 message 请求次数（应为 2：探测 + 全量）
 *   - req_limits        各请求的 limit 值
 *   - mem_messages      最终内存中消息条数
 *   - trimmed_count     被裁剪未补回的缺口条数
 *   - has_more          是否仍声称有更早历史
 *   - spinner_seen      「加载历史记录」指示条是否出现过
 *   - top_key           滚到顶后最顶端渲染的消息 id
 *   - top_is_first      top_key 是否为服务端返回的第 0 条
 *   - scroll_reachable  滚到顶后是否能看到首轮用户消息
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:5176'
const DOMAIN = 'https://dsukhub.com'
const INSTANCE = 'inst_66c93fc9641c3f55dab4cde8'
const SESSION = 'ses_f025d74e3ffeAFiATAbOPjoivR'
const SID = `aiagent:${INSTANCE}::${SESSION}`
const DIR = 'E:/Code/OpenCodeUI'

const label = process.argv[2] ?? 'run'
const outPath = process.argv[3] ?? `perf-${label}.json`

async function login() {
  const res = await fetch(`${DOMAIN}/api/aiagent/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'salen', password: 'ssln5014.' }),
  })
  const json = await res.json()
  if (!json?.data?.token) throw new Error(`login failed: ${JSON.stringify(json).slice(0, 200)}`)
  return json.data.token
}

const token = await login()
// 用 playwright 自带的 chromium：环境无关，测量可重复
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

// ── 网络采集：只记录该会话的 message 请求 ──
const messageRequests = []
let fullBytes = 0
let probeMs = null
let fullMs = null

page.on('request', req => {
  const url = req.url()
  if (!url.includes(`/session/${SESSION}/message`)) return
  const limit = new URL(url).searchParams.get('limit')
  messageRequests.push({ limit, at: Date.now(), url })
})
page.on('response', async res => {
  const url = res.url()
  if (!url.includes(`/session/${SESSION}/message`)) return
  const entry = messageRequests.find(r => r.url === url && r.bytes === undefined)
  if (!entry) return
  entry.status = res.status()
  entry.ms = Date.now() - entry.at
  try {
    entry.bytes = (await res.body()).length
  } catch {
    entry.bytes = 0
  }
  if (entry.limit === '1' && probeMs === null) probeMs = entry.ms
  if (entry.limit === '100000') {
    fullMs = entry.ms
    fullBytes = entry.bytes ?? 0
  }
})

// ── 播种登录态：走应用自身的存储格式 ──
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
await page.evaluate(
  ([tk, domain]) => {
    localStorage.setItem(
      'opencode-aiagent-account',
      JSON.stringify({ domain, username: 'salen', token: tk, loginAt: Date.now() }),
    )
  },
  [token, DOMAIN],
)
// 注册实例（复用应用自己的同步逻辑）
await page.evaluate(async () => {
  const mod = await import('/src/api/aiagent.ts')
  await mod.syncInstances()
})

// ── 采样「加载历史记录」指示条是否出现 ──
let spinnerSeen = false
const sampler = setInterval(async () => {
  try {
    const has = await page.evaluate(() => !!document.querySelector('[aria-live=polite]'))
    if (has) spinnerSeen = true
  } catch {
    /* 导航中忽略 */
  }
}, 150)

// ── 主流程：导航到目标会话，等首条消息渲染 ──
const t0 = Date.now()
await page.goto(`${BASE}/#/session/${encodeURIComponent(SID)}?dir=${encodeURIComponent(DIR)}`, {
  waitUntil: 'domcontentloaded',
})

let tVisible = null
try {
  await page.waitForFunction(() => document.querySelectorAll('[data-timeline-key]').length > 0, { timeout: 180_000 })
  tVisible = Date.now() - t0
} catch {
  tVisible = null
}

// 等内存状态稳定（消息数不再变化）
//
// 注意：不能通过 page.evaluate 里的 dynamic import 读 store —— Vite dev 下
// 该 import 会拿到与 React 应用**不同的模块实例**（实测 sessions.size 恒为 0）。
// 因此内存指标一律从 DOM/渲染结果反推，那也是用户实际看到的真相。
let stable = 0
let prev = -1
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000)
  const snap = await page.evaluate(() => ({
    rows: document.querySelectorAll('[data-timeline-key]').length,
    // 虚拟列表首行索引：scrollHeight 稳定即视为加载完成
    scrollHeight: document.querySelector('[data-chat-scroll-root=true]')?.scrollHeight ?? 0,
  }))
  const sig = `${snap.rows}|${snap.scrollHeight}`
  if (sig === prev) stable++
  else stable = 0
  prev = sig
  if (snap.rows > 0 && stable >= 6) break
}

// 从 DOM 提取「该会话在内存中保留了多少条」：虚拟列表只渲染视口内的行，
// 但 scrollHeight 与时间轴的轮次统计能反映真实规模。用时间轴面板的权威计数。
const domStats = await page.evaluate(() => {
  const text = document.body.innerText
  const turnMatch = text.match(/(\d+)\s*轮\s*[·\s]*(\d+)\s*步/)
  return {
    turns: turnMatch ? Number(turnMatch[1]) : null,
    steps: turnMatch ? Number(turnMatch[2]) : null,
  }
})

const state = {
  count: domStats.steps ?? 0, // 保留字段名，实际用步骤数作为规模代理
  oldest: null,
  hasMore: false,
  trimmed: null,
}

// ── 滚到顶，检查最顶端内容 ──
await page.evaluate(() => {
  const el = document.querySelector('[data-chat-scroll-root=true]')
  if (el) el.scrollTop = 0
})
await page.waitForTimeout(2500)
const topInfo = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-timeline-key]')].sort(
    (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
  )
  const top = rows[0]
  const root = document.querySelector('[data-chat-scroll-root=true]')
  return {
    key: top?.dataset.timelineKey ?? null,
    text: (top?.innerText ?? '').slice(0, 120),
    rows: rows.length,
    scrollTop: root?.scrollTop ?? -1,
    scrollHeight: root?.scrollHeight ?? 0,
  }
})

clearInterval(sampler)

// 服务端权威顺序里的第 0 条与总数（判定「最顶端是否为首轮」的基准）。
// 注意：limit=N 返回「最新 N 条」且按时间升序，故 [0] 是最早的一条；
// limit=1 拿到的是**最新**一条，不能用来判定首轮。
const serverInfo = await page.evaluate(
  async ([instId, sesId, tk, domain]) => {
    try {
      const res = await fetch(`${domain}/api/aiagent/gw/${instId}/session/${sesId}/message?limit=100000`, {
        headers: { Authorization: `Bearer ${tk}`, 'X-Lightweight': '1' },
      })
      const arr = await res.json()
      return { first: arr?.[0]?.info?.id ?? null, total: Array.isArray(arr) ? arr.length : 0 }
    } catch {
      return { first: null, total: 0 }
    }
  },
  [INSTANCE, SESSION, token, DOMAIN],
)

const result = {
  label,
  mode: 'fixed(after)',
  t_probe_ms: probeMs,
  t_full_ms: fullMs,
  t_visible_ms: tVisible,
  full_bytes: fullBytes,
  full_mb: +(fullBytes / 1024 / 1024).toFixed(2),
  req_count_message: messageRequests.length,
  req_limits: messageRequests.map(r => r.limit),
  server_total: serverInfo.total,
  // 完整性：最顶端那条是否为服务端第 0 条（决定「首轮对话是否可达」）
  top_is_server_first: topInfo.key !== null && topInfo.key === serverInfo.first,
  // 用户可见的规模：右侧时间轴展示的轮次/步骤
  visible_turns: domStats.turns,
  visible_steps: domStats.steps,
  has_more: state.hasMore,
  spinner_seen: spinnerSeen,
  top_key: topInfo.key,
  server_first_key: serverInfo.first,
  top_text: topInfo.text.slice(0, 60),
  rendered_rows: topInfo.rows,
  scroll_height: topInfo.scrollHeight,
}

console.log(JSON.stringify(result, null, 2))
const fs = await import('node:fs')
fs.writeFileSync(outPath, JSON.stringify(result, null, 2))

await browser.close()
