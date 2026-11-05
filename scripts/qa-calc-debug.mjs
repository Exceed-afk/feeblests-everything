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
page.on('console', (m) => console.log('console:', m.type(), m.text().slice(0, 200)))
page.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 300)))
const res = await page.goto('http://127.0.0.1:5207/', { waitUntil: 'networkidle' })
console.log('status', res.status(), 'url', page.url())
await page.waitForTimeout(500)
console.log('body html length', (await page.content()).length)
console.log('root children', await page.evaluate(() => document.getElementById('root')?.childElementCount))
console.log('has calc-head', await page.evaluate(() => !!document.querySelector('.calc-head')))
console.log('scripts', await page.evaluate(() => [...document.querySelectorAll('script')].map((s) => s.src)))
await browser.close()
