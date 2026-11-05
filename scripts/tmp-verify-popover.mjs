// Clicks a past day dot and checks the day-status popover that opens.
// Run with: node scripts/tmp-verify-popover.mjs
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
if (!chromium) { console.error('patchright not found'); process.exit(1) }

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const context = browser.contexts()[0]
let page = null
for (const p of context.pages()) {
  if (!p.isClosed() && p.url().includes('index.html') && !p.url().includes('#capture')) { page = p; break }
}
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

const cdp = await context.newCDPSession(page)
const { writeFileSync } = await import('node:fs')
const shot = async (name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  writeFileSync(name, Buffer.from(data, 'base64'))
}

// 1. Click a past "missed" dot on "Read for 10mn" (Wed 28 Oct was skipped, use Mon 26 missed).
const skippedDot = page.getByRole('button', { name: 'Wed, Oct 28, 2026: skipped' }).first()
await skippedDot.click()
await page.waitForTimeout(400)

let pop = await page.evaluate(() => {
  const el = document.querySelector('.day-pop')
  if (!el) return null
  return {
    role: el.getAttribute('role'),
    label: el.getAttribute('aria-label'),
    head: el.querySelector('.day-pop-head')?.textContent,
    items: Array.from(el.querySelectorAll('button')).map((b) => b.innerText.trim()),
    checked: Array.from(el.querySelectorAll('button')).filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.innerText.trim()),
    position: getComputedStyle(el).position
  }
})
console.log('popover after click:', JSON.stringify(pop, null, 1))
await shot('.tmp-popover.png')

// 2. Choose "Done" and check the dot changes.
if (pop) {
  await page.getByRole('menuitemradio', { name: 'Done' }).first().click()
  await page.waitForTimeout(700)
  const after = await page.evaluate(() => ({
    dot: document.querySelector('button[aria-label*="Wed, Oct 28, 2026"]')?.getAttribute('aria-label'),
    popoverGone: !document.querySelector('.day-pop'),
    streak: document.body.innerText.match(/(\d+) day streak/g)
  }))
  console.log('after choosing Done:', JSON.stringify(after))
  await shot('.tmp-after-done.png')
}

// 3. Check the week navigation: click "<" and see the label change.
await page.getByRole('button', { name: 'Previous week' }).click()
await page.waitForTimeout(500)
const prev = await page.evaluate(() => document.body.innerText.match(/\d+ \w+ - \d+ \w+/)?.[0])
console.log('week label after previous:', prev)
await shot('.tmp-prev-week.png')

console.log('console errors:', errors.slice(0, 8))
process.exit(0)
