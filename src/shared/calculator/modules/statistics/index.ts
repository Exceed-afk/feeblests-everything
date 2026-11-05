// Calculator: Statistics and Probability (Phase 3)
// Pure numeric implementations using exact Decimal arithmetic.
import { Decimal, registry } from '../../index'
import { CALC_LIMITS, limitMessage } from '../../limits'
import { CalcError } from '../../errors'
import { toDecimalInput, toDecimalArray, toPairedArrays, toProbabilityInput, toIntegerInput, describe } from '../../inputs'

/**
 * One gate for every statistics entry point: accepts an array or a text dataset
 * ("1, 2, 3"), rejects anything else, and enforces the dataset cap (section 11).
 */
function datasetInput(input: unknown, what = 'dataset'): Decimal[] {
  if (typeof input === 'string') {
    if (input.length > CALC_LIMITS.datasetSize * 24) {
      throw new CalcError(limitMessage('datasetSize', 'values'))
    }
    const parts = input.split(/[,;\s]+/).filter((s) => s.trim().length > 0)
    if (parts.length > CALC_LIMITS.datasetSize) {
      throw new CalcError(`${limitMessage('datasetSize', 'values')} (this one has ${parts.length.toLocaleString('en-US')})`)
    }
    return parts.map((s, i) => toDecimalInput(s, `${what}[${i}]`))
  }
  if (!Array.isArray(input)) throw new CalcError(`${what} must be a list of numbers or a text dataset (got ${describe(input)})`)
  if (input.length > CALC_LIMITS.datasetSize) {
    throw new CalcError(`${limitMessage('datasetSize', 'values')} (this one has ${input.length.toLocaleString('en-US')})`)
  }
  return toDecimalArray(input, what)
}

export interface DatasetStats {
  count: number
  sum: Decimal
  mean: Decimal
  median: Decimal
  mode: Decimal[]
  min: Decimal
  max: Decimal
  range: Decimal
  variance: Decimal // population variance (σ²)
  varianceSample: Decimal // sample variance (s²)
  stdDev: Decimal // population σ
  stdDevSample: Decimal // sample s
  q1: Decimal
  q3: Decimal
  iqr: Decimal
}

export function parseDataset(input: string | Decimal[]): Decimal[] {
  if (Array.isArray(input)) {
    // Checked like every other entry point: an array of strings or nulls is not a dataset.
    if (input.length > CALC_LIMITS.datasetSize) {
      throw new CalcError(`${limitMessage('datasetSize', 'values')} (this one has ${input.length.toLocaleString('en-US')})`)
    }
    return input.map((v, i) => toDecimalInput(v, `dataset[${i}]`))
  }
  return datasetInput(input)
}

export function computeStats(values: readonly Decimal[]): DatasetStats {
  values = datasetInput(values)
  if (values.length === 0) throw new CalcError('Dataset is empty')
  const arr = [...values].sort((a, b) => a.comparedTo(b))
  const n = arr.length
  const sum = arr.reduce((acc, v) => acc.plus(v), new Decimal(0))
  const mean = sum.dividedBy(n)

  let median: Decimal
  const mid = Math.floor(n / 2)
  if (n % 2 === 1) {
    median = arr[mid]
  } else {
    median = arr[mid - 1].plus(arr[mid]).dividedBy(2)
  }

  // Mode: all values with highest frequency
  const freq = new Map<string, { val: Decimal; count: number }>()
  for (const v of arr) {
    const key = v.toString()
    const entry = freq.get(key)
    if (entry) entry.count++
    else freq.set(key, { val: v, count: 1 })
  }
  let maxCount = 0
  for (const entry of freq.values()) if (entry.count > maxCount) maxCount = entry.count
  const mode =
    maxCount <= 1 ? [] : Array.from(freq.values()).filter((e) => e.count === maxCount).map((e) => e.val)

  // Variance & Standard deviation
  let varSum = new Decimal(0)
  for (const v of arr) {
    const diff = v.minus(mean)
    varSum = varSum.plus(diff.times(diff))
  }
  const variance = varSum.dividedBy(n)
  const varianceSample = n > 1 ? varSum.dividedBy(n - 1) : new Decimal(0)

  // Quartiles (linear interpolation method, 'inclusive' / type 7)
  const percentile = (p: number): Decimal => {
    if (n === 1) return arr[0]
    const idx = (n - 1) * p
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    if (lo === hi) return arr[lo]
    const frac = new Decimal(idx - lo)
    return arr[lo].plus(arr[hi].minus(arr[lo]).times(frac))
  }

  const q1 = percentile(0.25)
  const q3 = percentile(0.75)

  return {
    count: n,
    sum,
    mean,
    median,
    mode,
    min: arr[0],
    max: arr[n - 1],
    range: arr[n - 1].minus(arr[0]),
    variance,
    varianceSample,
    stdDev: variance.sqrt(),
    stdDevSample: varianceSample.sqrt(),
    q1,
    q3,
    iqr: q3.minus(q1)
  }
}

