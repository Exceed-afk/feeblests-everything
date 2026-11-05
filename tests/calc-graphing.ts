import assert from 'node:assert/strict'
import {
  sampleFunction,
  findRoots,
  findExtrema,
  type PlotRange,
  type SamplePoint
} from '../src/shared/calculator/modules/graphing'

let checks = 0
const ok = () => { checks++ }

// ---------- 1. Linear & Quadratic Sampling ----------
// y = 2x + 1 on [-10, 10]
const range1: PlotRange = { xMin: -10, xMax: 10, yMin: -20, yMax: 25 }
const samples1 = sampleFunction('2x + 1', range1, 20)
assert.ok(samples1.length >= 20, 'At least 20 samples'); ok()
const p0 = samples1.find((p) => Math.abs(p.x - 0) < 1e-4)
assert.ok(p0, 'Contains x = 0'); ok()
assert.ok(Math.abs(p0!.y! - 1) < 1e-4, 'y(0) = 1'); ok()

// y = x^2 - 4 on [-3, 3]
const range2: PlotRange = { xMin: -3, xMax: 3, yMin: -5, yMax: 10 }
const samples2 = sampleFunction('x^2 - 4', range2, 30)
assert.ok(samples2.length >= 30, 'Quadratic samples generated'); ok()
const p2 = samples2.find((p) => Math.abs(p.x - 2) < 0.1)
assert.ok(p2 && Math.abs(p2.y!) < 0.5, 'y(2) ~ 0'); ok()

// ---------- 2. Discontinuity Handling ----------
// y = 1 / x on [-2, 2] -> has vertical asymptote at x = 0
const range3: PlotRange = { xMin: -2, xMax: 2, yMin: -10, yMax: 10 }
const samples3 = sampleFunction('1 / x', range3, 40)
assert.ok(samples3.length > 0, 'Asymptote handled without crash'); ok()
// Discontinuity should mark discontinuous or null
const nearZero = samples3.filter((p) => Math.abs(p.x) < 0.05)
assert.ok(
  nearZero.some((p) => p.y === null || p.discontinuous),
  'Discontinuity detected near x = 0'
); ok()

// ---------- 3. Root Finder ----------
// Roots of x^2 - 4 on [-3, 3] are x = -2 and x = 2
const roots = findRoots('x^2 - 4', -3, 3)
assert.equal(roots.length, 2, 'Found 2 roots'); ok()
assert.ok(roots.some((r) => Math.abs(r - -2) < 1e-3), 'Root at -2'); ok()
assert.ok(roots.some((r) => Math.abs(r - 2) < 1e-3), 'Root at +2'); ok()

// Root of 2x - 6 on [0, 5] is x = 3
const rootsLinear = findRoots('2x - 6', 0, 5)
assert.equal(rootsLinear.length, 1, 'Found 1 root'); ok()
assert.ok(Math.abs(rootsLinear[0] - 3) < 1e-3, 'Root at 3'); ok()

// ---------- 4. Extrema Finder (Minima & Maxima) ----------
// y = x^2 - 4 on [-2, 2] has minimum at x = 0, y = -4
const extrema1 = findExtrema('x^2 - 4', -2, 2)
const min1 = extrema1.find((e) => e.type === 'min')
assert.ok(min1, 'Found minimum'); ok()
assert.ok(Math.abs(min1!.x) < 1e-2, 'Min x near 0'); ok()
assert.ok(Math.abs(min1!.y - -4) < 1e-2, 'Min y near -4'); ok()

// y = 9 - x^2 on [-2, 2] has maximum at x = 0, y = 9
const extrema2 = findExtrema('9 - x^2', -2, 2)
const max2 = extrema2.find((e) => e.type === 'max')
assert.ok(max2, 'Found maximum'); ok()
assert.ok(Math.abs(max2!.x) < 1e-2, 'Max x near 0'); ok()
assert.ok(Math.abs(max2!.y - 9) < 1e-2, 'Max y near 9'); ok()

console.log(`ok   ${checks} graphing & sampling tests passed`)
