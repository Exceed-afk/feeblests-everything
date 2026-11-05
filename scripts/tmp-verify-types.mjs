// Connects to the running Electron app and checks the Phase 4 habit types.
// Run with: node scripts/tmp-verify-types.mjs
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
if (!page) { console.error('main window not found'); process.exit(1) }

const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

const cdp = await context.newCDPSession(page)
const { writeFileSync } = await import('node:fs')
const shot = async (name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  writeFileSync(name, Buffer.from(data, 'base64'))
}

// Reload so the new seed data is picked up.
await page.reload()
await page.waitForTimeout(1500)
await page.getByRole('button', { name: 'Habits', exact: true }).first().click()
await page.waitForSelector('article', { timeout: 8000 })
await page.waitForTimeout(600)

const rows = await page.evaluate(() =>
  Array.from(document.querySelectorAll('article')).map((a) => ({
    name: a.querySelector('.font-medium')?.textContent,
    stats: a.innerText.replace(/\s+/g, ' ').trim(),
    circleLabel: a.querySelector('button.check')?.getAttribute('aria-label')
  }))
)
console.log('ROWS:', JSON.stringify(rows, null, 1))
await shot('.tmp-types.png')

// Open the number menu on the duration habit.
const readCircle = page.getByRole('button', { name: 'Log Read for 10mn for today' }).first()
if (await readCircle.count()) {
  await readCircle.click()
  await page.waitForTimeout(500)
  const pop = await page.evaluate(() => {
    const el = document.querySelector('.day-pop-value')
    if (!el) return null
    return {
      role: el.getAttribute('role'),
      label: el.getAttribute('aria-label'),
      head: el.querySelector('.day-pop-head')?.textContent,
      input: el.querySelector('input')?.getAttribute('aria-label'),
      buttons: Array.from(el.querySelectorAll('button')).map((b) => (b.getAttribute('aria-label') || b.innerText).trim())
    }
  })
  console.log('VALUE POPOVER:', JSON.stringify(pop, null, 1))
  await shot('.tmp-value-popover.png')

  // Type 12 and save, then check the row.
  await page.locator('.day-pop-value input').fill('12')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForTimeout(800)
  const after = await page.evaluate(() =>
    Array.from(document.querySelectorAll('article')).map((a) => ({
      name: a.querySelector('.font-medium')?.textContent,
      stats: a.innerText.replace(/\s+/g, ' ').trim()
    }))
  )
  console.log('AFTER SAVE:', JSON.stringify(after, null, 1))
  await shot('.tmp-after-save.png')
} else {
  console.log('the duration habit circle was not found')
}

console.log('console errors:', errors.slice(0, 8))
process.exit(0)
