// Standalone proof-of-concept for the composer collapse rewrite.
//
// Goal: verify that a `layoutId` morph (input box <-> capsule) looks smooth and
// does NOT break `backdrop-filter`, before touching the real component.
//
// Run:  node scripts/poc-collapse-morph.mjs
// It serves a self-contained page (no app deps) and records a screencast of the
// morph so the result can be inspected frame by frame.

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const outDir = join(tmpdir(), 'opencode', 'poc-morph')
mkdirSync(outDir, { recursive: true })

// A minimal replica of the relevant structure: a glass panel with
// backdrop-filter that morphs into a small capsule.
const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  body { margin:0; background:#111; color:#ddd; font:14px system-ui; height:100vh; }
  .backdrop {
    position:fixed; inset:0;
    background:
      repeating-linear-gradient(0deg,#2a2a2a 0 24px,#333 24px 48px),
      repeating-linear-gradient(90deg,#252525 0 60px,#2e2e2e 60px 120px);
  }
  .dock { position:fixed; left:0; right:0; bottom:24px; display:flex; justify-content:center; }
  .glass {
    background: rgba(40,40,44,.72);
    -webkit-backdrop-filter: blur(22px) saturate(200%);
    backdrop-filter: blur(22px) saturate(200%);
    border:1px solid rgba(255,255,255,.14);
    box-shadow: 0 8px 32px rgba(0,0,0,.4);
    overflow:hidden;
  }
  .panel { width:640px; border-radius:16px; padding:16px; }
  .panel .row { height:56px; display:flex; align-items:center; color:#bbb; }
  .panel .bar { height:32px; margin-top:12px; border-radius:8px; background:rgba(255,255,255,.06); }
  .capsule { width:120px; height:36px; border-radius:999px;
             display:flex; align-items:center; justify-content:center; gap:6px; color:#ddd; }
</style></head>
<body>
  <div class="backdrop"></div>
  <div class="dock" id="dock"></div>

  <script type="importmap">
  { "imports": {
      "motion/react": "https://esm.sh/motion@12.38.0/react?deps=react@19,react-dom@19",
      "react": "https://esm.sh/react@19",
      "react-dom/client": "https://esm.sh/react-dom@19/client"
  } }
  </script>
  <script type="module">
  import React, { useState } from 'react'
  import { createRoot } from 'react-dom/client'
  import { motion, AnimatePresence, LayoutGroup } from 'motion/react'

  const SPRING = { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 }

  function Dock() {
    const [collapsed, setCollapsed] = useState(false)
    React.useEffect(() => {
      window.__toggle = () => setCollapsed(c => !c)
      window.__state = () => collapsed
    }, [collapsed])

    return React.createElement(LayoutGroup, null,
      React.createElement('div', { className: 'dock-inner' },
        // 关键：不要用 AnimatePresence 包裹。
        // mode='popLayout' 会把退场元素弹出布局（position:absolute），
        // 两个元素不再共享布局基准，layoutId 无法交接，退化成交叉淡入淡出。
        // 两个状态互斥，直接条件渲染即可让 layoutId 完成真正的形变。
        collapsed
          ? React.createElement(motion.div, {
              key: 'capsule',
              layoutId: 'composer',
              transition: SPRING,
              className: 'glass capsule',
              onClick: () => setCollapsed(false),
            }, '\\u2191 回复...')
          : React.createElement(motion.div, {
              key: 'panel',
              layoutId: 'composer',
              transition: SPRING,
              className: 'glass panel',
              onClick: () => setCollapsed(true),
            },
            React.createElement('div', { className: 'row' }, '输入框内容区（带 backdrop-filter）'),
            React.createElement('div', { className: 'bar' })
          )
      )
    )
  }

  createRoot(document.getElementById('dock')).render(React.createElement(Dock))
  </script>
</body></html>`

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(html)
})
await new Promise(r => server.listen(0, r))
const port = server.address().port

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1000, height: 700 } })
const page = await context.newPage()
page.on('console', m => console.log('[page]', m.text()))
page.on('pageerror', e => console.log('[pageerror]', e.message))
await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' })
await page.waitForTimeout(1200)

await page.waitForFunction(() => typeof window.__toggle === 'function', { timeout: 15000 })

const client = await context.newCDPSession(page)
const frames = []
client.on('Page.screencastFrame', async ev => {
  frames.push({ ts: ev.metadata.timestamp, data: ev.data })
  try {
    await client.send('Page.screencastFrameAck', { sessionId: ev.sessionId })
  } catch {
    /* ignore */
  }
})
await client.send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 })

// Collapse, wait, expand, wait — record both directions.
await page.evaluate(() => window.__toggle())
await page.waitForTimeout(1100)
await page.evaluate(() => window.__toggle())
await page.waitForTimeout(1100)

await client.send('Page.stopScreencast')
await browser.close()
server.close()

const ts = frames.map(f => f.ts).sort((a, b) => a - b)
const gaps = []
for (let i = 1; i < ts.length; i++) gaps.push((ts[i] - ts[i - 1]) * 1000)
const sorted = [...gaps].sort((a, b) => a - b)
const pct = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]

const lines = []
lines.push(`frames: ${frames.length}   span: ${((ts[ts.length - 1] - ts[0]) * 1000).toFixed(0)}ms`)
lines.push(`interval  min ${sorted[0]?.toFixed(1)}  p50 ${pct(0.5)?.toFixed(1)}  p90 ${pct(0.9)?.toFixed(1)}  max ${sorted[sorted.length - 1]?.toFixed(1)}`)
lines.push(`over 20ms: ${gaps.filter(g => g > 20).length}   over 33ms: ${gaps.filter(g => g > 33).length}`)

let i = 0
for (const f of frames) {
  writeFileSync(join(outDir, `f${String(i).padStart(3, '0')}.jpg`), Buffer.from(f.data, 'base64'))
  i++
}

const report = lines.join('\n')
console.log(report)
writeFileSync(join(outDir, 'timing.txt'), report)
console.log(`frames written: ${i} -> ${outDir}`)
