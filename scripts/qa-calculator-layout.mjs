// Screenshots every Calculator mode at several widths, in light and dark themes, and reports
// layout/contrast problems. Uses patchright (Chromium) found the same way the other scripts do.
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

const OUT = process.env.CALCH_OUT || resolve('.calch/shots')
mkdirSync(OUT, { recursive: true })

const MODES = ['Basic', 'Scientific', 'Statistics', 'Finance', 'Convert', 'Graph', 'Matrix', 'CAS', 'Program', 'Date/Time']
const WIDTHS = [1280, 1000, 800]

const browser = await chromium.launch({ channel: 'chromium' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const url = process.env.CALCH_URL || 'http://127.0.0.1:5207/'
await page.goto(url, { waitUntil: 'networkidle' })

const report = []

// Elements that may legitimately stick out: dropdowns/popovers are absolute by design.
const overlapProbe = () => {
  const problems = []
  const head = document.querySelector('.calc-head')
  if (!head) return ['no .calc-head']
  const title = document.querySelector('.calc-head-title')
  const toolbar = document.querySelector('.calc-toolbar')
  const main = document.querySelector('main')
  if (title && toolbar) {
    const a = title.getBoundingClientRect()
    const b = toolbar.getBoundingClientRect()
    if (b.top < a.bottom - 1) problems.push(`toolbar overlaps title (title.bottom=${Math.round(a.bottom)} toolbar.top=${Math.round(b.top)})`)
  }
  if (toolbar && main) {
    const t = toolbar.getBoundingClientRect()
    const page = document.querySelector('.calculator-module')
    const p = page ? page.getBoundingClientRect() : main.getBoundingClientRect()
    if (t.right > p.right + 1) problems.push(`toolbar right edge ${Math.round(t.right)} exceeds content edge ${Math.round(p.right)}`)
  }
  // subtitle line count
  const sub = document.querySelector('.calc-head-title .page-sub')
  if (sub) {
    const lh = parseFloat(getComputedStyle(sub).lineHeight) || 20
    const lines = Math.round(sub.getBoundingClientRect().height / lh)
    if (lines > 2) problems.push(`subtitle wraps to ${lines} lines`)
  }
  // any header control clipped by the window (the tab strip scrolls on purpose: skip it)
  for (const el of document.querySelectorAll('.calc-toolbar button, .calc-toolbar select')) {
    if (el.closest('.calc-modes')) continue
    const r = el.getBoundingClientRect()
    if (r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)) {
      problems.push(`header control "${(el.textContent || el.id).trim().slice(0, 20)}" outside the window`)
    }
  }
  return problems
}

// WCAG contrast for the controls that look wrong in the screenshot.
const contrastProbe = () => {
  const lum = (c) => {
    const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const parse = (s) => (s.match(/[\d.]+/g) || []).map(Number)
  // Walk up until a non-transparent background is found.
  const bgOf = (el) => {
    let cur = el
    while (cur) {
      const bg = getComputedStyle(cur).backgroundColor
      const p = parse(bg)
      if (p.length >= 3 && (p[3] === undefined || p[3] > 0.5)) return p.slice(0, 3)
      cur = cur.parentElement
    }
    return [255, 255, 255]
  }
  const ratio = (el) => {
    const fg = parse(getComputedStyle(el).color).slice(0, 3)
    const bg = bgOf(el)
    const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a)
    return (l1 + 0.05) / (l2 + 0.05)
  }
  const out = {}
  for (const [name, sel] of [['activeMode', '.calc-modes > button[aria-pressed="true"]'], ['activeAngle', '.calc-tools .seg > button[aria-pressed="true"]'], ['clear', '.calc-keypad > .btn.mb-danger, .calc-keypad .btn-danger']]) {
    const el = document.querySelector(sel)
    out[name] = el ? Number(ratio(el).toFixed(2)) : null
  }
  return out
}

async function runCurrencyStates(theme, width) {
  const shots = []
  const shot = async (name) => {
    const file = join(OUT, `${theme}-${width}-currency-${name}.png`)
    await page.screenshot({ path: file, fullPage: false })
    shots.push(file)
  }
  const problems = []

  // Fresh storage per theme/width so each run starts from the same known state.
  const ensureTheme = async () => {
    // The harness starts light on every reload, so re-apply the run's theme.
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
    if (isDark !== (theme === 'dark')) {
      await page.getByRole('button', { name: /^(Dark|Light)$/ }).click()
      await page.waitForTimeout(200)
    }
    const okNow = await page.evaluate(() => document.documentElement.classList.contains('dark'))
    if (okNow !== (theme === 'dark')) problems.push(`theme did not switch to ${theme}`)
  }
  const reload = async () => {
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(250)
    await ensureTheme()
  }
  await ensureTheme()

  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('calc_')) localStorage.removeItem(k)
  })
  await reload()

  const openCurrencyTab = async () => {
    await page.locator('.calc-modes button:has-text("Convert")').click()
    await page.getByRole('button', { name: 'Offline Currency Rates' }).click()
    await page.waitForTimeout(300)
  }
  const convertButton = () => page.locator('.calc-cur-card').filter({ hasText: 'Conversion' }).getByRole('button', { name: 'Convert currency' })

  await openCurrencyTab()
  await shot('empty-state')

  // 1. Two fresh rates (today) + set the stale threshold low enough to exercise the warning.
  const addRate = async (code, rate, note) => {
    await page.getByLabel('Currency code', { exact: true }).fill(code)
    await page.getByLabel(/Rate per 1/).fill(rate)
    await page.getByLabel('Note (optional)', { exact: true }).fill(note)
    await page.getByRole('button', { name: 'Save rate', exact: true }).click()
    await page.waitForTimeout(150)
  }
  await addRate('EUR', '0.92', 'ECB')
  await addRate('GBP', '0.79', 'Bank')
  await shot('rates')

  // 2. A conversion with a stale rate: back-date GBP in storage and reload the set.
  await page.evaluate(() => {
    const key = 'calc_rates'
    const rows = JSON.parse(localStorage.getItem(key) || '[]')
    const old = new Date(Date.now() - 12 * 86400000).toISOString()
    for (const r of rows) if (r.currencyCode === 'GBP') r.updatedAt = old
    localStorage.setItem(key, JSON.stringify(rows))
  })
  await reload()
  await page.waitForTimeout(300)
  await openCurrencyTab()
  await page.getByLabel('Amount').fill('100')
  await page.locator('#calc-cur-from').fill('USD')
  await page.locator('#calc-cur-to').fill('GBP')
  await convertButton().click()
  await page.waitForTimeout(300)
  const staleVisible = await page.locator('[data-cur-state="stale"]').count()
  if (staleVisible === 0) problems.push('stale warning not shown for a 12-day-old rate')
  if (!(await page.getByText(/Stale rate/).isVisible().catch(() => false))) problems.push('stale warning text missing')
  await shot('stale-warning')

  // 3. Pair override used by a conversion.
  await page.locator('#calc-cur-ov-from').fill('EUR')
  await page.locator('#calc-cur-ov-to').fill('GBP')
  await page.getByLabel(/Rate \(1 From/).fill('0.88')
  await page.getByRole('button', { name: 'Add override', exact: true }).click()
  await page.waitForTimeout(200)
  await page.getByLabel('Amount').fill('50')
  await page.locator('#calc-cur-from').fill('EUR')
  await page.locator('#calc-cur-to').fill('GBP')
  await convertButton().click()
  await page.waitForTimeout(300)
  const overrideVisible = await page.locator('[data-cur-state="override"]').count()
  if (overrideVisible === 0) problems.push('override notice not shown')
  await shot('override-notice')

  // 4. Validation error from the logic layer (bad code), then the missing-rate shortcut.
  await page.getByLabel('Currency code', { exact: true }).fill('TOOLONG')
  await page.getByLabel(/Rate per 1/).fill('1.1')
  await page.getByRole('button', { name: 'Save rate', exact: true }).click()
  await page.waitForTimeout(200)
  if (!(await page.getByText(/3 to 5 characters/).isVisible().catch(() => false))) problems.push('code validation message missing')
  await shot('validation-error')

  await page.locator('#calc-cur-to').fill('CAD')
  await convertButton().click()
  await page.waitForTimeout(300)
  if (!(await page.getByText(/Missing rate for CAD/).isVisible().catch(() => false))) problems.push('missing-rate message missing')
  if (!(await page.getByRole('button', { name: /Add CAD below/ }).isVisible().catch(() => false))) problems.push('missing-rate shortcut missing')
  await shot('missing-rate')
  // The shortcut puts the code in the editor so one Enter saves it.
  await page.getByRole('button', { name: /Add CAD below/ }).click()
  const seeded = await page.getByLabel('Currency code', { exact: true }).inputValue()
  if (seeded !== 'CAD') problems.push(`missing-rate shortcut left the code as "${seeded}"`)
  await page.getByLabel('Currency code', { exact: true }).fill('')

  // 5. Import preview: a valid file (one row updates, one is new).
  await page.getByLabel(/or paste CSV/).fill('code,rate,name,note\nEUR,0.95,Euro updated,Spot\nCHF,0.88,Swiss Franc,Bank')
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await page.waitForTimeout(250)
  if (!(await page.getByRole('region', { name: 'Import preview' }).isVisible().catch(() => false))) problems.push('import preview missing')
  await shot('import-preview')

  // 6. Import preview with a rejected row: named row, nothing applied.
  await page.getByLabel(/or paste CSV/).fill('code,rate\nEUR,0.95\nGBP,-1')
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await page.waitForTimeout(250)
  if (!(await page.getByText(/Rejected — nothing was changed/).isVisible().catch(() => false))) problems.push('import rejection message missing')
  await shot('import-rejected')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()

  // 7. Inline edit of an existing rate.
  await page.getByRole('button', { name: /^Edit GBP/ }).click()
  await page.waitForTimeout(200)
  await shot('editing')

  // 8. Keyboard-only pass: Tab from the top of the panel reaches the rate editor's
  //    value button, Enter opens the editor, Escape closes it.
  await reload()
  await page.waitForTimeout(250)
  await openCurrencyTab()
  await page.getByLabel('Active set').focus()
  let reachedEdit = false
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    const name = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || '')
    if (/^Edit rate for/.test(name)) { reachedEdit = true; break }
  }
  if (!reachedEdit) problems.push('keyboard tab order never reaches a rate value button')
  if (reachedEdit) {
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)
    const opened = await page.locator('[data-editing="true"]').count()
    if (opened === 0) problems.push('Enter on a rate value does not open the editor')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    const closed = await page.locator('[data-editing="true"]').count()
    if (closed !== 0) problems.push('Escape does not close the rate editor')
    await shot('keyboard-edit')
  }

  return { shots, problems }
}

