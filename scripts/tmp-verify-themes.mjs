// Checks that the Phase 4 elements look right in dark and light mode.
// Run with: node scripts/tmp-verify-themes.mjs
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

const cdp = await context.newCDPSession(page)
const { writeFileSync } = await import('node:fs')
const shot = async (name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  writeFileSync(name, Buffer.from(data, 'base64'))
}

await page.getByRole('button', { name: 'Habits', exact: true }).first().click()
await page.waitForSelector('article', { timeout: 8000 })
await page.waitForTimeout(500)

// The theme class on <html> tells us which mode is on.
const themeNow = () => page.evaluate(() => document.documentElement.className + ' | ' + getComputedStyle(document.body).backgroundColor)

// Open the value menu so the screenshot shows the number popover too.
const circle = page.getByRole('button', { name: 'Log Read for 10mn for today' }).first()
await circle.click()
await page.waitForTimeout(400)
await shot('.tmp-theme-current.png')
console.log('current theme:', await themeNow())

// Toggle the theme and shoot again.
const switchBtn = page.getByRole('button', { name: /Switch to (light|dark) mode/ }).first()
console.log('switch button:', await switchBtn.getAttribute('aria-label'))
await switchBtn.click()
await page.waitForTimeout(700)
await shot('.tmp-theme-toggled.png')
console.log('toggled theme:', await themeNow())
console.log('switch button now:', await page.getByRole('button', { name: /Switch to (light|dark) mode/ }).first().getAttribute('aria-label'))

// Check the popover is still open and readable.
const pop = await page.evaluate(() => {
  const el = document.querySelector('.day-pop-value')
  if (!el) return null
  const cs = getComputedStyle(el)
  return { bg: cs.backgroundColor, color: cs.color, border: cs.borderColor, visible: cs.visibility }
})
console.log('popover styles:', JSON.stringify(pop))
process.exit(0)
