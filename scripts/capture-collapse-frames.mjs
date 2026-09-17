#!/usr/bin/env node

/**
 * capture-collapse-frames.mjs - Record the input-box collapse animation frame by frame
 *
 * Usage:
 *   node scripts/capture-collapse-frames.mjs [url]
 *
 * Why this exists: the collapse animation "drops frames" (掉帧), which cannot be
 * diagnosed from source alone. This drives a real browser, forces the collapse by
 * scrolling up, and samples the animation on every animation frame so we can see
 * exactly which frame stalls.
 *
 * What it captures, per animation frame:
 *   - timestamps: to compute the delta between frames (a long delta = a dropped frame)
 *   - getBoundingClientRect of the animated layers: to detect geometric jumps
 *   - computed transform / opacity: to see whether CSS actually interpolated
 *   - inline height / maxHeight: to see the height-constraint swap
 *
 * Artifacts are written to the OS temp dir so the repo stays clean.
 */

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const url = process.argv[2] ?? process.env.OPENCODE_SESSION_URL ?? ''
if (!url) {
  console.error('需要目标会话 URL：node scripts/capture-collapse-frames.mjs <url>')
  console.error('或设置环境变量 OPENCODE_SESSION_URL。')
  process.exit(1)
}
const outDir = join(tmpdir(), 'opencode', 'collapse-frames')
mkdirSync(outDir, { recursive: true })

const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const jsonPath = join(outDir, `frames-${STAMP}.json`)
const reportPath = join(outDir, `report-${STAMP}.txt`)

const browser = await chromium.launch({
  args: ['--enable-gpu-rasterization', '--force-device-scale-factor=1'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()

page.on('console', msg => {
  const text = msg.text()
  if (text.includes('[collapse-probe]')) console.log(text)
})

console.log(`navigating: ${url}`)
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })

// Wait for the composer to exist. The app needs a session loaded; if it never
// appears the caller is probably not logged in.
console.log('waiting for [data-input-box] ...')
await page.waitForSelector('[data-input-box]', { timeout: 60_000 })
console.log('composer found')

// Let the message list settle so scroll geometry is stable.
await page.waitForTimeout(1500)

/**
 * Installed before the collapse is triggered. Records one sample per animation
 * frame while `running` is true. Kept self-contained so it can be re-injected.
 */
const installProbe = () => {
  const state = { samples: [], running: false, t0: 0 }

  const readLayer = el => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      rect: { top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2), height: +r.height.toFixed(2) },
      opacity: cs.opacity,
      transform: cs.transform,
      visibility: cs.visibility,
      inlineHeight: el.style.height || null,
      inlineMaxHeight: el.style.maxHeight || null,
      inlineBottom: el.style.bottom || null,
      inlineTransform: el.style.transform || null,
    }
  }

  const tick = () => {
    if (!state.running) return
    const t = performance.now()
    // DOM order is stable: [0] contentWrap, [1] capsule, [2] input wrapper.
    const layers = [...document.querySelectorAll('[data-collapse-anim]')]
    state.samples.push({
      t: +(t - state.t0).toFixed(2),
      // offsetHeight ignores transform, so it reflects true layout height and
      // separates a real geometry change from a scale() visual change.
      layers: layers.map((el, i) => ({
        kind: ['contentWrap', 'capsule', 'inputWrapper'][i] ?? `layer${i}`,
        offsetH: el.offsetHeight,
        ...readLayer(el),
      })),
      inputBox: readLayer(document.querySelector('[data-input-box]')),
      floating: readLayer(document.querySelector('[data-floating-actions]')),
    })
    requestAnimationFrame(tick)
  }

  window.__collapseProbe = {
    start() {
      state.samples = []
      state.t0 = performance.now()
      state.running = true
      requestAnimationFrame(tick)
    },
    stop() {
      state.running = false
      return state.samples
    },
  }
}

await page.evaluate(installProbe)

// Find the scrollable message list. The app marks it with data-chat-scroll-root.
const scrollRoot = await page.$('[data-chat-scroll-root]')
if (!scrollRoot) {
  console.error('FAIL: no [data-chat-scroll-root]; is a session open and logged in?')
  await browser.close()
  process.exit(1)
}

