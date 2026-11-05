// Reads the live habit state from the running app to check today's dot states.
// Run with: node scripts/tmp-check-today.mjs
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
for (const base of ['.vscode', '.vscode-insiders', '.cursor', '.windsurf', '.trae', '.kiro']) {
  const dir = join(homedir(), base, 'extensions')
  if (!existsSync(dir)) continue
  const newest = readdirSync(dir).filter((d) => d.startsWith('danielsanmedium.dscodegpt-')).sort().pop()
  if (newest) add(join(dir, newest, 'standalone'))
}
let chromium = null
for (const root of roots) {
  try {
    const mod = createRequire(root)('patchright')
    chromium = mod?.chromium ?? mod?.default?.chromium
    if (chromium) break
  } catch { }
}
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const context = browser.contexts()[0]
let page = null
for (const p of context.pages()) {
  if (!p.isClosed() && p.url().includes('index.html') && !p.url().includes('#capture')) { page = p; break }
}
await page.getByRole('button', { name: 'Habits', exact: true }).first().click()
await page.waitForSelector('article', { timeout: 8000 })
await page.waitForTimeout(500)

const rows = await page.evaluate(() =>
  Array.from(document.querySelectorAll('article')).map((a) => ({
    name: a.querySelector('.font-medium')?.textContent,
    dots: Array.from(a.querySelectorAll('.hd')).map((d) => ({
      label: d.getAttribute('aria-label'),
      state: d.getAttribute('data-state'),
      today: d.getAttribute('data-today')
    }))
  }))
)
console.log(JSON.stringify(rows, null, 1))
console.log('browser today:', await page.evaluate(() => new Date().toDateString()))
process.exit(0)