async function runGraphStates(theme, width) {
  const shots = []
  const shot = async (name) => {
    const file = join(OUT, `${theme}-${width}-graph-${name}.png`)
    await page.screenshot({ path: file, fullPage: false })
    shots.push(file)
  }
  const problems = []

  const panel = page.locator('[data-testid="panel-graph"]')

  // 1. Function plot is the default state (already open from the mode loop).
  await page.waitForTimeout(400)
  await shot('function-default')

  // 2. Parametric state: inputs and a plotted unit circle.
  await panel.getByRole('button', { name: 'Parametric' }).click()
  await page.waitForTimeout(600)
  const xExpr = panel.locator('input[aria-label="x of t expression"]')
  if (!(await xExpr.isVisible())) problems.push('parametric x(t) input missing')
  await xExpr.fill('cos(t)')
  await panel.locator('input[aria-label="y of t expression"]').fill('sin(t)')
  await page.waitForTimeout(500)
  await shot('parametric')

  // 3. Polar state with a rose curve.
  await panel.getByRole('button', { name: 'Polar' }).click()
  await page.waitForTimeout(600)
  const rExpr = panel.locator('input[aria-label="r of theta expression"]')
  if (!(await rExpr.isVisible())) problems.push('polar r(theta) input missing')
  await rExpr.fill('1 + 0.3theta')
  await page.waitForTimeout(500)
  await shot('polar')

  // 4. Value table with a filled result (function plots, x^2 - 4).
  await panel.getByRole('button', { name: 'y = f(x)' }).click()
  await page.waitForTimeout(400)
  await panel.locator('input[aria-label="Table start"]').fill('0')
  await panel.locator('input[aria-label="Table step"]').fill('0.5')
  await panel.locator('input[aria-label="Table count"]').fill('6')
  await panel.getByRole('button', { name: 'Build table' }).click()
  await page.waitForTimeout(400)
  const rows = panel.locator('[data-testid="graph-table-rows"] tbody tr')
  if ((await rows.count()) === 0) problems.push('value table did not build rows')
  await shot('value-table')

  // 5. Derivative result: x^2 - 4 at 3 gives f'(3) = 6, plus the tangent toggle.
  await panel.locator('input[aria-label="Derivative point"]').fill('3')
  await panel.getByRole('button', { name: /Compute f/ }).click()
  await page.waitForTimeout(400)
  const deriv = panel.locator('[data-testid="graph-derivative-result"]')
  if (!(await deriv.isVisible())) problems.push('derivative result missing')
  const derivText = (await deriv.textContent()) || ''
  if (!/6/.test(derivText)) problems.push(`derivative of x^2-4 at 3 should mention 6, got "${derivText.slice(0, 40)}"`)
  await shot('derivative')

  // 6. Non-differentiable message: abs(x) at 0.
  await panel.locator('input[placeholder="e.g. sin(x) or 3x - 2"]').fill('abs(x)')
  await panel.getByRole('button', { name: 'Add', exact: true }).first().click()
  await page.waitForTimeout(400)
  await panel.locator('input[aria-label="Derivative point"]').fill('0')
  await panel.getByRole('button', { name: /Compute f/ }).click()
  await page.waitForTimeout(400)
  const absText = (await deriv.textContent()) || ''
  if (!/Not differentiable/.test(absText)) problems.push(`abs(x) at 0 should read "Not differentiable", got "${absText.slice(0, 40)}"`)
  await shot('derivative-nondifferentiable')

  return { shots, problems }
}

