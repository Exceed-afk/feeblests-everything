import { createRequire } from 'node:module'
import { readdirSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
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
await page.waitForTimeout(600)

const shotPath = '.calch/current-state.png'
await page.screenshot({ path: shotPath })
console.log('screenshot bytes', statSync(shotPath).size)
console.log('target size', await page.evaluate(() => [window.innerWidth, window.innerHeight]))
console.log('basic tab at', await page.evaluate(() => {
  const b = [...document.querySelectorAll('.calc-modes button')].find((x) => x.textContent === 'Basic')
  const r = b.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }
}))
await browser.close()