export function percentile(values: readonly Decimal[], p: number | string): Decimal {
  const arrInput = datasetInput(values)
  const q = toDecimalInput(p, 'percentile')
  if (arrInput.length === 0) throw new CalcError('Dataset is empty')
  if (q.lt(0) || q.gt(100)) throw new CalcError('Percentile must be between 0 and 100')
  const pct = q.toNumber()
  const arr = [...arrInput].sort((a, b) => a.comparedTo(b))
  const n = arr.length
  if (n === 1) return arr[0]
  const idx = (n - 1) * (pct / 100)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return arr[lo]
  const frac = new Decimal(idx - lo)
  return arr[lo].plus(arr[hi].minus(arr[lo]).times(frac))
}

// ---------- Regression ----------

export type RegressionModel = 'linear' | 'quadratic' | 'exponential' | 'logarithmic' | 'power'

export interface RegressionResult {
  model: RegressionModel
  coefficients: Decimal[]
  r: Decimal
  rSquared: Decimal
  // Description for display
  formula: string
}

export function linearRegression(xs: readonly Decimal[], ys: readonly Decimal[]): RegressionResult {
  const [x, y] = toPairedArrays(xs, ys, 'x', 'y')
  if (x.length > CALC_LIMITS.datasetSize) throw new CalcError(limitMessage('datasetSize', 'values'))
  if (x.length < 2) throw new CalcError('Need equal x/y lengths of at least 2')
  xs = x
  ys = y
  const n = xs.length
  const sumX = xs.reduce((a, b) => a.plus(b), new Decimal(0))
  const sumY = ys.reduce((a, b) => a.plus(b), new Decimal(0))
  const sumXY = xs.reduce((a, b, i) => a.plus(b.times(ys[i])), new Decimal(0))
  const sumXX = xs.reduce((a, b) => a.plus(b.times(b)), new Decimal(0))
  const sumYY = ys.reduce((a, b) => a.plus(b.times(b)), new Decimal(0))

  const denom = new Decimal(n).times(sumXX).minus(sumX.times(sumX))
  if (denom.isZero()) throw new CalcError('Cannot fit a line: all x values are identical')
  const slope = new Decimal(n).times(sumXY).minus(sumX.times(sumY)).dividedBy(denom)
  const intercept = sumY.minus(slope.times(sumX)).dividedBy(n)

  // Correlation coefficient
  const rDenom = new Decimal(n).times(sumXX).minus(sumX.times(sumX)).times(new Decimal(n).times(sumYY).minus(sumY.times(sumY))).sqrt()
  const r = rDenom.isZero() ? new Decimal(0) : new Decimal(n).times(sumXY).minus(sumX.times(sumY)).dividedBy(rDenom)
  const rSquared = r.times(r)

  return {
    model: 'linear',
    coefficients: [intercept, slope],
    r,
    rSquared,
    formula: `y = ${slope.toString()}x + ${intercept.toString()}`
  }
}

