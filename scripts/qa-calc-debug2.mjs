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
page.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 300)))
await page.goto('http://127.0.0.1:5207/', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
console.log(await page.evaluate(() => {
  const t = document.querySelector('.calc-head-title .page-sub')
  const tb = document.querySelector('.calc-toolbar')
  const m = document.querySelector('.calc-modes')
  const cs = (el) => el ? { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height), ws: getComputedStyle(el).whiteSpace } : null
  return {
    sub: { ...cs(t), text: t?.textContent },
    toolbar: cs(tb),
    toolbarDisplay: tb ? getComputedStyle(tb).display : null,
    modes: cs(m),
    modesDisplay: m ? getComputedStyle(m).display : null,
    modesWrap: m ? getComputedStyle(m).flexWrap : null,
    tabs: [...document.querySelectorAll('.calc-modes > button')].slice(0, 4).map((b) => ({ t: b.textContent, ...cs(b) })),
    cBtn: (() => { const b = document.querySelector('.calc-keypad .btn-danger'); if (!b) return null; const s = getComputedStyle(b); return { color: s.color, bg: s.backgroundColor, cls: b.className } })()
  }
}))
await browser.close()
