// Measure whether the composer height lock is actually necessary.
//
// The old code pins contentWrap to a fixed height while collapsed, on the theory
// that any change in the measured wrapper height would shift the virtualizer's
// paddingEnd and cause oscillation. This probe tests that theory directly:
// remove the lock at runtime and watch whether the measured height / scroll
// position actually oscillate.

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const url =
  process.argv[2]
  ?? process.env.OPENCODE_SESSION_URL ?? ''

if (!url) {
  console.error('需要目标会话 URL：node scripts/probe-height-lock.mjs <url>')
  console.error('或设置环境变量 OPENCODE_SESSION_URL。')
  process.exit(1)
}

const outDir = join(tmpdir(), 'opencode', 'height-lock')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await page.waitForSelector('[data-input-box]', { timeout: 60_000 })
await page.waitForTimeout(1500)

// Sample: the measured wrapper height (what ChatPane's ResizeObserver feeds to
// the virtualizer), the scroll position, and whether we're collapsed.
await page.evaluate(() => {
  window.__probe = []
  const t0 = performance.now()
  const tick = () => {
    // The wrapper ChatPane measures: absolute bottom-0 containing the composer.
    const wrap = document.querySelector('[data-input-box]')?.closest('.absolute.bottom-0.left-0.right-0')
    const scroller = document.querySelector('[data-chat-scroll-root]')
    const layers = [...document.querySelectorAll('[data-collapse-anim]')]
    const cap = layers[1]
    window.__probe.push({
      t: +(performance.now() - t0).toFixed(1),
      wrapH: wrap ? +wrap.getBoundingClientRect().height.toFixed(2) : null,
      scrollTop: scroller ? +scroller.scrollTop.toFixed(1) : null,
      scrollHeight: scroller ? scroller.scrollHeight : null,
      collapsed: cap?.getAttribute('data-visible') === 'true',
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
await page.waitForTimeout(1500)

const samples = await page.evaluate(() => window.__probe)
await browser.close()

// Analyse: does wrapH change? does scrollTop oscillate (sign flips)?
const wrapHs = [...new Set(samples.map(s => s.wrapH))]
const scrollTops = samples.map(s => s.scrollTop)
let directionFlips = 0
for (let i = 2; i < scrollTops.length; i++) {
  const a = scrollTops[i - 1] - scrollTops[i - 2]
  const c = scrollTops[i] - scrollTops[i - 1]
  if (a !== 0 && c !== 0 && Math.sign(a) !== Math.sign(c)) directionFlips++
}

const lines = []
lines.push(`samples: ${samples.length}`)
lines.push(`distinct wrapH values: ${wrapHs.length}  ->  ${JSON.stringify(wrapHs.slice(0, 10))}`)
lines.push(`wrapH min/max: ${Math.min(...wrapHs)} / ${Math.max(...wrapHs)}`)
lines.push(`scrollTop min/max: ${Math.min(...scrollTops)} / ${Math.max(...scrollTops)}`)
lines.push(`scroll direction flips: ${directionFlips}`)
lines.push('')
lines.push('interpretation:')
lines.push('  wrapH with 1 distinct value  => height is constant (lock working / not needed)')
lines.push('  wrapH with several values    => height changes during collapse')
lines.push('  scroll flips > ~3            => the virtualizer is oscillating')

const report = lines.join('\n')
console.log(report)
writeFileSync(join(outDir, 'report.txt'), report)
console.log('')
console.log(`output: ${outDir}`)
