// Verify the composer and the message column are now the same width, in both
// normal and wide mode.

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const base =
  process.argv[2]
  ?? process.env.OPENCODE_SESSION_URL ?? ''

if (!base) {
  console.error('需要目标会话 URL：node scripts/check-content-width.mjs <url>')
  console.error('或设置环境变量 OPENCODE_SESSION_URL。')
  process.exit(1)
}

const outDir = join(tmpdir(), 'opencode', 'width-check')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await page.waitForSelector('[data-input-box]', { timeout: 60_000 })
await page.waitForTimeout(1500)

const measure = () =>
  page.evaluate(() => {
    const r = el => {
      if (!el) return null
      const rect = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        left: +rect.left.toFixed(1),
        right: +rect.right.toFixed(1),
        width: +rect.width.toFixed(1),
        paddingLeft: cs.paddingLeft,
        paddingRight: cs.paddingRight,
        maxWidth: cs.maxWidth,
        cls: (el.className || '').toString().slice(0, 80),
      }
    }

    // Composer's max-width wrapper: the div that carries mx-auto + max-w-* and is
    // an ancestor of [data-input-box].
    const box = document.querySelector('[data-input-box]')
    let composerWrap = box
    while (composerWrap && !/mx-auto/.test(composerWrap.className || '')) {
      composerWrap = composerWrap.parentElement
    }

    // Message column: the row wrapper carrying mx-auto + max-w-*.
    const rows = [...document.querySelectorAll('[data-index] > div')]
    const messageRow = rows.find(el => /mx-auto/.test(el.className || '') && /max-w-/.test(el.className || ''))

    return { composer: r(composerWrap), messageRow: r(messageRow) }
  })

const show = (title, m) => {
  console.log(`=== ${title} ===`)
  for (const [name, v] of [
    ['composer  ', m.composer],
    ['messageRow', m.messageRow],
  ]) {
    if (!v) {
      console.log(`${name}: (not found)`)
      continue
    }
    console.log(
      `${name}: width=${v.width}  left=${v.left}  maxW=${v.maxWidth}  padL=${v.paddingLeft}  padR=${v.paddingRight}`,
    )
  }
  if (m.composer && m.messageRow) {
    console.log(`  width 差: ${(m.composer.width - m.messageRow.width).toFixed(1)}px`)
    console.log(`  left  差: ${(m.composer.left - m.messageRow.left).toFixed(1)}px`)
    console.log(`  padL  差: ${m.composer.paddingLeft} vs ${m.messageRow.paddingLeft}`)
  }
  console.log('')
}

show('普通模式', await measure())

// Toggle wide mode via the theme store if it is reachable, else via the sidebar button.
const toggled = await page.evaluate(() => {
  const w = window
  if (w.__themeStore?.toggleWideMode) {
    w.__themeStore.toggleWideMode()
    return 'store'
  }
  return 'unavailable'
})
console.log('toggle wide mode:', toggled)
if (toggled === 'store') {
  await page.waitForTimeout(600)
  show('宽屏模式', await measure())
}

await page.screenshot({ path: join(outDir, 'width.png') })
console.log('')
console.log(`output: ${outDir}`)
await browser.close()
