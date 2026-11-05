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
  const root = document.documentElement
  const cs = getComputedStyle(root)
  const eq = document.querySelector('.calc-keypad .btn-primary')
  const es = getComputedStyle(eq)
  return {
    inlineStyle: root.getAttribute('style'),
    accentVar: cs.getPropertyValue('--accent'),
    onAccentVar: cs.getPropertyValue('--on-accent'),
    eqColor: es.color,
    eqBg: es.backgroundColor,
    eqClass: eq.className,
    btnFg: es.getPropertyValue('--btn-fg')
  }
}))
await browser.close()
