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
await page.waitForTimeout(400)
console.log(await page.evaluate(() => {
  const head = document.querySelector('.calc-head')
  const title = document.querySelector('.calc-head-title')
  const sub = document.querySelector('.calc-head-title .page-sub')
  const toolbar = document.querySelector('.calc-toolbar')
  const modes = document.querySelector('.calc-modes')
  const basicTab = [...document.querySelectorAll('.calc-modes button')].find((b) => b.textContent === 'Basic')
  const c = document.querySelector('.calc-keypad .btn-danger')
  const r = (el) => el ? { x: Math.round(el.getBoundingClientRect().left), y: Math.round(el.getBoundingClientRect().top), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null
  return {
    htmlClass: document.documentElement.className,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    headDisplay: head ? getComputedStyle(head).display : null,
    headDir: head ? getComputedStyle(head).flexDirection : null,
    title: r(title), sub: r(sub), toolbar: r(toolbar), modes: r(modes), basicTab: r(basicTab),
    subWhiteSpace: sub ? getComputedStyle(sub).whiteSpace : null,
    cColor: c ? getComputedStyle(c).color : null,
    cBg: c ? getComputedStyle(c).backgroundColor : null,
    cssFiles: [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.getAttribute('href'))
  }
}))
await browser.close()
