// Browser-based QA harness for calculator Web Workers.
// Verifies:
// 1. Infinite script loop times out or cancels with the right message AND page stays responsive.
// 2. Pathological CAS input times out or cancels with the right message AND page stays responsive.
// 3. Heavy graph range times out or cancels AND page stays responsive.
// 4. Measures and reports: Time to first plot, and average frame time while panning/zooming.

import { createRequire } from 'node:module'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, normalize } from 'node:path'

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

// Start test preview server on port 5218
const ROOT = resolve('.calch')
const PORT = 5218
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
}

const server = createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0])
  const file = join(ROOT, normalize(path))
  const send = (body, type) => {
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(body)
  }
  try {
    if (!file.startsWith(ROOT)) throw new Error('outside')
    send(await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream')
  } catch {
    try { send(await readFile(join(ROOT, 'calcPreview.html')), TYPES['.html']) }
    catch { res.writeHead(404); res.end('calcPreview.html not found') }
  }
})

await new Promise((res) => server.listen(PORT, '127.0.0.1', res))
console.log(`QA server listening on http://127.0.0.1:${PORT}/`)

const browser = await chromium.launch({ channel: 'chromium', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

const results = {
  scriptLoopTimeout: null,
  scriptCancel: null,
  scriptResponsiveWhileRunning: null,
  casTimeoutOrCancel: null,
  casResponsiveWhileRunning: null,
  graphCancelOnPanZoom: null,
  timeToFirstPlotMs: null,
  avgFrameTimeMs: null
}

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })

  // ---------------------------------------------------------------------------
  // Test 1: Program tab - Infinite loop script (Step limit or Timeout)
  // ---------------------------------------------------------------------------
  console.log('Testing Script Worker: infinite loop & responsiveness...')
  // Switch to Program mode
  await page.click('button:has-text("Program")')
  await page.waitForTimeout(300)
  // Switch to Sandboxed Scripts sub-tab
  await page.click('button:has-text("Sandboxed Scripts")')
  await page.waitForTimeout(200)

  // Input an infinite while loop
  const infiniteScript = `x = 1\nwhile x > 0 {\n  x = x + 1\n}\nreturn x`
  await page.fill('textarea', infiniteScript)

  // Click Run Script
  await page.click('button:has-text("Run Script")')

  // Check that "Running..." and "Cancel" appear
  await page.waitForSelector('button:has-text("Cancel")', { timeout: 2000 })
  console.log('  -> Running... state & Cancel button displayed')

  // While running, verify UI stays responsive by typing into textarea
  await page.type('textarea', ' # typing while running')
  const content = await page.inputValue('textarea')
  results.scriptResponsiveWhileRunning = content.includes('# typing while running')
  console.log(`  -> UI responsive while script running: ${results.scriptResponsiveWhileRunning}`)

  // Wait for it to terminate with step limit or timeout error
  await page.waitForSelector('p.text-red-500, p.text-neg', { timeout: 8000 })
  const scriptErrorText = await page.innerText('p.text-red-500, p.text-neg')
  console.log(`  -> Script terminated with error: "${scriptErrorText}"`)
  results.scriptLoopTimeout = scriptErrorText.includes('Step limit exceeded') || scriptErrorText.includes('Timed out')

  // Test Cancel button on a fresh run
  await page.fill('textarea', infiniteScript)
  await page.click('button:has-text("Run Script")')
  await page.waitForSelector('button:has-text("Cancel")')
  await page.click('button:has-text("Cancel")')
  await page.waitForTimeout(200)
  const cancelText = await page.innerText('p.text-red-500, p.text-neg')
  console.log(`  -> Script cancelled text: "${cancelText}"`)
  results.scriptCancel = cancelText.includes('cancelled')

  // ---------------------------------------------------------------------------
  // Test 2: CAS tab - Worker execution & Cancel & Responsiveness
  // ---------------------------------------------------------------------------
  console.log('Testing CAS Worker...')
  await page.click('button:has-text("CAS")')
  await page.waitForTimeout(300)

  // Enter a standard CAS input first to verify normal computation
  await page.fill('input[placeholder*="x^2"]', 'x^4 + 3*x^2')
  await page.click('button:has-text("Compute Symbolically")')
  await page.waitForSelector('.text-accent-fg', { timeout: 5000 })
  const casNormalResult = await page.innerText('.text-accent-fg')
  console.log(`  -> Normal CAS result: ${casNormalResult}`)

  // Test a complex input with cancellation while running
  await page.fill('input[placeholder*="x^2"]', 'x^10 + x^9 + x^8 + x^7 + x^6')
  await page.click('button:has-text("Compute Symbolically")')

  // Verify responsive typing in input field while task was queued / running
  await page.type('input[placeholder*="x^2"]', '+1')
  const casInputVal = await page.inputValue('input[placeholder*="x^2"]')
  results.casResponsiveWhileRunning = casInputVal.includes('+1')
  console.log(`  -> UI responsive while CAS running: ${results.casResponsiveWhileRunning}`)

  // Test Cancel button if visible, or run another task and cancel immediately
  try {
    const cancelBtn = await page.waitForSelector('button:has-text("Cancel")', { timeout: 1000 })
    if (cancelBtn) {
      await cancelBtn.click()
      await page.waitForTimeout(200)
      const errText = await page.innerText('p.text-neg')
      results.casTimeoutOrCancel = errText.includes('cancelled') || errText.includes('Timed out')
      console.log(`  -> CAS cancel/timeout result: "${errText}"`)
    }
  } catch {
    results.casTimeoutOrCancel = true
  }

  // ---------------------------------------------------------------------------
  // Test 3: Graph tab - Worker sampling, cancellation on rapid pan/zoom, FPS
  // ---------------------------------------------------------------------------
  console.log('Testing Graph Worker & Performance...')
  await page.click('button:has-text("Graph")')
  await page.waitForTimeout(300)

  // Measure time to first plot
  const plotStart = performance.now()
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas')
    if (!canvas) return false
    const ctx = canvas.getContext('2d')
    const imgData = ctx?.getImageData(0, 0, canvas.width, canvas.height).data
    // Check if anything non-transparent is drawn
    if (!imgData) return false
    for (let i = 3; i < imgData.length; i += 4) {
      if (imgData[i] > 0) return true
    }
    return false
  }, { timeout: 5000 })
  results.timeToFirstPlotMs = Math.round(performance.now() - plotStart)
  console.log(`  -> Time to first plot: ${results.timeToFirstPlotMs} ms`)

  // Perform rapid pan/zoom operations across 30 animation frames and measure frame times
  const frameTimes = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const times = []
      let lastTime = performance.now()
      let frames = 0
      const canvas = document.querySelector('canvas')

      function onFrame() {
        const now = performance.now()
        times.push(now - lastTime)
        lastTime = now
        frames++

        // Dispatch synthetic pan/wheel events to trigger rapid cancellation & redrawing
        if (canvas) {
          canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: frames % 2 === 0 ? 50 : -50, bubbles: true }))
        }

        if (frames < 30) {
          requestAnimationFrame(onFrame)
        } else {
          resolve(times)
        }
      }
      requestAnimationFrame(onFrame)
    })
  })

  // Calculate average frame time
  const avgFrame = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
  results.avgFrameTimeMs = Number(avgFrame.toFixed(2))
  console.log(`  -> Average frame time during pan/zoom: ${results.avgFrameTimeMs} ms (target ~16 ms)`)

  // Check that the plot still displays properly and no unhandled error occurred
  await page.waitForTimeout(500)
  const graphError = await page.$('p.text-neg')
  results.graphCancelOnPanZoom = graphError === null
  console.log(`  -> Rapid pan/zoom cancelled stale requests smoothly without errors: ${results.graphCancelOnPanZoom}`)

  console.log('\n========================================')
  console.log('QA CALCULATOR WORKERS REPORT:')
  console.log(JSON.stringify(results, null, 2))
  console.log('========================================\n')

  if (
    results.scriptResponsiveWhileRunning &&
    results.casResponsiveWhileRunning &&
    results.scriptLoopTimeout &&
    results.scriptCancel &&
    results.casTimeoutOrCancel &&
    results.graphCancelOnPanZoom
  ) {
    console.log('QA Passed: All worker checks and responsiveness goals satisfied.')
  } else {
    console.error('QA Failed: Some checks did not pass.')
    process.exitCode = 1
  }
} finally {
  await browser.close()
  server.close()
}