// Park the list a bit away from the bottom so an upward scroll has room, then
// return to the bottom so the collapse trigger (userScrolled) starts clean.
await page.evaluate(() => {
  const el = document.querySelector('[data-chat-scroll-root]')
  el.scrollTop = el.scrollHeight
})
await page.waitForTimeout(600)

const before = await page.evaluate(() => {
  const el = document.querySelector('[data-chat-scroll-root]')
  const box = document.querySelector('[data-input-box]')
  return {
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    composerVisible: !!box && box.getBoundingClientRect().height > 0,
  }
})
console.log('scroll state before:', JSON.stringify(before))

await page.evaluate(() => window.__collapseProbe.start())

// Drive the collapse the way a user does: a real upward wheel gesture over the
// message list. A plain scrollTop assignment would not set userScrolled.
const box = await scrollRoot.boundingBox()
if (!box) {
  console.error('FAIL: scroll root has no bounding box')
  await browser.close()
  process.exit(1)
}
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, -320)
  await page.waitForTimeout(16)
}

// Capture through the whole animation plus a settle window.
await page.waitForTimeout(900)

const samples = await page.evaluate(() => window.__collapseProbe.stop())

await page.screenshot({ path: join(outDir, `after-${STAMP}.png`) })

const after = await page.evaluate(() => {
  const box = document.querySelector('[data-input-box]')
  const capsule = document.querySelector('[data-collapse-anim]')
  return {
    composerRect: box ? box.getBoundingClientRect().height : null,
    anyCollapsed: capsule ? getComputedStyle(capsule).visibility : null,
  }
})
console.log('state after:', JSON.stringify(after))

writeFileSync(jsonPath, JSON.stringify({ url, before, after, samples }, null, 2))

// Analyze: frame deltas reveal stalls; rect deltas reveal jumps.
const lines = []
lines.push(`url: ${url}`)
lines.push(`frames captured: ${samples.length}`)
lines.push('')

const deltas = []
for (let i = 1; i < samples.length; i++) {
  deltas.push({ delta: samples[i].t - samples[i - 1].t, t: samples[i].t, i })
}
const sorted = [...deltas].sort((a, b) => b.delta - a.delta)
lines.push('=== worst frame gaps (a gap >> 16.7ms means dropped frames) ===')
for (const d of sorted.slice(0, 12)) {
  lines.push(`  frame #${d.i} at t=${d.t}ms  gap=${d.delta.toFixed(2)}ms`)
}
const avg = deltas.reduce((s, d) => s + d.delta, 0) / Math.max(1, deltas.length)
lines.push('')
lines.push(`average gap: ${avg.toFixed(2)}ms  (60fps target = 16.67ms)`)
lines.push(`frames over 20ms: ${deltas.filter(d => d.delta > 20).length}`)
lines.push(`frames over 33ms: ${deltas.filter(d => d.delta > 33).length}`)

lines.push('')
lines.push('=== animated layers: every state change ===')
lines.push('    (offsetH = true layout height, ignores transform; height = visual, includes scale)')
{
  const prevKeys = new Map()
  for (const s of samples) {
    for (const layer of s.layers ?? []) {
      const key = `${layer.offsetH}|${layer.rect.height}|${layer.rect.top}|${layer.opacity}|${layer.transform}|${layer.visibility}`
      if (prevKeys.get(layer.kind) === key) continue
      prevKeys.set(layer.kind, key)
      lines.push(
        `  t=${String(s.t).padStart(7)}ms  [${layer.kind}]  offsetH=${layer.offsetH}  visH=${layer.rect.height}  top=${layer.rect.top}  op=${layer.opacity}  vis=${layer.visibility}  tf=${layer.transform}`,
      )
    }
  }
}

const report = lines.join('\n')
writeFileSync(reportPath, report)

console.log('')
console.log(report)
console.log('')
console.log(`frames json: ${jsonPath}`)
console.log(`report:      ${reportPath}`)
console.log(`screenshot:  ${join(outDir, `after-${STAMP}.png`)}`)

await browser.close()
