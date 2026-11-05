// Core tests for the new graph types (task 5b): parametric, polar, value table,
// derivative at a point. All pure shared/calculator logic, no UI.
import assert from 'node:assert/strict'
import {
  sampleParametric,
  samplePolar,
  buildValueTable,
  derivativeAt
} from '../src/shared/calculator/modules/graphing'
import '../src/shared/calculator/modules/scientific'

let checks = 0
const ok = () => { checks++ }

// ---------- 1. Parametric: x = cos t, y = sin t is the unit circle ----------
const circ = sampleParametric('cos(t)', 'sin(t)', 0, 2 * Math.PI, 72, { angleMode: 'rad' })
assert.equal(circ.length, 73, 'tMin..tMax inclusive gives samples + 1 points'); ok()
let allOnCircle = true
for (const p of circ) {
  if (p.x === null || p.y === null) { allOnCircle = false; continue }
  const r = Math.hypot(p.x, p.y)
  if (Math.abs(r - 1) > 1e-9) allOnCircle = false
}
assert.ok(allOnCircle, 'every sample sits at radius 1'); ok()
// Endpoints: t=0 -> (1,0), t=2pi -> (1,0)
assert.ok(Math.abs(circ[0].x! - 1) < 1e-9 && Math.abs(circ[0].y!) < 1e-9, 't=0 is (1,0)'); ok()
assert.ok(Math.abs(circ[72].x! - 1) < 1e-9 && Math.abs(circ[72].y!) < 1e-9, 't=2pi is (1,0)'); ok()
// Midpoint t=pi -> (-1, 0)
const mid = circ[36]
assert.ok(Math.abs(mid.x! + 1) < 1e-9 && Math.abs(mid.y!) < 1e-9, 't=pi is (-1,0)'); ok()

// A curve with an undefined segment: sqrt(t) for t < 0 is undefined.
const half = sampleParametric('sqrt(t)', 't', -4, 4, 20)
const deadPoints = half.filter((p) => p.x === null)
assert.ok(deadPoints.length > 0, 'negative t marks points undefined, not NaN'); ok()
for (const p of deadPoints) assert.ok(p.t < 0, `dead point has t=${p.t} < 0`); ok()

// Range validation
assert.throws(() => sampleParametric('t', 't', 5, 5, 10), /tMax must be greater/, 'tMax == tMin rejected'); ok()
assert.throws(() => sampleParametric('t', 't', 5, 1, 10), /tMax must be greater/, 'inverted t range rejected'); ok()
assert.throws(() => sampleParametric('t', 't', 0, 1, 0), /whole number/, 'zero samples rejected'); ok()
assert.throws(() => sampleParametric('t', 't', 0, 1, 100001), /limited to 10,000/, 'too many samples rejected'); ok()

// ---------- 2. Polar: r = 1 is a circle, r = theta is a spiral ----------
const circle = samplePolar('1', 0, 2 * Math.PI, 60, { angleMode: 'rad' })
let circleOk = true
for (const p of circle) {
  if (p.r !== 1 || p.x === null || p.y === null) circleOk = false
  else if (Math.abs(Math.hypot(p.x, p.y) - 1) > 1e-9) circleOk = false
}
assert.ok(circleOk, 'r = 1 gives radius 1 at every sample'); ok()
// First point sits on the +x axis
assert.ok(Math.abs(circle[0].x! - 1) < 1e-9 && Math.abs(circle[0].y!) < 1e-9, 'theta=0 -> (1,0)'); ok()

const spiral = samplePolar('theta', 0, 4 * Math.PI, 80, { angleMode: 'rad' })
// Archimedean spiral: r equals theta (rad), so at theta = 2pi the point is (2pi, 0)
const spiralEnd = spiral[spiral.length - 1]
assert.ok(Math.abs(spiralEnd.theta - 4 * Math.PI) < 1e-9, 'last sample is thetaMax'); ok()
assert.ok(Math.abs(spiralEnd.r! - 4 * Math.PI) < 1e-9, 'spiral r = theta at the end'); ok()
// Check the value at theta = pi: point should be (-pi, ~0)
const spiralMid = spiral.find((p) => Math.abs(p.theta - Math.PI) < 1e-6)
assert.ok(spiralMid, 'sample exists at theta = pi'); ok()
assert.ok(Math.abs(spiralMid!.x! + Math.PI) < 1e-6, 'theta=pi maps to x = -pi'); ok()

// Polar respects the angle mode: r = theta in DEG mode, thetaMax = 180.
// The expression sees 180 and the point lands at 180 degrees on screen.
const degSpiral = samplePolar('theta', 0, 180, 36, { angleMode: 'deg' })
const degEnd = degSpiral[degSpiral.length - 1]
assert.ok(Math.abs(degEnd.x! + 180) < 1e-6, 'DEG mode: theta=180 maps to x = -180'); ok()
assert.ok(Math.abs(degEnd.y!) < 1e-6, 'DEG mode: theta=180 maps to y ~ 0'); ok()

