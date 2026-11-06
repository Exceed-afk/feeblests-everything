import assert from 'node:assert/strict'
import {
  sampleFunction,
  findRoots,
  findExtrema,
  findIntersections,
  type PlotRange,
  type SamplePoint
} from '../src/shared/calculator/modules/graphing'
// The app registers the scientific functions at start-up; the intersection tests
// use sin/cos/tan, so register them here too.
import '../src/shared/calculator/modules/scientific'

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

// ---------- 5. Intersection finder ----------
// x^2 vs x + 2 meet at x = -1 and x = 2.
const cross = findIntersections('x^2', 'x + 2', -10, 10)
assert.equal(cross.length, 2, `x^2 vs x+2: expected 2 intersections, got ${cross.length}`); ok()
assert.ok(cross.some((p) => Math.abs(p.x - -1) < 1e-6 && Math.abs(p.y - 1) < 1e-6), 'intersection at (-1, 1)'); ok()
assert.ok(cross.some((p) => Math.abs(p.x - 2) < 1e-6 && Math.abs(p.y - 4) < 1e-6), 'intersection at (2, 4)'); ok()
assert.ok(cross.every((p) => p.kind === 'crossing'), 'both are crossings'); ok()

// sin(x) vs cos(x) in RADIANS: x = pi/4 + k*pi. Over [-2pi, 2pi] that is 4 points.
const trig = findIntersections('sin(x)', 'cos(x)', -2 * Math.PI, 2 * Math.PI, { angleMode: 'rad' })
assert.equal(trig.length, 4, `sin vs cos: expected 4 intersections, got ${trig.length}`); ok()
for (const p of trig) {
  const k = Math.round((p.x - Math.PI / 4) / Math.PI)
  assert.ok(Math.abs(p.x - (Math.PI / 4 + k * Math.PI)) < 1e-6, `sin vs cos root near ${p.x}`)
  assert.ok(Math.abs(p.y - Math.sin(p.x)) < 1e-6, 'y is on both curves')
}
ok()

// Two parallel lines never meet.
assert.deepEqual(findIntersections('2x + 1', '2x + 5', -10, 10), []); ok()

// Discontinuities must not produce fake intersections.
// tan(x) vs 0 in DEGREES has poles at 90 and 270; the sign flips there but the
// difference is never small, so nothing is reported.
const tanHits = findIntersections('tan(x)', '0', 0, 360, { angleMode: 'deg' })
assert.ok(
  tanHits.every((p) => Math.abs(Math.tan((p.x * Math.PI) / 180)) < 1e-3),
  `tan(x) vs 0: every hit is a real zero, got ${JSON.stringify(tanHits)}`
); ok()
assert.ok(tanHits.some((p) => Math.abs(p.x - 180) < 1e-6), 'tan(x) vs 0 finds the real zero at 180'); ok()
assert.ok(!tanHits.some((p) => Math.abs(p.x - 90) < 1 || Math.abs(p.x - 270) < 1), 'no fake hit at the poles'); ok()

// 1/x vs 0: the sign flips across x = 0 but there is no intersection.
const hyper = findIntersections('1/x', '0', -5, 5)
assert.ok(hyper.every((p) => Math.abs(1 / p.x) < 1e-3), `1/x vs 0: no fake hit at 0, got ${JSON.stringify(hyper)}`); ok()
assert.ok(!hyper.some((p) => Math.abs(p.x) < 1e-3), '1/x vs 0 reports nothing at the pole'); ok()

// Touching without crossing: x^2 vs 0 touches at (0, 0) and is reported as 'touching'.
const touch = findIntersections('x^2', '0', -5, 5)
assert.equal(touch.length, 1, `x^2 vs 0: expected 1 touching point, got ${touch.length}`); ok()
assert.ok(Math.abs(touch[0].x) < 1e-3 && Math.abs(touch[0].y) < 1e-6, 'touching point at (0, 0)'); ok()
assert.equal(touch[0].kind, 'touching', 'reported as touching, not crossing'); ok()

// Duplicates are merged: a curve that meets another twice very close together is listed once.
const dup = findIntersections('x^2', '0.0000001', -5, 5)
assert.ok(dup.length <= 2, `near-touching pair is not duplicated (got ${dup.length})`); ok()

// Rejections: a bad range and an unparsable expression.
assert.throws(() => findIntersections('x', '0', 5, 5), /xMax must be greater than xMin/); ok()
assert.throws(() => findIntersections('x +', '0', -1, 1)); ok()

console.log(`ok   ${checks} graphing & sampling tests passed`)
