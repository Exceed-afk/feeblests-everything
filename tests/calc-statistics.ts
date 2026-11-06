import assert from 'node:assert/strict'
import {
  computeStats,
  percentile,
  linearRegression,
  quadraticRegression,
  logarithmicRegression,
  exponentialRegression,
  powerRegression,
  normal,
  binomial,
  poisson,
  studentT,
  chiSquare,
  uniform,
  tTestOneSample,
  tTestTwoSample,
  zTestOneSample,
  gammaFn
} from '../src/shared/calculator/modules/statistics'
import { Decimal } from '../src/shared/calculator/numeric'

const dec = (n: number): Decimal => new Decimal(n)
const close = (actual: Decimal | number, expected: number, tol = 1e-9, label?: string) => {
  const a = typeof actual === 'number' ? actual : actual.toNumber()
  assert.ok(Math.abs(a - expected) <= tol, `${label || ''} expected ${expected}, got ${a} (diff ${Math.abs(a - expected)})`)
}

let count = 0
const ok = () => { count++ }

// ---------- Descriptive statistics ----------
// Reference dataset (standard textbook set): 2,4,4,4,5,5,7,9
const data = [2, 4, 4, 4, 5, 5, 7, 9].map(dec)
const s = computeStats(data)
assert.equal(s.count, 8); ok()
close(s.sum, 40); ok()
close(s.mean, 5); ok()
close(s.median, 4.5); ok()
assert.deepEqual(s.mode.map((m) => m.toNumber()), [4]); ok()
close(s.min, 2); ok()
close(s.max, 9); ok()
close(s.range, 7); ok()
// Population variance = 4, sample variance = 32/7
close(s.variance, 4); ok()
close(s.varianceSample, 32 / 7); ok()
close(s.stdDev, 2); ok()
close(s.stdDevSample, Math.sqrt(32 / 7)); ok()
// Quartiles (type 7): index = (n-1)*p => q1 at 1.75 => 4, q3 at 5.25 => 5.5
close(s.q1, 4); ok()
close(s.q3, 5.5); ok()
close(s.iqr, 1.5); ok()

// Median with an odd count
close(computeStats([3, 1, 2].map(dec)).median, 2); ok()
// All identical values
const flat = computeStats([5, 5, 5].map(dec))
close(flat.variance, 0); ok()
close(flat.stdDev, 0); ok()
assert.deepEqual(flat.mode.map((m) => m.toNumber()), [5]); ok()
// Two modes
assert.deepEqual(computeStats([1, 1, 2, 2, 3].map(dec)).mode.map((m) => m.toNumber()), [1, 2]); ok()
// No mode (all different)
assert.deepEqual(computeStats([1, 2, 3].map(dec)).mode, []); ok()
// Single value
const one = computeStats([7].map(dec))
close(one.mean, 7); close(one.median, 7); assert.throws(() => one.stdDevSample, /needs at least 2 values/); ok()

// Percentiles
close(percentile(data, 50), 4.5); ok()
close(percentile(data, 0), 2); ok()
close(percentile(data, 100), 9); ok()
close(percentile([1, 2, 3, 4, 5].map(dec), 90), 4.6); ok()
assert.throws(() => percentile(data, 101)); ok()
assert.throws(() => computeStats([])); ok()

// ---------- Regression ----------
// Perfect line y = 2x + 1
const xs = [0, 1, 2, 3, 4].map(dec)
const ys = xs.map((x) => x.times(2).plus(1))
const lin = linearRegression(xs, ys)
close(lin.coefficients[1], 2, 1e-9, 'slope'); ok()
close(lin.coefficients[0], 1, 1e-9, 'intercept'); ok()
close(lin.r, 1, 1e-9, 'r'); ok()
close(lin.rSquared, 1, 1e-9, 'r²'); ok()

// Textbook linear regression: x = 1,2,3,4,5 ; y = 2,4,5,4,5 => slope 0.6, intercept 2.2, r ~0.7745966692
const lx = [1, 2, 3, 4, 5].map(dec)
const ly = [2, 4, 5, 4, 5].map(dec)
const lin2 = linearRegression(lx, ly)
close(lin2.coefficients[1], 0.6); ok()
close(lin2.coefficients[0], 2.2); ok()
close(lin2.r, 3 / Math.sqrt(15), 1e-9); ok()