function covSq(xs: readonly Decimal[], ys: readonly Decimal[]): { r: Decimal; rSquared: Decimal } {
  const n = xs.length
  const sumX = xs.reduce((a, b) => a.plus(b), new Decimal(0))
  const sumY = ys.reduce((a, b) => a.plus(b), new Decimal(0))
  const sumXY = xs.reduce((a, b, i) => a.plus(b.times(ys[i])), new Decimal(0))
  const sumXX = xs.reduce((a, b) => a.plus(b.times(b)), new Decimal(0))
  const sumYY = ys.reduce((a, b) => a.plus(b.times(b)), new Decimal(0))
  const denom = new Decimal(n).times(sumXX).minus(sumX.times(sumX)).times(new Decimal(n).times(sumYY).minus(sumY.times(sumY))).sqrt()
  const r = denom.isZero() ? new Decimal(0) : new Decimal(n).times(sumXY).minus(sumX.times(sumY)).dividedBy(denom)
  return { r, rSquared: r.times(r) }
}

export function logarithmicRegression(xs: readonly Decimal[], ys: readonly Decimal[]): RegressionResult {
  const [x, y] = toPairedArrays(xs, ys, 'x', 'y')
  if (x.some((v) => !v.isPositive())) throw new CalcError('Logarithmic regression needs positive x values')
  const lnX = x.map((v) => v.ln())
  const base = linearRegression(lnX, y)
  const intercept = base.coefficients[0]
  const slope = base.coefficients[1]
  return {
    model: 'logarithmic',
    coefficients: [intercept, slope],
    r: base.r,
    rSquared: base.rSquared,
    formula: `y = ${slope.toString()} ln(x) + ${intercept.toString()}`
  }
}

export function exponentialRegression(xs: readonly Decimal[], ys: readonly Decimal[]): RegressionResult {
  const [x, y] = toPairedArrays(xs, ys, 'x', 'y')
  if (y.some((v) => !v.isPositive())) throw new CalcError('Exponential regression needs positive y values')
  const lnY = y.map((v) => v.ln())
  const base = linearRegression(x, lnY)
  const lnA = base.coefficients[0]
  const b = base.coefficients[1]
  const a = lnA.exp()
  return {
    model: 'exponential',
    coefficients: [a, b],
    r: base.r,
    rSquared: base.rSquared,
    formula: `y = ${a.toString()} * e^(${b.toString()}x)`
  }
}

export function powerRegression(xs: readonly Decimal[], ys: readonly Decimal[]): RegressionResult {
  const [x, y] = toPairedArrays(xs, ys, 'x', 'y')
  if (x.some((v) => !v.isPositive())) throw new CalcError('Power regression needs positive x values')
  if (y.some((v) => !v.isPositive())) throw new CalcError('Power regression needs positive y values')
  const lnX = x.map((v) => v.ln())
  const lnY = y.map((v) => v.ln())
  const base = linearRegression(lnX, lnY)
  const lnA = base.coefficients[0]
  const b = base.coefficients[1]
  const a = lnA.exp()
  return {
    model: 'power',
    coefficients: [a, b],
    r: base.r,
    rSquared: base.rSquared,
    formula: `y = ${a.toString()} * x^(${b.toString()})`
  }
}

// ---------- Distributions ----------

// Lanczos approximation for ln(Γ(z)), z > 0
const LANCZOS_G = 7
const LANCZOS_COEFFS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
]

/**
 * Float gate for the distribution / hypothesis-test functions, which work in binary
 * floating point for speed. Same rules as the Decimal helpers: finite, real numbers
 * only, with an argument name in the message.
 */
