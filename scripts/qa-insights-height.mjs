// Measures the REAL Insights page through Electron's CDP port (9222) with raw
// WebSocket (Node 22's global) — no dependencies. Launch the app first with:
//   node scripts/launch.cjs "--remote-debugging-port=9222"
import fs from 'node:fs'

let ws = null
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((resolve) => {
  const msgId = ++id
  pending.set(msgId, resolve)
  ws.send(JSON.stringify({ id: msgId, method, params }))
})
const onMessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result ?? msg.error); pending.delete(msg.id) }
}
const connect = () => fetch('http://127.0.0.1:9222/json')
  .then((res) => res.json())
  .then((targets) => new Promise((resolve, reject) => {
    const page = targets.find((t) => t.type === 'page')
    if (!page) return reject(new Error('no page target'))
    const socket = new WebSocket(page.webSocketDebuggerUrl)
    socket.addEventListener('open', () => resolve(socket))
    socket.addEventListener('error', reject)
  }))

ws = await connect()
ws.addEventListener('message', onMessage)

await send('Runtime.enable')
// Navigate: sidebar button labelled "Settings" first, as the healthy baseline.
await send('Runtime.evaluate', {
  expression: "[...document.querySelectorAll('button, a')].find(b => b.textContent.trim() === 'Settings')?.click(); true",
  returnByValue: true
})
await new Promise((r) => setTimeout(r, 1200))
const baseline = await send('Runtime.evaluate', {
  expression: `({ docScrollH: document.documentElement.scrollHeight, bodyScrollH: document.body.scrollHeight, innerHeight: window.innerHeight, sbH: document.querySelector('.sb')?.clientHeight })`,
  returnByValue: true
})
console.log('BASELINE Settings:', JSON.stringify(baseline.result.value))
// Navigate: sidebar button labelled "Insights".
await send('Runtime.evaluate', {
  expression: "[...document.querySelectorAll('button, a')].find(b => b.textContent.trim() === 'Insights')?.click(); true",
  returnByValue: true
})
await new Promise((r) => setTimeout(r, 1500))
// Force the size class where the bug shows (the emulated window ends ~927 css px tall on the user's 125% DPI screen).
await send('Emulation.setDeviceMetricsOverride', { width: 1231, height: 742, deviceScaleFactor: 1.25, mobile: false })
await new Promise((r) => setTimeout(r, 400))
// after animations settle
// Which element's layout box reaches the phantom overflow (htmlScrollH ~1038)?
const probe2 = await send('Runtime.evaluate', {
  expression: `(() => {
    const target = document.documentElement.scrollHeight
    const hits = []
    for (const el of document.querySelectorAll('html, body, body *')) {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const absBottom = r.bottom + window.scrollY
      if (Math.round(absBottom) >= target - 2) {
        hits.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), pos: cs.position, h: Math.round(r.height), absBottom: Math.round(absBottom) })
      }
    }
    return { target, scrollY: window.scrollY, innerH: window.innerHeight, hits: hits.slice(0, 14) }
  })()`,
  returnByValue: true
})
console.log(JSON.stringify(probe2.result.value, null, 2))
// Visual check: full page + scrolled to bottom.
await send('Page.enable')
await send('Runtime.evaluate', { expression: "document.documentElement.dataset.style = 'minimal'; document.documentElement.classList.remove('dark'); true", returnByValue: true })
await new Promise((r) => setTimeout(r, 300))
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('scripts/qa-insights.png', Buffer.from(shot.data, 'base64'))
await send('Runtime.evaluate', { expression: "document.querySelector('main').scrollTo(0, 99999); true", returnByValue: true })
await new Promise((r) => setTimeout(r, 400))
const shot2 = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('scripts/qa-insights-bottom.png', Buffer.from(shot2.data, 'base64'))
console.log('screenshots saved (minimal, light)')
// Scroll to the bottom of the page to see what is down there
await new Promise((r) => setTimeout(r, 300))
const probe = await send('Runtime.evaluate', {
  expression: `(() => {
    const el = document.elementFromPoint(600, window.innerHeight - 10)
    return { atBottom: el ? el.tagName + '.' + String(el.className).slice(0, 40) : null,
             scrollAfterScroll: window.scrollY,
             docScrollH: document.documentElement.scrollHeight,
             innerHeight: window.innerHeight }
  })()`,
  returnByValue: true
})
console.log(JSON.stringify(probe.result.value))
// Return to top BEFORE measuring, so getBoundingClientRect reflects layout positions.
await send('Runtime.evaluate', { expression: 'window.scrollTo(0, 0); true', returnByValue: true })
await new Promise((r) => setTimeout(r, 300))

const measure = await send('Runtime.evaluate', {
  expression: `(() => {
    const main = document.querySelector('main')
    const sb = document.querySelector('.sb')
    const pageEl = document.querySelector('.page')
    const mainRect = main.getBoundingClientRect()
    const escapers = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.height > 0 && r.bottom > mainRect.bottom + 2 && !main.contains(el) && el.tagName !== 'MAIN') {
        escapers.push({ tag: el.tagName, cls: String(el.className).slice(0, 50), top: Math.round(r.top), bottom: Math.round(r.bottom) })
      }
    }
    // Anything positioned below the viewport in LAYOUT terms, fixed/absolute too,
    // that could stretch documentElement's scroll area:
    const belowViewport = []
    for (const el of document.querySelectorAll('body > *')) {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      belowViewport.push({ tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 40), pos: cs.position, rectBottom: Math.round(r.bottom), scrollH: el.scrollHeight })
    }
    return {
      htmlScrollH: document.documentElement.scrollHeight,
      htmlClientH: document.documentElement.clientHeight,
      htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
      bodyOffsetH: document.body.offsetHeight,
      bodyScrollH: document.body.scrollHeight,
      innerHeight: window.innerHeight,
      sbH: sb?.clientHeight,
      mainH: main?.clientHeight,
      mainScrollH: main?.scrollHeight,
      mainRectBottom: Math.round(mainRect.bottom),
      mainOverflowY: main ? getComputedStyle(main).overflowY : null,
      pageH: pageEl?.clientHeight,
      escapers: escapers.slice(0, 10),
      belowViewport,
      tables: [...document.querySelectorAll('.tbl')].map((t) => {
        const row = t.querySelector('tbody tr:last-child')
        if (!row) return null
        return {
          caption: t.querySelector('caption')?.textContent,
          lastRowBorders: [...row.children].map((c) => getComputedStyle(c).borderBottomWidth),
          headerBorders: [...t.querySelectorAll('thead th')].map((th) => getComputedStyle(th).borderBottomWidth)
        }
      })
    }
  })()`,
  returnByValue: true
})
const out = JSON.stringify(measure.result.value, null, 2)
console.log(out)
fs.writeFileSync('scripts/qa-result.json', out)
process.exit(0)
