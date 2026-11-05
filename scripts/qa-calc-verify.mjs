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
await page.waitForTimeout(500)

// Sample real pixels: the colour behind the "Calculator" title (should be page bg, not white-on-white overlap),
// the text colour of the "Basic" tab, and the C key fill.
const probe = await page.evaluate(async () => {
  const el = document.querySelector('.calc-keypad .btn-danger')
  const c = getComputedStyle(el)
  const tab = [...document.querySelectorAll('.calc-modes button')].find((b) => b.textContent === 'Basic')
  return {
    cKey: { color: c.color, background: c.backgroundColor, label: el.textContent },
    basicTab: { color: getComputedStyle(tab).color, background: getComputedStyle(tab).backgroundColor },
    titleRect: document.querySelector('.page-title').getBoundingClientRect().toJSON(),
    basicRect: tab.getBoundingClientRect().toJSON()
  }
})
console.log(JSON.stringify(probe, null, 2))

// New filenames every run: cached image reads can't shadow them.
const stamp = Date.now()
await page.screenshot({ path: `.calch/verify-${stamp}-light-1280.png` })
console.log('WROTE .calch/verify-' + stamp + '-light-1280.png')
await browser.close()