function num(value: unknown, what: string, opts: { min?: number; max?: number; exclusiveMin?: number } = {}): number {
  const d = toDecimalInput(value, what)
  const n = d.toNumber()
  if (!Number.isFinite(n)) throw new CalcError(`${what} must be a finite number`)
  if (opts.min !== undefined && n < opts.min) throw new CalcError(`${what} must be at least ${opts.min}`)
  if (opts.exclusiveMin !== undefined && n <= opts.exclusiveMin) throw new CalcError(`${what} must be greater than ${opts.exclusiveMin}`)
  if (opts.max !== undefined && n > opts.max) throw new CalcError(`${what} must be at most ${opts.max}`)
  return n
}

/** The probability argument of every inverse function: strictly between 0 and 1. */
function prob(value: unknown, what = 'probability'): number {
  const p = num(value, what)
  if (p <= 0 || p >= 1) throw new CalcError(`${what} must be between 0 and 1 (not inclusive)`)
  return p
}

/** Degrees of freedom: a positive number. */
const df = (value: unknown): number => num(value, 'degrees of freedom', { exclusiveMin: 0 })

/** A plain-number sample for the hypothesis tests. */
function sampleInput(value: unknown, what = 'sample'): number[] {
  if (!Array.isArray(value)) throw new CalcError(`${what} must be a list of numbers (got ${describe(value)})`)
  if (value.length > CALC_LIMITS.datasetSize) throw new CalcError(limitMessage('datasetSize', 'values'))
  return value.map((v, i) => num(v, `${what}[${i}]`))
}

export function gammaLn(z: number): number {
  const value = num(z, 'z', { exclusiveMin: 0 })
  if (value < 0.5) {
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * value))) - gammaLn(1 - value)
  }
  z = value - 1
  let a = LANCZOS_COEFFS[0]
  const t = z + LANCZOS_G + 0.5
  for (let i = 1; i < LANCZOS_G + 2; i++) {
    a += LANCZOS_COEFFS[i] / (z + i)
  }
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a)
}

export function gammaFn(x: number): number {
  const value = num(x, 'x')
  if (Number.isInteger(value) && value <= 0) throw new CalcError('Gamma is undefined for non-positive integers')
  if (value > 171) throw new CalcError('Gamma of x above 171 overflows a double')
  if (value < 0.5) return Math.PI / (Math.sin(Math.PI * value) * Math.exp(gammaLn(1 - value)))
  return Math.exp(gammaLn(value))
}

// Regularized lower incomplete gamma function P(a, x)
function lowerGamma(a: number, x: number): number {
  if (x <= 0) return 0
  if (x < a + 1) {
    let sum = 1 / a
    let term = sum
    let ap = a
    for (let n = 1; n <= 200; n++) {
      ap += 1
      term *= x / ap
      sum += term
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break
    }
    return sum * Math.exp(-x + a * Math.log(x) - gammaLn(a))
  }
  // Continued fraction for Q(a,x)
  let b = x + 1 - a
  let c = 1 / 1e-300
  let d = 1 / b
  let h = d
  for (let i = 1; i <= 200; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < 1e-300) d = 1e-300
    c = b + an / c
    if (Math.abs(c) < 1e-300) c = 1e-300
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-15) break
  }
  return 1 - Math.exp(-x + a * Math.log(x) - gammaLn(a)) * h
}

// Regularized incomplete beta function
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200
  const EPS = 3e-14
  const FPMIN = 1e-300
  let qab = a + b
  let qap = a + 1
  let qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

export function incompleteBeta(a: number, b: number, x: number): number {
  a = num(a, 'a', { exclusiveMin: 0 })
  b = num(b, 'b', { exclusiveMin: 0 })
  x = num(x, 'x')
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(gammaLn(a + b) - gammaLn(a) - gammaLn(b) + a * Math.log(x) + b * Math.log(1 - x))
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(a, b, x)) / a
  }
  return 1 - (bt * betacf(b, a, 1 - x)) / b
}

