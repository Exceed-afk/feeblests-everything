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
  const cs = getComputedStyle(document.documentElement)
  return {
    onAccent: cs.getPropertyValue('--on-accent'),
    accent: cs.getPropertyValue('--accent'),
    rootInline: document.documentElement.getAttribute('style')?.slice(0, 300),
    eq: (() => { const el = document.querySelector('.calc-keypad .btn-primary'); const s = getComputedStyle(el); return { color: s.color, bg: s.backgroundColor, varFg: s.getPropertyValue('--btn-fg') } })()
  }
}))
await browser.close()