// Exponential y = 3 * e^(0.5x)
const exXs = [0, 1, 2, 3].map(dec)
const exYs = exXs.map((x) => x.times(0.5).exp().times(3))
const expReg = exponentialRegression(exXs, exYs)
close(expReg.coefficients[0], 3, 1e-9, 'a'); ok()
close(expReg.coefficients[1], 0.5, 1e-9, 'b'); ok()

// Logarithmic y = 2 + 1.5 ln(x)
const lgXs = [1, 2, 4, 8].map(dec)
const lgYs = lgXs.map((x) => x.ln().times(1.5).plus(2))
const logReg = logarithmicRegression(lgXs, lgYs)
close(logReg.coefficients[0], 2, 1e-9); ok()
close(logReg.coefficients[1], 1.5, 1e-9); ok()

// Power y = 4 * x^2
const pwXs = [1, 2, 3, 4].map(dec)
const pwYs = pwXs.map((x) => x.times(x).times(4))
const powReg = powerRegression(pwXs, pwYs)
close(powReg.coefficients[0], 4, 1e-9); ok()
close(powReg.coefficients[1], 2, 1e-9); ok()

// ---------- Quadratic regression ----------
// Points exactly on y = 2x^2 - 3x + 1: a = 2, b = -3, c = 1, R^2 = 1.
const qx = [-2, -1, 0, 1, 2, 3].map(dec)
const qy = qx.map((x) => x.times(x).times(2).minus(x.times(3)).plus(1))
const quad = quadraticRegression(qx, qy)
assert.equal(quad.model, 'quadratic'); ok()
close(quad.coefficients[0], 2, 1e-9, 'quad a'); ok()
close(quad.coefficients[1], -3, 1e-9, 'quad b'); ok()
close(quad.coefficients[2], 1, 1e-9, 'quad c'); ok()
close(quad.rSquared, 1, 1e-9, 'quad r²'); ok()
close(quad.predict(4), 2 * 16 - 3 * 4 + 1, 1e-9, 'quad predict'); ok()
assert.ok(quad.formula.includes('x^2'), 'quadratic formula names x^2'); ok()

// Noisy case: y = x^2 + noise. The fit must be close to the true curve and
// R^2 must be a real number in [0, 1] (never NaN).
const nqx = [0, 1, 2, 3, 4, 5].map(dec)
const nqy = [0.1, 1.2, 3.9, 9.1, 15.8, 25.2].map(dec)
const noisy = quadraticRegression(nqx, nqy)
close(noisy.coefficients[0], 1, 0.05, 'noisy a'); ok()
assert.ok(noisy.rSquared.gt(0.99) && noisy.rSquared.lte(1), `noisy R² in (0.99, 1], got ${noisy.rSquared}`); ok()
assert.ok(noisy.predict(6).isFinite(), 'noisy prediction is finite'); ok()

// Large-x case: years like 2020. The raw normal equations lose precision here;
// shifting x by its mean must still recover the exact coefficients.
const yx = [2018, 2019, 2020, 2021, 2022].map(dec)
const yy = yx.map((x) => x.minus(2020).times(x.minus(2020)).times(0.5).plus(x.minus(2020)).plus(3))
const years = quadraticRegression(yx, yy)
// 0.5(x-2020)^2 + (x-2020) + 3 = 0.5x^2 - 2019x + 2038183
close(years.coefficients[0], 0.5, 1e-9, 'large-x a'); ok()
close(years.coefficients[1], -2019, 1e-9, 'large-x b'); ok()
close(years.coefficients[2], 2038183, 1e-9, 'large-x c'); ok()
close(years.rSquared, 1, 1e-9, 'large-x r²'); ok()
close(years.predict(2023), 0.5 * 9 + 3 + 3, 1e-9, 'large-x predict'); ok()

// Rejections: fewer than 3 points, and fewer than 3 different x values.
assert.throws(() => quadraticRegression([dec(1), dec(2)], [dec(1), dec(2)]), /at least 3 points/); ok()
assert.throws(() => quadraticRegression([dec(1), dec(1), dec(2)], [dec(1), dec(2), dec(3)]), /3 different x values/); ok()
assert.throws(() => quadraticRegression([dec(1), dec(2), dec(3)], [dec(1), dec(2)]), /same length/); ok()