export interface DistributionFunctions {
  pdf(x: number, ...params: number[]): number
  cdf(x: number, ...params: number[]): number
  inv(p: number, ...params: number[]): number
}

export const normal: DistributionFunctions = {
  pdf(x, mean = 0, sd = 1) {
    const xv = num(x, 'x')
    const m = num(mean, 'mean')
    const s = num(sd, 'standard deviation', { exclusiveMin: 0 })
    const z = (xv - m) / s
    return Math.exp(-0.5 * z * z) / (s * Math.sqrt(2 * Math.PI))
  },
  cdf(x, mean = 0, sd = 1) {
    const xv = num(x, 'x')
    const m = num(mean, 'mean')
    const s = num(sd, 'standard deviation', { exclusiveMin: 0 })
    const z = (xv - m) / (s * Math.SQRT2)
    return 0.5 * (1 + erf(z))
  },
  inv(pTarget, mean = 0, sd = 1) {
    const pv = prob(pTarget)
    const m = num(mean, 'mean')
    const s = num(sd, 'standard deviation', { exclusiveMin: 0 })
    // Acklam's algorithm
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239]
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
    const plow = 0.02425
    const phigh = 1 - plow
    let z: number
    const p = pv
    if (p < plow) {
      const q = Math.sqrt(-2 * Math.log(p))
      z = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    } else if (p <= phigh) {
      const q = p - 0.5
      const r = q * q
      z = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    } else {
      const q = Math.sqrt(-2 * Math.log(1 - p))
      z = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    }
    return m + s * z
  }
}

function erf(x: number): number {
  if (x < 0) return -erf(-x)
  const t = 1 / (1 + 0.5 * Math.abs(x))
  const y = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))))
  return 1 - y
}

export const binomial: DistributionFunctions = {
  pdf(k, n, p) {
    const kv = num(k, 'k')
    const nv = num(n, 'n', { exclusiveMin: 0 })
    const pv = num(p, 'p')
    if (pv < 0 || pv > 1) throw new CalcError('p must be between 0 and 1')
    if (!Number.isInteger(kv) || kv < 0 || kv > nv) return 0
    return Math.exp(gammaLn(nv + 1) - gammaLn(kv + 1) - gammaLn(nv - kv + 1) + kv * Math.log(pv) + (nv - kv) * Math.log(1 - pv))
  },
  cdf(k, n, p) {
    const kv = num(k, 'k')
    const nv = num(n, 'n', { exclusiveMin: 0 })
    const pv = num(p, 'p')
    if (pv < 0 || pv > 1) throw new CalcError('p must be between 0 and 1')
    if (kv < 0) return 0
    if (kv >= nv) return 1
    // Same guard as Poisson: a million-term sum is not interactive, a normal
    // approximation with a continuity correction is (and is more accurate than summing).
    const top = Math.floor(kv)
    if (top > 10_000) {
      const sd = Math.sqrt(nv * pv * (1 - pv))
      if (sd === 0) return 1
      return Math.min(1, Math.max(0, normal.cdf((top + 0.5 - nv * pv) / sd)))
    }
    let sum = 0
    for (let i = 0; i <= top; i++) sum += binomial.pdf(i, nv, pv)
    return Math.min(1, sum)
  },
  inv(pTarget, n, p) {
    const target = prob(pTarget, 'probability')
    const nv = num(n, 'n', { exclusiveMin: 0, max: 1_000_000 })
    const pv = num(p, 'p')
    if (pv < 0 || pv > 1) throw new CalcError('p must be between 0 and 1')
    // Large n: binary search the CDF (which itself falls back to the normal approximation)
    // instead of stepping through a million terms.
    if (nv > 10_000) {
      let lo = 0
      let hi = nv
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2)
        if (binomial.cdf(mid, nv, pv) < target) lo = mid + 1
        else hi = mid
      }
      return lo
    }
    let cumulative = 0
    for (let k = 0; k <= nv; k++) {
      cumulative += binomial.pdf(k, nv, pv)
      if (cumulative >= target) return k
    }
    return nv
  }
}

