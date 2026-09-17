// Verify the FloatingActions displacement interpolates instead of snapping.
//
// Before the fix, `bottom` went 100% -> 2.5rem (mixed units) and the browser
// could not interpolate: the first frame jumped straight to the final value and
// the top only started moving two frames later. After switching to transform,
// top should advance a little on every frame from the first one.

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const url =
  process.argv[2]
  ?? process.env.OPENCODE_SESSION_URL ?? ''

if (!url) {
  console.error('需要目标会话 URL：node scripts/capture-collapse-verify.mjs <url>')
  console.error('或设置环境变量 OPENCODE_SESSION_URL。')
  process.exit(1)
}

const outDir = join(tmpdir(), 'opencode', 'collapse-verify')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await page.waitForSelector('[data-input-box]', { timeout: 60_000 })
await page.waitForTimeout(1500)

await page.evaluate(() => {
  window.__s = []
  const t0 = performance.now()
  const tick = () => {
    const layers = [...document.querySelectorAll('[data-collapse-anim]')]
    const fl = document.querySelector('[data-floating-actions]')
    const r = fl?.getBoundingClientRect()
    const cs = fl ? getComputedStyle(fl) : null
    window.__s.push({
      t: +(performance.now() - t0).toFixed(1),
      // 收起态现在由 framer-motion 的 layoutId 表达，不再有 data-visible 属性。
      // 用「胶囊层是否出现」判断：它是 data-collapse-anim 里的第二个元素，
      // 且只在收起态挂载。
      collapsed: !!document.querySelector('[data-collapse-anim] [class*="h-8"]') ||
        layers.length > 2,
      flTop: r ? +r.top.toFixed(2) : null,
      flTf: cs?.transform,
      flBottom: fl?.style.bottom,
    })
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})

const root = await page.$('[data-chat-scroll-root]')
const b = await root.boundingBox()
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, -320)
  await page.waitForTimeout(16)
}
await page.waitForTimeout(1400)

const samples = await page.evaluate(() => window.__s)
await browser.close()

// Print only the window around the collapse, and how many frames the movement
// is spread across (a snap shows as 1-2 distinct values; a real transition
// shows many).
const firstCollapsed = samples.findIndex(s => s.collapsed)
const win = samples.slice(Math.max(0, firstCollapsed - 3), firstCollapsed + 24)

const lines = []
lines.push(`total samples: ${samples.length}`)
lines.push(`first collapsed frame index: ${firstCollapsed}`)
lines.push('')
lines.push('  t(ms)   collapsed    flTop      bottom            transform')
for (const s of win) {
  lines.push(
    `  ${String(s.t).padStart(7)}   ${String(s.collapsed).padEnd(9)} ${String(s.flTop).padStart(7)}   ${String(s.flBottom).padEnd(8)} ${s.flTf}`,
  )
}

const moving = win.filter(s => s.collapsed)
const distinctTops = new Set(moving.map(s => s.flTop))
lines.push('')
lines.push(`distinct flTop values during/after collapse: ${distinctTops.size}`)
lines.push(`  (a snap gives 1-2 distinct values; a real transition gives many)`)

const report = lines.join('\n')
console.log(report)
writeFileSync(join(outDir, 'verify.txt'), report)
console.log('')
console.log(`output: ${outDir}`)