assert.throws(() => linearRegression([dec(1)], [dec(1)])); ok()
assert.throws(() => linearRegression([dec(2), dec(2)], [dec(1), dec(2)])); ok()
assert.throws(() => logarithmicRegression([dec(-1), dec(1)], [dec(1), dec(2)])); ok()
assert.throws(() => exponentialRegression([dec(1), dec(2)], [dec(-1), dec(2)])); ok()

// ---------- Gamma ----------
close(gammaFn(5), 24, 1e-9); ok()
close(gammaFn(0.5), Math.sqrt(Math.PI), 1e-9); ok()
close(gammaFn(1), 1, 1e-9); ok()
assert.throws(() => gammaFn(0)); ok()

// ---------- Normal distribution (reference values) ----------
close(normal.pdf(0, 0, 1), 1 / Math.sqrt(2 * Math.PI), 1e-12); ok()
close(normal.cdf(0, 0, 1), 0.5, 1e-7); ok()
close(normal.cdf(1.96, 0, 1), 0.9750021049, 1e-6); ok()
close(normal.cdf(-1.96, 0, 1), 0.0249978951, 1e-6); ok()
close(normal.inv(0.975, 0, 1), 1.959963985, 1e-6); ok()
close(normal.inv(0.5, 0, 1), 0, 1e-6); ok()
close(normal.cdf(110, 100, 15), 0.747507, 1e-5); ok()
assert.throws(() => normal.pdf(0, 0, -1)); ok()

// ---------- Binomial ----------
close(binomial.pdf(3, 10, 0.5), 120 / 1024, 1e-12); ok()
close(binomial.cdf(5, 10, 0.5), 0.623046875, 1e-9); ok()
assert.equal(binomial.pdf(11, 10, 0.5), 0); ok()
assert.equal(binomial.inv(0.5, 10, 0.5), 5); ok()
close(binomial.pdf(0, 5, 0.2), Math.pow(0.8, 5), 1e-12); ok()

// ---------- Poisson ----------
close(poisson.pdf(2, 3), Math.exp(-3) * 9 / 2, 1e-12); ok()
close(poisson.cdf(2, 3), Math.exp(-3) * (1 + 3 + 4.5), 1e-12); ok()
assert.equal(poisson.inv(0.5, 3), 3); ok()

// ---------- Student t ----------
close(studentT.cdf(0, 10), 0.5, 1e-9); ok()
close(studentT.cdf(1.812, 10), 0.95, 1e-4); ok()
close(studentT.inv(0.975, 10), 2.228138852, 1e-4); ok()
close(studentT.pdf(0, 10), gammaFn(5.5) / (Math.sqrt(10 * Math.PI) * gammaFn(5)), 1e-9); ok()

// ---------- Chi-square ----------
close(chiSquare.cdf(3.841459, 1), 0.95, 1e-5); ok()
close(chiSquare.inv(0.95, 1), 3.841459, 1e-3); ok()
close(chiSquare.cdf(11.0705, 5), 0.95, 1e-4); ok()

// ---------- Uniform ----------
close(uniform.pdf(0.5, 0, 1), 1); ok()
assert.equal(uniform.pdf(2, 0, 1), 0); ok()
close(uniform.cdf(0.25, 0, 4), 0.0625); ok()
close(uniform.inv(0.5, 10, 20), 15); ok()

// ---------- Hypothesis tests ----------
// One-sample t test: sample mean 10, n=5, values symmetric => t computed directly
const tSample = [9.8, 10.2, 10.0, 9.9, 10.1]
const tRes = tTestOneSample(tSample, 10)
close(tRes.statistic, 0, 1e-9); ok()
close(tRes.pValue, 1, 1e-6); ok()
assert.equal(tRes.df, 4); ok()

// Two-sample t test with identical samples => t = 0
const twoRes = tTestTwoSample([1, 2, 3, 4, 5], [1, 2, 3, 4, 5])
close(twoRes.statistic, 0, 1e-12); ok()
close(twoRes.pValue, 1, 1e-6); ok()

// Two-sample with a known shift
const shifted = tTestTwoSample([1, 2, 3, 4, 5], [4, 5, 6, 7, 8], true)
close(shifted.statistic, -3, 1e-9); ok()
assert.equal(shifted.df, 8); ok()

// z test
const zRes = zTestOneSample([100, 102, 98, 101, 99], 2, 100)
close(zRes.statistic, 0, 1e-9); ok()
close(zRes.pValue, 1, 1e-6); ok()

console.log(`ok   ${count} statistics and probability reference checks passed`)