export const poisson: DistributionFunctions = {
  pdf(k, lambda) {
    const kv = num(k, 'k')
    const l = num(lambda, 'lambda', { exclusiveMin: 0 })
    if (!Number.isInteger(kv) || kv < 0) return 0
    return Math.exp(-l + kv * Math.log(l) - gammaLn(kv + 1))
  },
  cdf(k, lambda) {
    const kv = num(k, 'k')
    const l = num(lambda, 'lambda', { exclusiveMin: 0 })
    if (kv < 0) return 0
    // Summing a billion terms would freeze the UI: for large k a normal approximation
    // (with a continuity correction) is accurate to about 4 decimals and instant.
    const top = Math.floor(kv)
    if (top > 10_000) {
      const z = (top + 0.5 - l) / Math.sqrt(l)
      return Math.min(1, Math.max(0, normal.cdf(z)))
    }
    let sum = 0
    for (let i = 0; i <= top; i++) sum += poisson.pdf(i, l)
    return Math.min(1, sum)
  },
  inv(pTarget, lambda) {
    const target = prob(pTarget, 'probability')
    const l = num(lambda, 'lambda', { exclusiveMin: 0 })
    let cumulative = 0
    for (let k = 0; k < 1000; k++) {
      cumulative += poisson.pdf(k, l)
      if (cumulative >= target) return k
    }
    return 1000
  }
}

export const studentT: DistributionFunctions = {
  pdf(t, dfValue) {
    const tv = num(t, 't')
    const d = df(dfValue)
    const num2 = gammaFn((d + 1) / 2)
    const den = Math.sqrt(d * Math.PI) * gammaFn(d / 2)
    return (num2 / den) * Math.pow(1 + (tv * tv) / d, -(d + 1) / 2)
  },
  cdf(t, dfValue) {
    const tv = num(t, 't')
    const d = df(dfValue)
    if (tv <= 0) {
      const x = d / (d + tv * tv)
      return 0.5 * incompleteBeta(d / 2, 0.5, x)
    }
    const x = d / (d + tv * tv)
    return 1 - 0.5 * incompleteBeta(d / 2, 0.5, x)
  },
  inv(p, dfValue) {
    const target = prob(p)
    const d = df(dfValue)
    // Binary search
    let lo = -1000
    let hi = 1000
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2
      if (studentT.cdf(mid, d) < target) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }
}

export const chiSquare: DistributionFunctions = {
  pdf(x, dfValue) {
    const xv = num(x, 'x')
    const d = df(dfValue)
    if (xv <= 0) return 0
    const k = d / 2
    return Math.exp((k - 1) * Math.log(xv) - xv / 2 - k * Math.log(2) - gammaLn(k))
  },
  cdf(x, dfValue) {
    const xv = num(x, 'x')
    const d = df(dfValue)
    if (xv <= 0) return 0
    return lowerGamma(d / 2, xv / 2)
  },
  inv(p, dfValue) {
    const target = prob(p)
    const d = df(dfValue)
    let lo = 0
    let hi = d * 10 + 100
    let guard = 0
    while (chiSquare.cdf(hi, d) < target && guard++ < 60) hi *= 2
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2
      if (chiSquare.cdf(mid, d) < target) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }
}

export const uniform: DistributionFunctions = {
  pdf(x, a = 0, b = 1) {
    const xv = num(x, 'x')
    const av = num(a, 'a')
    const bv = num(b, 'b')
    if (bv <= av) throw new CalcError('b must be greater than a')
    return xv >= av && xv <= bv ? 1 / (bv - av) : 0
  },
  cdf(x, a = 0, b = 1) {
    const xv = num(x, 'x')
    const av = num(a, 'a')
    const bv = num(b, 'b')
    if (bv <= av) throw new CalcError('b must be greater than a')
    if (xv < av) return 0
    if (xv > bv) return 1
    return (xv - av) / (bv - av)
  },
  inv(p, a = 0, b = 1) {
    const target = prob(p)
    const av = num(a, 'a')
    const bv = num(b, 'b')
    if (bv <= av) throw new CalcError('b must be greater than a')
    return av + target * (bv - av)
  }
}

