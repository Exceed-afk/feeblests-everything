// Screenshots every mode at three widths in both themes, saved under fresh filenames.
import { createRequire } from 'node:module'
import { readdirSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
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

const OUT = process.env.CALCH_OUT || resolve('.calch/final')
mkdirSync(OUT, { recursive: true })
const stamp = process.env.CALCH_STAMP || String(Date.now())
const MODES = ['Basic', 'Scientific', 'Statistics', 'Finance', 'Convert', 'Graph', 'Matrix', 'CAS', 'Program', 'Date/Time']
const WIDTHS = [1280, 1000, 800]

const browser = await chromium.launch({ channel: 'chromium' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto(process.env.CALCH_URL || 'http://127.0.0.1:5207/', { waitUntil: 'networkidle' })

const probe = () => {
  const out = []
  const toolbar = document.querySelector('.calc-toolbar')
  // every header control must sit inside its own toolbar row: no child may overlap another child.
  const kids = [...document.querySelectorAll('.calc-toolbar > *, .calc-tools > *, .calc-modes > button')]
  for (let i = 0; i < kids.length; i++) {
    for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].getBoundingClientRect()
      const b = kids[j].getBoundingClientRect()
      if (a.width === 0 || b.width === 0) continue
      const overlaps = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
      // a wrapper and its own child are expected to overlap; skip ancestor/descendant pairs
      if (kids[i].contains(kids[j]) || kids[j].contains(kids[i])) continue
      if (overlaps) out.push(`"${(kids[i].textContent || '').trim().slice(0, 14)}" overlaps "${(kids[j].textContent || '').trim().slice(0, 14)}"`)
    }
  }
  // the toolbar must start below the title block
  const subEl = document.querySelector('.calc-head-title .page-sub')
  if (subEl && toolbar) {
    const s = subEl.getBoundingClientRect()
    const t = toolbar.getBoundingClientRect()
    if (t.top < s.bottom - 2) out.push('toolbar starts inside the title block')
  }
  // every mode tab must be visible and inside the page
  const pageEl = document.querySelector('.calculator-module')
  const p = pageEl.getBoundingClientRect()
  for (const b of document.querySelectorAll('.calc-modes > button')) {
    const r = b.getBoundingClientRect()
    if (r.right > p.right + 1 || r.bottom > p.bottom + 5000) out.push(`tab "${b.textContent}" outside the page`)
  }
  // subtitle must not be one word per line
  if (subEl) {
    const lh = parseFloat(getComputedStyle(subEl).lineHeight) || 20
    const lines = Math.round(subEl.getBoundingClientRect().height / lh)
    if (lines > 2) out.push(`subtitle on ${lines} lines`)
  }
  // horizontal page overflow
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) out.push('horizontal overflow')
  return out
}

const contrast = () => {
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const nums = (s) => (s.match(/[\d.]+/g) || []).map(Number)
  const bgOf = (el) => { let cur = el; while (cur) { const p = nums(getComputedStyle(cur).backgroundColor); if (p.length >= 3 && (p[3] === undefined || p[3] > 0.5)) return p.slice(0, 3); cur = cur.parentElement } return [255, 255, 255] }
  const ratio = (el) => { const fg = nums(getComputedStyle(el).color).slice(0, 3); const [a, b] = [lum(fg), lum(bgOf(el))].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05) }
  const res = {}
  const sels = {
    activeMode: '.calc-modes > button[aria-pressed="true"]',
    activeAngle: '.calc-tools .seg > button[aria-pressed="true"]',
    clearKey: '.calc-keypad .btn-danger',
    equalsKey: '.calc-keypad .btn-primary',
    helpButton: '.calc-tools button:not([aria-pressed])'
  }
  for (const [k, s] of Object.entries(sels)) { const el = document.querySelector(s); res[k] = el ? Number(ratio(el).toFixed(2)) : null }
  return res
}

const report = []
for (const theme of ['light', 'dark']) {
  // Use the app's own toggle so the real tokens apply.
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  if (isDark !== (theme === 'dark')) { await page.getByRole('button', { name: /^(Dark|Light)$/ }).click(); await page.waitForTimeout(200) }
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(150)
    for (const mode of MODES) {
      await page.getByRole('button', { name: mode, exact: true }).click()
      await page.waitForTimeout(320)
      const problems = await page.evaluate(probe)
      const c = await page.evaluate(contrast)
      const low = Object.entries(c).filter(([, v]) => v !== null && v < 4.5)
      if (problems.length || low.length) report.push({ theme, width, mode, problems, low })
      const slug = mode.replace(/[^a-z0-9]/gi, '').toLowerCase()
      await page.screenshot({ path: join(OUT, `${stamp}-${theme}-${width}-${slug}.png`) })
    }
  }
}
await browser.close()
writeFileSync(join(OUT, `${stamp}-report.json`), JSON.stringify(report, null, 2))
for (const r of report) console.log(`!! ${r.theme} ${r.width} ${r.mode}:`, r.problems.join(' | '), r.low.map(([k, v]) => `${k}=${v}`).join(' '))
console.log(report.length === 0 ? `ok   ${2 * 3 * MODES.length} screenshots, no problems` : `${report.length} problem combinations`)
process.exit(report.length === 0 ? 0 : 1)
