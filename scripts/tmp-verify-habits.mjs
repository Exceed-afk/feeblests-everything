// Connects to the running Electron app over the Chrome DevTools Protocol and
// checks the Habits page. Run with: node scripts/tmp-verify-habits.mjs
import { createRequire } from 'node:module'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Find patchright the same way the browser-automation skill does.
const here = dirname(fileURLToPath(import.meta.url))
const home = join(homedir(), '.codegpt')
const roots = []
const add = (r) => { if (r && existsSync(r)) roots.push(r) }
add(process.env.CODEGPT_RUNTIME_MODULES)
try { add(JSON.parse(readFileSync(join(home, 'runtime.json'), 'utf8'))?.modulesRoot) } catch { }
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
    if (chromium) { console.log('patchright from', root); break }
  } catch { }
}
if (!chromium) { console.error('patchright not found'); process.exit(1) }

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const context = browser.contexts()[0]
const page = context.pages().find((p) => !p.isClosed()) ?? (await context.newPage())

const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

// Open the Habits page.
await page.getByText('Habits', { exact: true }).first().click().catch(async () => {
  await page.getByRole('button', { name: /Habits/ }).first().click()
})
await page.waitForSelector('article', { timeout: 8000 }).catch(() => { })
await page.waitForTimeout(600)

const info = await page.evaluate(() => ({
  bodyText: document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 1600),
  articles: Array.from(document.querySelectorAll('article')).map((a) => a.innerText.replace(/\s+/g, ' ').trim()),
  dotButtons: Array.from(document.querySelectorAll('article button[aria-label]')).map((b) => b.getAttribute('aria-label')),
  navButtons: Array.from(document.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') || b.innerText.trim()).filter(Boolean).slice(0, 40)
}))

console.log(JSON.stringify(info, null, 1))
console.log('console errors:', errors.slice(0, 8))

await page.screenshot({ path: '.tmp-habits.png', fullPage: true })
console.log('screenshot saved to .tmp-habits.png')
process.exit(0)