// Polar range validation
assert.throws(() => samplePolar('theta', 10, 0, 10), /tMax must be greater/, 'inverted theta range rejected'); ok()
assert.throws(() => samplePolar('theta', 0, 1, 20000), /limited to 10,000/, 'too many polar samples rejected'); ok()

// ---------- 3. Value table matches direct evaluation ----------
const table = buildValueTable('x^2', 0, 0.5, 5)
assert.equal(table.length, 5, 'table has exactly count rows'); ok()
for (let i = 0; i < 5; i++) {
  const x = i * 0.5
  assert.ok(Math.abs(table[i].x - x) < 1e-12, `row ${i} x is ${x}`); ok()
  assert.ok(Math.abs(table[i].y! - x * x) < 1e-12, `row ${i} y = x^2`); ok()
}
// Negative step walks down
const down = buildValueTable('x', 10, -2, 3)
assert.deepEqual(down.map((r) => r.x), [10, 8, 6], 'negative step descends'); ok()
// Undefined points are null, never NaN
const domain = buildValueTable('sqrt(x)', -1, 1, 4)
assert.equal(domain[0].y, null, 'sqrt(-1) is undefined, not NaN'); ok()
assert.ok(domain[1].y === 0, 'sqrt(0) = 0'); ok()
assert.equal(domain[2].y, 1, 'sqrt(1) = 1'); ok()
assert.ok(domain[0].y === null && !Number.isNaN(domain[0].x), 'no NaN leaks into the table'); ok()
// Validation
assert.throws(() => buildValueTable('x', 0, 0, 5), /step cannot be zero/, 'zero step rejected'); ok()
assert.throws(() => buildValueTable('x', 0, 1, 0), /whole number/, 'zero count rejected'); ok()
assert.throws(() => buildValueTable('x', 0, 1, 20000), /limited to 10,000/, 'too many rows rejected'); ok()
assert.throws(() => buildValueTable('x', 'abc', 1, 5), /must be a number/, 'non-numeric start rejected'); ok()

// ---------- 4. Derivative at a point ----------
// d/dx x^2 at 3 is 6.
const dSq = derivativeAt('x^2', 3)
assert.equal(dSq.kind, 'ok', 'x^2 is differentiable at 3'); ok()
if (dSq.kind === 'ok') {
  assert.ok(Math.abs(dSq.derivative - 6) < 1e-4, `central difference of x^2 at 3 is 6 (got ${dSq.derivative})`); ok()
  assert.ok(Math.abs(dSq.f - 9) < 1e-9, 'f(3) = 9'); ok()
  // Central difference is much closer to 6 than either one-sided slope
  assert.ok(Math.abs(dSq.central - 6) <= Math.abs(dSq.left - 6), 'central beats one-sided left'); ok()
}
// d/dx sin(x) at 0 (rad) is 1
const dSin = derivativeAt('sin(x)', 0, { angleMode: 'rad' })
assert.equal(dSin.kind, 'ok', 'sin is differentiable at 0'); ok()
if (dSin.kind === 'ok') assert.ok(Math.abs(dSin.derivative - 1) < 1e-4, 'd/dx sin at 0 is 1'); ok()

// |x| at 0: left slope -1, right slope +1 -> not differentiable
const dAbs = derivativeAt('abs(x)', 0)
assert.equal(dAbs.kind, 'notDifferentiable', '|x| at 0 is reported not differentiable'); ok()
if (dAbs.kind === 'notDifferentiable') {
  assert.match(dAbs.message, /Not differentiable at x = 0/, 'message names the point'); ok()
}
// But |x| elsewhere is fine: at 2 the derivative is 1
const dAbs2 = derivativeAt('abs(x)', 2)
assert.equal(dAbs2.kind, 'ok', '|x| is differentiable away from 0'); ok()
if (dAbs2.kind === 'ok') assert.ok(Math.abs(dAbs2.derivative - 1) < 1e-4, "d/dx |x| at 2 is 1"); ok()

// Undefined at the point
const dSqrt = derivativeAt('sqrt(x)', -1)
assert.equal(dSqrt.kind, 'undefined', 'sqrt(-1) reports the function as undefined'); ok()
assert.match(dSqrt.message, /undefined at x = -1/, 'undefined message names the point'); ok()
// Undefined on one side: sqrt(x) at 0 has no left side
const dSqrt0 = derivativeAt('sqrt(x)', 0)
assert.equal(dSqrt0.kind, 'undefined', 'sqrt(x) at 0 has no left neighbourhood'); ok()
// 1/x at 0 is undefined (pole, not a corner)
const dInv = derivativeAt('1/x', 0)
assert.equal(dInv.kind, 'undefined', '1/x at 0 is undefined, not "not differentiable"'); ok()
// Validation
assert.throws(() => derivativeAt('x^2', 'abc'), /must be a number/, 'non-numeric point rejected'); ok()

console.log(`ok   ${checks} parametric / polar / table / derivative checks passed`)
