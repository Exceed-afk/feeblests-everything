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
for (const base of ['.vscode', '.vscode-insiders', '.cursor', '.windsurf']) {
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

const browser = await chromium.launch({ channel: 'chromium' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto('http://127.0.0.1:5207/', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const info = await page.evaluate(() => ({
  hasHead: !!document.querySelector('.calc-head'),
  hasModes: !!document.querySelector('.calc-modes'),
  title: document.querySelector('.calc-head-title .page-title')?.textContent,
  sub: document.querySelector('.calc-head-title .page-sub')?.textContent,
  tabs: [...document.querySelectorAll('.calc-modes button')].map((b) => b.textContent),
  cClass: document.querySelector('.calc-keypad .btn-danger')?.className,
  cColor: (() => { const el = document.querySelector('.calc-keypad .btn-danger'); return el ? getComputedStyle(el).color + ' on ' + getComputedStyle(el).backgroundColor : null })()
}))
console.log(JSON.stringify(info, null, 2))
await page.screenshot({ path: process.env.CALCH_SHOT || '.calch/probe.png' })
await browser.close()
