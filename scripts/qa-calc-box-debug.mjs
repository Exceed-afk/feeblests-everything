import { createRequire } from 'node:module'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const roots = []
const add = (r) => { if (r && existsSync(r)) roots.push(r) }
add(process.env.CODEGPT_RUNTIME_MODULES)
try { add(JSON.parse(readFileSync(join(homedir(), '.codegpt', 'runtime.json'), 'utf8'))?.modulesRoot) } catch { }
add(resolve(here, '..', '..'))
let chromium = null
for (const root of roots) {
  try { const m = createRequire(root)('patchright'); chromium = m?.chromium ?? m?.default?.chromium; if (chromium) break } catch { }
}
const browser = await chromium.launch({ channel: 'chromium' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto('http://127.0.0.1:5207/', { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
console.log(await page.evaluate(() => {
  const card = document.querySelector('.calc-main > div')
  const input = document.querySelector('.calc-expr')
  const row = card?.querySelector('.mt-3')
  const box = (el) => el ? { h: Math.round(el.getBoundingClientRect().height), display: getComputedStyle(el).display, cls: String(el.className).slice(0, 60) } : null
  return {
    card: box(card), input: box(input), resultRow: box(row),
    cardChildren: [...(card?.children || [])].map((c) => ({ tag: c.tagName, text: (c.textContent || '').trim().slice(0, 20), ...box(c) })),
    cardPad: card ? getComputedStyle(card).padding : null,
    cardH: card ? getComputedStyle(card).height : null,
    mainChildren: [...(document.querySelector('.calc-main')?.children || [])].map((c) => ({ tag: c.tagName, ...box(c) })),
    mainH: box(document.querySelector('.calc-main')),
    historyH: box(document.querySelector('.calc-history')),
    mainDisplay: getComputedStyle(document.querySelector('.calc-main')).display,
    mainFlexDir: getComputedStyle(document.querySelector('.calc-main')).flexDirection
  }
}))
await browser.close()