// ---------- Hypothesis tests ----------

export interface TestResult {
  statistic: number
  pValue: number
  df?: number
}

export function tTestOneSample(sample: number[], mu = 0): TestResult {
  const xs = sampleInput(sample)
  const mean0 = num(mu, 'mu')
  const n = xs.length
  if (n < 2) throw new CalcError('Need at least 2 observations')
  const mean = xs.reduce((a, b) => a + b, 0) / n
  let ss = 0
  for (const x of xs) ss += (x - mean) ** 2
  const s = Math.sqrt(ss / (n - 1))
  const se = s / Math.sqrt(n)
  const t = se === 0 ? 0 : (mean - mean0) / se
  const pValue = 2 * (1 - studentT.cdf(Math.abs(t), n - 1))
  return { statistic: t, pValue, df: n - 1 }
}

export function tTestTwoSample(a: number[], b: number[], equalVariance = false): TestResult {
  const xs = sampleInput(a, 'sample a')
  const ys = sampleInput(b, 'sample b')
  const n1 = xs.length
  const n2 = ys.length
  if (n1 < 2 || n2 < 2) throw new CalcError('Need at least 2 observations in each sample')
  const m1 = xs.reduce((x, y) => x + y, 0) / n1
  const m2 = ys.reduce((x, y) => x + y, 0) / n2
  let ss1 = 0
  let ss2 = 0
  for (const x of xs) ss1 += (x - m1) ** 2
  for (const x of ys) ss2 += (x - m2) ** 2
  const v1 = ss1 / (n1 - 1)
  const v2 = ss2 / (n2 - 1)
  let df: number
  let se: number
  if (equalVariance) {
    const sp2 = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2)
    se = Math.sqrt(sp2 * (1 / n1 + 1 / n2))
    df = n1 + n2 - 2
  } else {
    se = Math.sqrt(v1 / n1 + v2 / n2)
    const num = (v1 / n1 + v2 / n2) ** 2
    const den = (v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1)
    df = den === 0 ? n1 + n2 - 2 : num / den
  }
  const t = se === 0 ? 0 : (m1 - m2) / se
  const pValue = 2 * (1 - studentT.cdf(Math.abs(t), df))
  return { statistic: t, pValue, df }
}

export function zTestOneSample(sample: number[], sigma: number, mu = 0): TestResult {
  const xs = sampleInput(sample)
  const sd = num(sigma, 'sigma', { exclusiveMin: 0 })
  const mean0 = num(mu, 'mu')
  const n = xs.length
  if (n < 1) throw new CalcError('Need at least 1 observation')
  const mean = xs.reduce((a, b) => a + b, 0) / n
  const z = (mean - mean0) / (sd / Math.sqrt(n))
  const pValue = 2 * (1 - normal.cdf(Math.abs(z)))
  return { statistic: z, pValue }
}

// ---------- Registration ----------

