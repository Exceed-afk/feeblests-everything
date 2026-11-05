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
await page.waitForTimeout(400)
console.log(await page.evaluate(() => {
  const head = document.querySelector('.calc-head')
  const sub = document.querySelector('.calc-head-title .page-sub')
  const toolbar = document.querySelector('.calc-toolbar')
  const desc = (el) => el ? {
    cls: el.className,
    display: getComputedStyle(el).display,
    width: Math.round(el.getBoundingClientRect().width),
    top: Math.round(el.getBoundingClientRect().top),
    bottom: Math.round(el.getBoundingClientRect().bottom),
    height: Math.round(el.getBoundingClientRect().height),
    parent: el.parentElement?.className
  } : null
  // Which stylesheet rule wins for .calc-head?
  const hits = []
  for (const sheet of document.styleSheets) {
    let rules = []
    try { rules = [...sheet.cssRules] } catch { }
    for (const r of rules) {
      if (r.selectorText && /calc-head|calculator-module|page-title|page-sub|page\b/.test(r.selectorText)) {
        hits.push(r.selectorText + ' { ' + r.style.cssText.slice(0, 160) + ' }')
      }
    }
  }
  const c = document.querySelector('.calc-keypad .btn-danger')
  const cs = c ? getComputedStyle(c) : null
  return { head: desc(head), title: desc(document.querySelector('.calc-head-title')), sub: desc(sub), toolbar: desc(toolbar), styleHits: hits, c: cs ? { color: cs.color, bg: cs.backgroundColor, fgVar: cs.getPropertyValue('--btn-fg'), redText: cs.cssText } : null }
}))
await browser.close()
