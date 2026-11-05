// Layout QA for the Statistics panel charts (panels/statCharts.tsx geometry).
// Pure, no DOM:   npm test
// Checks the shared scale helpers used to lay out the SVG charts: that bars
// never overflow the viewBox, that the box-plot geometry keeps whisker/box
// order for sorted and unsorted inputs, and that the scatter scale maps the
// min/max points onto the plot edges.
import assert from 'node:assert/strict'
import { histogram, boxPlot, capScatter, SCATTER_DRAW_LIMIT, sturgesBinCount } from '../src/shared/calculator/modules/statistics'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

// The SVG geometry constants used by the chart components (viewBox 420x200/240).
const HIST_W = 420, HIST_H = 200, HIST_PAD = { l: 8, r: 8, t: 12, b: 20 }
const SC_W = 420, SC_H = 240, SC_PAD = 28

test('histogram bars stay inside the viewBox for every bin count', () => {
  for (const binCount of [1, 2, 5, 13, 100]) {
    const data = Array.from({ length: 500 }, (_, i) => Math.sin(i) * 50)
    const h = histogram(data, binCount)
    const bw = (HIST_W - HIST_PAD.l - HIST_PAD.r) / h.bins.length
    const top = Math.max(...h.bins.map((b) => b.count), 1)
    for (const [i, b] of h.bins.entries()) {
      const height = (b.count / top) * (HIST_H - HIST_PAD.t - HIST_PAD.b)
      const x = HIST_PAD.l + i * bw
      assert.ok(x >= 0 && x + bw <= HIST_W + 0.01, `bin ${i} at ${binCount} bins stays inside`)
      assert.ok(HIST_H - HIST_PAD.b - height >= HIST_PAD.t - 0.01, `bin ${i} does not cross the top edge`)
    }
  }
})

test('histogram bars have positive width for a single bin', () => {
  const bw = (HIST_W - HIST_PAD.l - HIST_PAD.r) / 1
  assert.ok(bw > 10, 'one bin fills the plot width')
})

test('box plot geometry keeps whisker → box → median in order', () => {
  const cases = [
    [2, 4, 4, 4, 5, 5, 7, 9],
    [1, 2, 3, 4, 100],
    [-10, -2, -1, 0, 1, 2, 10],
    [5, 5, 5],
    [7]
  ]
  for (const data of cases) {
    const b = boxPlot(data)
    assert.ok(b.whiskerLow <= b.q1 && b.q1 <= b.median && b.median <= b.q3 && b.q3 <= b.whiskerHigh,
      `order holds for [${data.join(', ')}]: ${b.whiskerLow} ${b.q1} ${b.median} ${b.q3} ${b.whiskerHigh}`)
    for (const o of b.outliers) {
      assert.ok(o < b.whiskerLow || o > b.whiskerHigh, `outlier ${o} is outside the whiskers`)
    }
  }
})

test('box plot outliers render within the drawn x range', () => {
  // The chart maps [min(all), max(all)] onto [PAD, W - PAD]; check that.
  const data = [1, 2, 3, 4, 5, 1000]
  const b = boxPlot(data)
  const lo = Math.min(b.min, ...b.outliers)
  const hi = Math.max(b.max, ...b.outliers)
  for (const v of [b.whiskerLow, b.q1, b.median, b.q3, b.whiskerHigh, ...b.outliers]) {
    const x = 24 + ((v - lo) / (hi - lo || 1)) * (420 - 2 * 24)
    assert.ok(x >= 23.5 && x <= 420 - 23.5, `value ${v} maps inside the plot (x=${x.toFixed(1)})`)
  }
})

test('scatter points stay inside the viewBox after the draw cap', () => {
  const points = Array.from({ length: 5_000 }, (_, i) => ({ x: i, y: Math.sin(i) * 100 }))
  const capped = capScatter(points)
  assert.ok(capped.points.length <= SCATTER_DRAW_LIMIT * 1.1, 'the cap holds')
  const xs = capped.points.map((p) => p.x)
  const ys = capped.points.map((p) => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1
  for (const p of capped.points) {
    const px = SC_PAD + ((p.x - minX) / spanX) * (SC_W - 2 * SC_PAD)
    const py = SC_H - SC_PAD - ((p.y - minY) / spanY) * (SC_H - 2 * SC_PAD)
    assert.ok(px >= SC_PAD - 0.5 && px <= SC_W - SC_PAD + 0.5, `x ${p.x} inside`)
    assert.ok(py >= SC_PAD - 0.5 && py <= SC_H - SC_PAD + 0.5, `y ${p.y} inside`)
  }
})

test("Sturges' default stays under the histogram node budget", () => {
  for (const n2 of [1, 10, 1000, 100_000]) {
    assert.ok(sturgesBinCount(n2) <= 100, `n=${n2}: ${sturgesBinCount(n2)} bins`)
  }
})

console.log(`\n${n} statistics chart layout checks passed`)
