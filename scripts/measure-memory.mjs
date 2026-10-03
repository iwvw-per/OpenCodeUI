/**
 * 内存占用测量（真实浏览器，用 CDP 的 JS heap 指标）
 *
 * 对比修复前后：同一会话加载完成后的 JS 堆占用。
 * 这是「完整保留 749 条」与「裁到 500 条」的真实内存代价。
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:5176'
const DOMAIN = 'https://dsukhub.com'
const INSTANCE = 'inst_66c93fc9641c3f55dab4cde8'
const SESSION = 'ses_f025d74e3ffeAFiATAbOPjoivR'
const SID = `aiagent:${INSTANCE}::${SESSION}`
const DIR = 'E:/Code/OpenCodeUI'

const res = await fetch(`${DOMAIN}/api/aiagent/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'salen', password: 'ssln5014.' }),
})
const token = (await res.json()).data.token

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const cdp = await page.context().newCDPSession(page)

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

const baseline = await cdp.send('Runtime.getHeapUsage')

await page.goto(`${BASE}/#/session/${encodeURIComponent(SID)}?dir=${encodeURIComponent(DIR)}`, {
  waitUntil: 'domcontentloaded',
})
await page.waitForFunction(() => document.querySelectorAll('[data-timeline-key]').length > 0, { timeout: 180_000 })
await page.waitForTimeout(15_000)

// 强制 GC 后再读，避免把未回收的临时对象算进去
await cdp.send('HeapProfiler.collectGarbage')
await page.waitForTimeout(1000)
const after = await cdp.send('Runtime.getHeapUsage')

const heapMB = v => +(v / 1024 / 1024).toFixed(1)
console.log(
  JSON.stringify(
    {
      mode: 'fixed(after)',
      heap_before_load_mb: heapMB(baseline.usedSize),
      heap_after_load_mb: heapMB(after.usedSize),
      heap_delta_mb: heapMB(after.usedSize - baseline.usedSize),
      total_heap_mb: heapMB(after.totalSize),
    },
    null,
    2,
  ),
)
await browser.close()