export function registerStatisticsFunctions(): void {
  const toNum = (d: Decimal): number => d.toNumber()
  const toDec = (n: number): Decimal => new Decimal(n)

  for (const [name, fn] of Object.entries(normal)) {
    registry.registerFunction({
      name: `normal_${name}`,
      category: 'stats',
      description: `Normal distribution ${name.toUpperCase()}`,
      examples: name === 'cdf' ? ['normal_cdf(1.96, 0, 1)'] : name === 'pdf' ? ['normal_pdf(0, 0, 1)'] : ['normal_inv(0.975, 0, 1)'],
      minArity: name === 'inv' ? 1 : 1,
      maxArity: 3,
      impl: (args) => toDec(fn(args[0].toNumber(), ...args.slice(1).map((a) => a.toNumber())))
    })
  }

  for (const [name, fn] of Object.entries(binomial)) {
    registry.registerFunction({
      name: `binomial_${name}`,
      category: 'stats',
      description: `Binomial distribution ${name.toUpperCase()}`,
      examples: ['binomial_pdf(3, 10, 0.5)'],
      minArity: name === 'inv' ? 3 : 1,
      maxArity: 3,
      impl: (args) => toDec(fn(...args.map((a) => a.toNumber())))
    })
  }

  for (const [name, fn] of Object.entries(poisson)) {
    registry.registerFunction({
      name: `poisson_${name}`,
      category: 'stats',
      description: `Poisson distribution ${name.toUpperCase()}`,
      examples: ['poisson_pdf(2, 3)'],
      minArity: name === 'inv' ? 2 : 1,
      maxArity: 2,
      impl: (args) => toDec(fn(...args.map((a) => a.toNumber())))
    })
  }

  for (const [name, fn] of Object.entries(studentT)) {
    registry.registerFunction({
      name: `t_${name}`,
      category: 'stats',
      description: `Student's t-distribution ${name.toUpperCase()}`,
      examples: ['t_cdf(1.96, 30)'],
      minArity: 1,
      maxArity: 2,
      impl: (args) => toDec(fn(...args.map((a) => a.toNumber())))
    })
  }

  for (const [name, fn] of Object.entries(chiSquare)) {
    registry.registerFunction({
      name: `chi2_${name}`,
      category: 'stats',
      description: `Chi-square distribution ${name.toUpperCase()}`,
      examples: ['chi2_cdf(3.84, 1)'],
      minArity: 1,
      maxArity: 2,
      impl: (args) => toDec(fn(...args.map((a) => a.toNumber())))
    })
  }

  for (const [name, fn] of Object.entries(uniform)) {
    registry.registerFunction({
      name: `uniform_${name}`,
      category: 'stats',
      description: `Uniform distribution ${name.toUpperCase()}`,
      examples: ['uniform_pdf(0.5, 0, 1)'],
      minArity: 1,
      maxArity: 3,
      impl: (args) => toDec(fn(args[0].toNumber(), ...args.slice(1).map((a) => a.toNumber())))
    })
  }

  registry.registerFunction({
    name: 'mean',
    category: 'stats',
    description: 'Arithmetic mean of comma-separated values in a dataset expression',
    examples: ['mean(1, 2, 3, 4)'],
    minArity: 1,
    maxArity: 999,
    impl: (args) => args.reduce((a, b) => a.plus(b), new Decimal(0)).dividedBy(args.length)
  })

  registry.registerFunction({
    name: 'stdev',
    category: 'stats',
    description: 'Sample standard deviation',
    examples: ['stdev(2, 4, 4, 4, 5, 5, 7, 9)'],
    minArity: 2,
    maxArity: 999,
    impl: (args) => computeStats(args).stdDevSample
  })

  registry.registerFunction({
    name: 'stdevp',
    category: 'stats',
    description: 'Population standard deviation',
    examples: ['stdevp(2, 4, 4, 4, 5, 5, 7, 9)'],
    minArity: 1,
    maxArity: 999,
    impl: (args) => computeStats(args).stdDev
  })

  registry.registerFunction({
    name: 'median',
    category: 'stats',
    description: 'Median of values',
    examples: ['median(1, 3, 2)'],
    minArity: 1,
    maxArity: 999,
    impl: (args) => computeStats(args).median
  })

  registry.registerFunction({
    name: 'gensigma',
    category: 'stats',
    description: 'Gamma function Γ(x)',
    examples: ['gensigma(5)'],
    minArity: 1,
    maxArity: 1,
    impl: ([x]) => toDec(gammaFn(x.toNumber()))
  })
}

registerStatisticsFunctions()