// Switching theme uses the app's own toggle, so the tokens are the real ones (not just the class).
for (const theme of ['light', 'dark']) {
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  if (isDark !== (theme === 'dark')) {
    await page.getByRole('button', { name: /^(Dark|Light)$/ }).click()
    await page.waitForTimeout(200)
  }
  await page.waitForTimeout(120)

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(120)

    for (const mode of MODES) {
      await page.locator('.calc-modes button', { hasText: mode }).first().click()
      await page.waitForTimeout(300)
      const problems = await page.evaluate(overlapProbe)
      const contrast = await page.evaluate(contrastProbe)
      const entry = { theme, width, mode, problems, contrast }
      report.push(entry)
      const file = join(OUT, `${theme}-${width}-${mode.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.png`)
      await page.screenshot({ path: file, fullPage: false })
    }
    // Basic-mode shot with history panel open, to check the two-column layout.
    await page.locator('.calc-modes button:has-text("Basic")').click()
    await page.getByRole('button', { name: /^History/ }).click()
    await page.waitForTimeout(300)
    report.push({ theme, width, mode: 'Basic+History', problems: await page.evaluate(overlapProbe), contrast: await page.evaluate(contrastProbe) })
    await page.screenshot({ path: join(OUT, `${theme}-${width}-basic-history.png`), fullPage: false })
    await page.getByRole('button', { name: /^History/ }).click()
    await page.waitForTimeout(150)

    // Currency states (stale warning, override notice, import preview, validation errors, keyboard edit).
    const currency = await runCurrencyStates(theme, width)
    report.push({ theme, width, mode: 'Currency+states', problems: currency.problems, contrast: {}, shots: currency.shots })

    // Graph states (plot types, value table, derivative) in the same theme/width.
    await page.locator('.calc-modes button:has-text("Graph")').click()
    await page.waitForSelector('[data-testid="panel-graph"]')
    await page.waitForTimeout(400)
    const graph = await runGraphStates(theme, width)
    report.push({ theme, width, mode: 'Graph+states', problems: graph.problems, contrast: {}, shots: graph.shots })
  }
}

await browser.close()
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))

let bad = 0
for (const r of report) {
  const lowContrast = Object.entries(r.contrast).filter(([, v]) => v !== null && v < 4.5)
  if (r.problems.length || lowContrast.length) {
    bad++
    console.log(`!! ${r.theme} ${r.width}px ${r.mode}:`, r.problems.join(' | ') || '', lowContrast.map(([k, v]) => `${k}=${v}`).join(' '))
  }
}
console.log(bad === 0 ? `ok   ${report.length} screenshots, no layout or contrast problems` : `${bad}/${report.length} combinations have problems`)
process.exit(bad === 0 ? 0 : 1)
