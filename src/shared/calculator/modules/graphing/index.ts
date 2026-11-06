import { parse } from '../../parser'
import { Evaluator } from '../../evaluator'
import { Decimal } from '../../numeric'
import { CALC_LIMITS, limitMessage } from '../../limits'
import { CalcError } from '../../errors'
import { toDecimalInput, toStringInput } from '../../inputs'
import {
  compileFloatExpression,
  UnsupportedExpression,
  type AngleMode
} from './float-compile'

export { UnsupportedExpression } from './float-compile'
export type { AngleMode } from './float-compile'

/**
 * Angle mode for plotting. Callers pass it explicitly (the worker has no
 * CalculatorEngine instance to read it from); defaults to degrees.
 */
function resolveAngleMode(explicit?: AngleMode): AngleMode {
  return explicit ?? 'deg'
}

export interface SampleOptions {
  /** Angle mode for trig functions in the float fast path. Defaults to degrees. */
  angleMode?: AngleMode
}

/**
 * Build the float closure, or null when the expression needs the exact Decimal path.
 * Any float-path incompatibility (user variables, assignments, functions without a
 * float twin, literals beyond double range) returns null: never a silently different
 * result.
 */
function floatClosure(ast: import('../../parser').ASTNode, options?: SampleOptions): ((x: number) => number) | null {
  try {
    return compileFloatExpression(ast, { angleMode: resolveAngleMode(options?.angleMode) })
  } catch (err) {
    if (err instanceof UnsupportedExpression) return null
    throw err
  }
}

/** One plot point budget; sample, roots and extrema all draw from it. */
function sampleCount(value: unknown, what = 'resolution'): number {
  const d = toDecimalInput(value, what)
  const n = d.toNumber()
  if (!Number.isInteger(n) || n < 1) throw new CalcError(`${what} must be a whole number of at least 1`)
  if (n > CALC_LIMITS.graphSampleCount) {
    throw new CalcError(`${limitMessage('graphSampleCount', 'points')} (got ${n.toLocaleString('en-US')})`)
  }
  return n
}

function plotRange(range: unknown): PlotRange {
  if (!range || typeof range !== 'object') throw new CalcError('range must be an object { xMin, xMax, yMin, yMax }')
  const r = range as PlotRange
  const xMin = toDecimalInput(r.xMin, 'range.xMin').toNumber()
  const xMax = toDecimalInput(r.xMax, 'range.xMax').toNumber()
  const yMin = toDecimalInput(r.yMin, 'range.yMin').toNumber()
  const yMax = toDecimalInput(r.yMax, 'range.yMax').toNumber()
  if (!(xMax > xMin)) throw new CalcError('range.xMax must be greater than range.xMin')
  if (!(yMax > yMin)) throw new CalcError('range.yMax must be greater than range.yMin')
  return { xMin, xMax, yMin, yMax }
}

export interface PlotRange {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

export interface SamplePoint {
  x: number
  y: number | null
  discontinuous?: boolean
}

export interface ExtremaPoint {
  x: number
  y: number
  type: 'min' | 'max'
}

export interface ParametricPoint {
  t: number
  x: number | null
  y: number | null
}

export interface PolarPoint {
  theta: number
  r: number | null
  x: number | null
  y: number | null
}

export interface TableRow {
  x: number
  y: number | null
}

export type DerivativeResult =
  | { kind: 'ok'; x: number; derivative: number; f: number; central: number; left: number; right: number }
  | { kind: 'undefined'; x: number; message: string }
  | { kind: 'notDifferentiable'; x: number; message: string }

/**
 * One float-path evaluation: a finite double is the point, NaN/Infinity (or a
 * throw from a domain error inside the closure) is a dead point, exactly like
 * evaluateAt returns null.
 */
function evalFloat(fn: (x: number) => number, x: number): number | null {
  try {
    const y = fn(x)
    return Number.isFinite(y) ? y : null
  } catch {
    return null
  }
}

/**
 * Evaluates an expression at a specific x value using the exact Decimal evaluator.
 * This is the reference path: every number shown to the user (roots, extrema, trace
 * values) comes from here or is refined with it.
 */
export function evaluateAt(
  ast: import('../../parser').ASTNode,
  xVal: number,
  angleMode?: AngleMode
): number | null {
  try {
    const scope: Record<string, Decimal> = {
      x: new Decimal(xVal),
      t: new Decimal(xVal),
      theta: new Decimal(xVal)
    }
    // Same convention the CalculatorEngine uses to tell the scientific
    // registry the mode (0 = deg, 1 = rad, 2 = grad). Only set when the caller
    // passes one, so existing call sites keep today's behaviour.
    if (angleMode) {
      scope.__anglemode = new Decimal(angleMode === 'rad' ? 1 : angleMode === 'grad' ? 2 : 0)
    }
    const evaluator = new Evaluator({ scope })
    const res = evaluator.evaluate(ast)
    const num = res.toNumber()
    if (!Number.isFinite(num)) return null
    return num
  } catch {
    return null
  }
}

/**
 * Samples a function over [xMin, xMax] with adaptive step subdivision
 * to detect vertical asymptotes and discontinuities.
 */
export function sampleFunction(
  expr: string,
  range: PlotRange,
  resolution = 300,
  options?: SampleOptions
): SamplePoint[] {
  const source = toStringInput(expr, 'expression')
  const r = plotRange(range)
  const count = sampleCount(resolution)
  const ast = parse(source)
  const result: SamplePoint[] = []

  const xSpan = r.xMax - r.xMin
  const dx = xSpan / count
  const ySpan = r.yMax - r.yMin
  const yThreshold = Math.max(10, ySpan * 3)

  // Plotting-only fast path: float64 closure. Anything the float path cannot
  // mirror exactly falls back to the exact Decimal evaluator per point.
  const fastFn = floatClosure(ast, options)

  let prevY: number | null = null

  for (let i = 0; i <= count; i++) {
    const x = r.xMin + i * dx
    const y = fastFn ? evalFloat(fastFn, x) : evaluateAt(ast, x, resolveAngleMode(options?.angleMode))

    if (y === null) {
      result.push({ x, y: null, discontinuous: true })
      prevY = null
      continue
    }

    // Check for large steep jump indicating an asymptote (e.g. 1/x or tan(x))
    if (prevY !== null && Math.abs(y - prevY) > yThreshold) {
      result.push({ x, y: null, discontinuous: true })
    } else {
      result.push({ x, y })
    }

    prevY = y
  }

  return result
}

/**
 * Finds roots (x-intercepts where y = 0) in [xMin, xMax] using bisection.
 */
export function findRoots(expr: string, xMin: number, xMax: number, steps = 100): number[] {
  const source = toStringInput(expr, 'expression')
  const lo0 = toDecimalInput(xMin, 'xMin').toNumber()
  const hi0 = toDecimalInput(xMax, 'xMax').toNumber()
  if (!(hi0 > lo0)) throw new CalcError('xMax must be greater than xMin')
  const count = sampleCount(steps, 'steps')
  const ast = parse(source)
  const roots: number[] = []
  const dx = (hi0 - lo0) / count

  let prevX = lo0
  let prevY = evaluateAt(ast, prevX)

  for (let i = 1; i <= count; i++) {
    const curX = lo0 + i * dx
    const curY = evaluateAt(ast, curX)

    if (curY !== null && prevY !== null) {
      // Check sign change
      if (curY === 0) {
        roots.push(curX)
      } else if (prevY * curY < 0 && Math.abs(curY - prevY) < 100) {
        // Bisection refine, always on the exact Decimal evaluator so the
        // reported root keeps full precision regardless of the sampling path.
        let lo = prevX
        let hi = curX
        for (let iter = 0; iter < 20; iter++) {
          const mid = (lo + hi) / 2
          const midY = evaluateAt(ast, mid)
          if (midY === null || Math.abs(midY) < 1e-6) {
            lo = mid
            break
          }
          if (prevY * midY < 0) {
            hi = mid
          } else {
            lo = mid
          }
        }
        roots.push((lo + hi) / 2)
      }
    }

    prevX = curX
    prevY = curY
  }

  return roots
}

/**
 * Finds local minima and maxima by scanning sign changes of the numeric derivative.
 */
export function findExtrema(expr: string, xMin: number, xMax: number, steps = 100): ExtremaPoint[] {
  const source = toStringInput(expr, 'expression')
  const lo = toDecimalInput(xMin, 'xMin').toNumber()
  const hi = toDecimalInput(xMax, 'xMax').toNumber()
  if (!(hi > lo)) throw new CalcError('xMax must be greater than xMin')
  const count = sampleCount(steps, 'steps')
  const ast = parse(source)
  const extrema: ExtremaPoint[] = []
  const dx = (hi - lo) / count
  const h = 1e-4

  const deriv = (x: number): number | null => {
    const y1 = evaluateAt(ast, x + h)
    const y0 = evaluateAt(ast, x - h)
    if (y1 === null || y0 === null) return null
    return (y1 - y0) / (2 * h)
  }

  let prevX = lo
  let prevD = deriv(prevX)

  for (let i = 1; i <= count; i++) {
    const curX = lo + i * dx
    const curD = deriv(curX)

    if (curD !== null && Math.abs(curD) < 1e-9) {
      const y = evaluateAt(ast, curX)
      if (y !== null) {
        extrema.push({
          x: curX,
          y,
          type: prevD !== null && prevD < 0 ? 'min' : 'max'
        })
      }
    } else if (prevD !== null && curD !== null && prevD * curD < 0) {
      const midX = (prevX + curX) / 2
      const y = evaluateAt(ast, midX)
      if (y !== null) {
        extrema.push({
          x: midX,
          y,
          type: prevD < 0 ? 'min' : 'max'
        })
      }
    }

    prevX = curX
    prevD = curD
  }

  return extrema
}

// ---------------------------------------------------------------------------
// Intersections of two functions: f(x) = g(x)
// ---------------------------------------------------------------------------

export interface IntersectionPoint {
  x: number
  y: number
  /**
   * 'crossing' when the difference changes sign (a real crossing),
   * 'touching' when the curves meet without crossing (a tangency, found with the
   * extrema finder). Both are real intersections; the label is for the UI.
   */
  kind: 'crossing' | 'touching'
}

export interface IntersectionOptions {
  angleMode?: AngleMode
  /** Scan points across the visible x range. Defaults to 400, capped by graphSampleCount. */
  steps?: number
}

/**
 * Where two graphed functions meet, over the visible x range.
 *
 * Method: h(x) = f(x) - g(x) is scanned for sign changes, each one is refined by
 * bisection on the exact evaluator, and the result is kept only when
 * |f(x) - g(x)| is tiny there. That last check is what rejects the fake
 * "intersections" a sign change produces at a discontinuity (tan(x) vs 0 at
 * 90 degrees, 1/x vs 0 at 0): the difference flips sign across the pole but is
 * never small at any point in between.
 *
 * Touching without crossing (x^2 vs 0 at x = 0) has no sign change, so it is
 * found with the existing extrema finder on h(x): a local extremum whose value
 * is ~0 is a tangency. It is reported with kind 'touching'.
 *
 * Results closer together than the scan step are merged, so one intersection is
 * never listed twice.
 */
export function findIntersections(
  fExpr: string,
  gExpr: string,
  xMin: number,
  xMax: number,
  options: IntersectionOptions = {}
): IntersectionPoint[] {
  const fSource = toStringInput(fExpr, 'f(x) expression')
  const gSource = toStringInput(gExpr, 'g(x) expression')
  const lo = toDecimalInput(xMin, 'xMin').toNumber()
  const hi = toDecimalInput(xMax, 'xMax').toNumber()
  if (!(hi > lo)) throw new CalcError('xMax must be greater than xMin')
  const count = sampleCount(options.steps ?? 400, 'steps')
  const angleMode = resolveAngleMode(options.angleMode)
  const fAst = parse(fSource)
  const gAst = parse(gSource)

  const fAt = (x: number): number | null => evaluateAt(fAst, x, angleMode)
  const gAt = (x: number): number | null => evaluateAt(gAst, x, angleMode)
  /** h(x) = f(x) - g(x); null when either side is undefined at x. */
  const hAt = (x: number): number | null => {
    const f = fAt(x)
    const g = gAt(x)
    if (f === null || g === null) return null
    const h = f - g
    return Number.isFinite(h) ? h : null
  }

  const dx = (hi - lo) / count
  // "Tiny" is relative to the size of the two functions at the point, so a
  // crossing of two large curves is not rejected for a rounding-sized gap.
  const isTiny = (x: number): boolean => {
    const f = fAt(x)
    const g = gAt(x)
    if (f === null || g === null) return false
    const scale = Math.max(1, Math.abs(f), Math.abs(g))
    return Math.abs(f - g) <= 1e-6 * scale
  }

  const found: IntersectionPoint[] = []
  const push = (x: number, kind: 'crossing' | 'touching') => {
    if (!Number.isFinite(x) || x < lo - dx || x > hi + dx) return
    // Merge duplicates: one intersection is never listed twice. A tangency found
    // by the extrema pass wins over the same point found as a crossing, because
    // a scan point landing exactly on the touching point looks like a sign change.
    const existing = found.find((p) => Math.abs(p.x - x) <= dx)
    if (existing) {
      if (kind === 'touching') existing.kind = 'touching'
      return
    }
    const y = fAt(x)
    if (y === null || !Number.isFinite(y)) return
    found.push({ x, y, kind })
  }

  // 1. Sign changes of h, refined by bisection on the exact evaluator.
  let prevX = lo
  let prevH = hAt(prevX)
  for (let i = 1; i <= count; i++) {
    const curX = lo + i * dx
    const curH = hAt(curX)
    if (curH !== null && prevH !== null) {
      if (curH === 0) {
        if (isTiny(curX)) push(curX, 'crossing')
      } else if (prevH * curH < 0) {
        let a = prevX
        let b = curX
        let ha = prevH
        for (let iter = 0; iter < 60; iter++) {
          const mid = (a + b) / 2
          const hm = hAt(mid)
          if (hm === null) break
          if (hm === 0) {
            a = mid
            b = mid
            break
          }
          if (ha * hm < 0) b = mid
          else {
            a = mid
            ha = hm
          }
        }
        const root = (a + b) / 2
        // The discontinuity guard: a sign change across a pole is not an intersection.
        if (isTiny(root)) push(root, 'crossing')
      }
    }
    prevX = curX
    prevH = curH
  }

  // 2. Touching without crossing: a local extremum of h whose value is ~0.
  //    The extrema finder works on an expression, so h is rebuilt as text.
  const hExpr = `(${fSource}) - (${gSource})`
  let extrema: ExtremaPoint[] = []
  try {
    extrema = findExtrema(hExpr, lo, hi, Math.min(count, 200))
  } catch {
    extrema = [] // an expression the extrema finder cannot scan simply adds no tangencies
  }
  for (const e of extrema) {
    if (isTiny(e.x)) push(e.x, 'touching')
  }

  found.sort((a, b) => a.x - b.x)
  return found
}

// ---------------------------------------------------------------------------
// Parametric plots: x(t), y(t)
// ---------------------------------------------------------------------------

export interface ParametricOptions {
  angleMode?: AngleMode
}

/** A [tMin, tMax] interval: tMax must be strictly greater than tMin, both finite. */
function parametricInterval(tMin: unknown, tMax: unknown): { tMin: number; tMax: number } {
  const lo = toDecimalInput(tMin, 'tMin').toNumber()
  const hi = toDecimalInput(tMax, 'tMax').toNumber()
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new CalcError('t range must be finite numbers')
  if (!(hi > lo)) throw new CalcError('tMax must be greater than tMin')
  return { tMin: lo, tMax: hi }
}

/**
 * Samples a parametric curve x(t), y(t) over [tMin, tMax] at `samples` points
 * (inclusive of both ends). Points where either coordinate is undefined carry
 * null so the renderer lifts the pen.
 */
export function sampleParametric(
  xExpr: string,
  yExpr: string,
  tMin: unknown,
  tMax: unknown,
  samples = 300,
  options?: ParametricOptions
): ParametricPoint[] {
  const xSource = toStringInput(xExpr, 'x(t) expression')
  const ySource = toStringInput(yExpr, 'y(t) expression')
  const { tMin: lo, tMax: hi } = parametricInterval(tMin, tMax)
  const count = sampleCount(samples, 'samples')
  const xAst = parse(xSource)
  const yAst = parse(ySource)
  const angleMode = resolveAngleMode(options?.angleMode)

  const fastX = floatClosure(xAst, { angleMode })
  const fastY = floatClosure(yAst, { angleMode })

  const dt = (hi - lo) / count
  const out: ParametricPoint[] = []
  for (let i = 0; i <= count; i++) {
    const t = lo + i * dt
    // Both coordinates go through the same path (fast or exact) so a curve is
    // never half-sampled in doubles and half in decimals.
    const x = fastX ? evalFloat(fastX, t) : evaluateAt(xAst, t, angleMode)
    const y = fastY ? evalFloat(fastY, t) : evaluateAt(yAst, t, angleMode)
    out.push({ t, x, y })
  }
  return out
}

// ---------------------------------------------------------------------------
// Polar plots: r(theta)
// ---------------------------------------------------------------------------

export interface PolarOptions {
  angleMode?: AngleMode
}

/**
 * Samples a polar curve r(theta) over [thetaMin, thetaMax] at `samples` points.
 * theta is passed to the expression in the CURRENT angle mode (so `theta` in
 * `r = theta` reads back degrees in DEG mode), while the conversion to screen
 * x/y always happens in radians internally.
 */
export function samplePolar(
  rExpr: string,
  thetaMin: unknown,
  thetaMax: unknown,
  samples = 300,
  options?: PolarOptions
): PolarPoint[] {
  const source = toStringInput(rExpr, 'r(theta) expression')
  const { tMin: lo, tMax: hi } = parametricInterval(thetaMin, thetaMax)
  const count = sampleCount(samples, 'samples')
  const ast = parse(source)
  const angleMode = resolveAngleMode(options?.angleMode)
  const fastFn = floatClosure(ast, { angleMode })

  // The expression sees theta in the user's angle mode; rad(theta) converts it
  // for the screen mapping. In DEG mode a sampled theta=90 means the expression
  // evaluates r at "90" (degrees) and the point sits at 90 degrees on screen.
  const modeToRad = angleMode === 'rad' ? 1 : angleMode === 'grad' ? Math.PI / 200 : Math.PI / 180

  const dTheta = (hi - lo) / count
  const out: PolarPoint[] = []
  for (let i = 0; i <= count; i++) {
    const theta = lo + i * dTheta
    const r = fastFn ? evalFloat(fastFn, theta) : evaluateAt(ast, theta, angleMode)
    if (r === null) {
      out.push({ theta, r: null, x: null, y: null })
      continue
    }
    const rad = theta * modeToRad
    out.push({ theta, r, x: r * Math.cos(rad), y: r * Math.sin(rad) })
  }
  return out
}

// ---------------------------------------------------------------------------
// Value table for the selected function
// ---------------------------------------------------------------------------

export interface TableOptions {
  angleMode?: AngleMode
}

/**
 * Values of the selected function at `count` points starting at `start`,
 * stepping by `step`. Undefined points are null — the UI renders them as
 * "undefined", never NaN. Mirrors the sampling paths: float fast path when the
 * expression supports it, exact Decimal evaluator otherwise.
 */
export function buildValueTable(
  expr: string,
  start: unknown,
  step: unknown,
  count: unknown,
  options?: TableOptions
): TableRow[] {
  const source = toStringInput(expr, 'expression')
  const startVal = toDecimalInput(start, 'start').toNumber()
  const stepVal = toDecimalInput(step, 'step').toNumber()
  if (!Number.isFinite(startVal)) throw new CalcError('start must be a finite number')
  if (!Number.isFinite(stepVal)) throw new CalcError('step must be a finite number')
  if (stepVal === 0) throw new CalcError('step cannot be zero')
  const n = sampleCount(count, 'count')
  const ast = parse(source)
  const fastFn = floatClosure(ast, { angleMode: resolveAngleMode(options?.angleMode) })

  const rows: TableRow[] = []
  for (let i = 0; i < n; i++) {
    const x = startVal + i * stepVal
    const y = fastFn ? evalFloat(fastFn, x) : evaluateAt(ast, x, resolveAngleMode(options?.angleMode))
    rows.push({ x, y })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Derivative at a point (central difference + one-sided agreement check)
// ---------------------------------------------------------------------------

export interface DerivativeOptions {
  angleMode?: AngleMode
}

/**
 * Numerical derivative of the selected function at `point`.
 *
 * Central difference (f(x+h) - f(x-h)) / 2h is the headline number. The left
 * and right one-sided slopes (f(x) - f(x-h)) / h and (f(x+h) - f(x)) / h are
 * also computed; when they disagree beyond a scale-aware tolerance the point is
 * a corner or cusp (|x| at 0) and the answer is "not differentiable at this
 * point" instead of a number. When f itself is undefined at the point (or on
 * either side beyond the reach of the probe), the answer names that instead.
 *
 * h starts at 1e-5 and shrinks toward 1e-7 for small |x| so the probe stays
 * meaningful near the origin.
 */
export function derivativeAt(
  expr: string,
  point: unknown,
  options?: DerivativeOptions
): DerivativeResult {
  const source = toStringInput(expr, 'expression')
  const x0 = toDecimalInput(point, 'point').toNumber()
  if (!Number.isFinite(x0)) throw new CalcError('point must be a finite number')
  const ast = parse(source)
  const fastFn = floatClosure(ast, { angleMode: resolveAngleMode(options?.angleMode) })

  const eval1 = (x: number): number | null =>
    fastFn ? evalFloat(fastFn, x) : evaluateAt(ast, x, resolveAngleMode(options?.angleMode))

  const f0 = eval1(x0)
  if (f0 === null) {
    return { kind: 'undefined', x: x0, message: `The function is undefined at x = ${x0}` }
  }

  const h = Math.max(1e-7, Math.min(1e-5, Math.abs(x0) * 1e-5))
  const fMinus = eval1(x0 - h)
  const fPlus = eval1(x0 + h)

  if (fMinus === null || fPlus === null) {
    return {
      kind: 'undefined',
      x: x0,
      message: `The function is undefined on at least one side of x = ${x0}`
    }
  }

  const central = (fPlus - fMinus) / (2 * h)
  const leftSlope = (f0 - fMinus) / h
  const rightSlope = (fPlus - f0) / h

  // Scale-aware disagreement test: a corner has left and right slopes that do
  // not approach each other even as h shrinks. Tolerance grows with the size of
  // the slopes themselves, so a steep function is not falsely rejected, and
  // with |left| + |right| so |x| at 0 (slopes -1 and +1) is always caught.
  const scale = Math.max(1, Math.abs(f0))
  const slopeScale = Math.max(1, Math.abs(leftSlope), Math.abs(rightSlope))
  const tol = Math.max(1e-4 * slopeScale * scale, 1e-6)
  if (Math.abs(rightSlope - leftSlope) > tol) {
    return {
      kind: 'notDifferentiable',
      x: x0,
      message: `Not differentiable at x = ${x0} (left slope ${leftSlope.toPrecision(6)}, right slope ${rightSlope.toPrecision(6)})`
    }
  }

  // One refinement pass with a smaller probe for the reported central value.
  const h2 = h / 8
  const fMinus2 = eval1(x0 - h2)
  const fPlus2 = eval1(x0 + h2)
  const refined = fMinus2 !== null && fPlus2 !== null ? (fPlus2 - fMinus2) / (2 * h2) : central

  if (!Number.isFinite(refined)) {
    return { kind: 'undefined', x: x0, message: `The derivative at x = ${x0} is not finite` }
  }

  return {
    kind: 'ok',
    x: x0,
    derivative: refined,
    f: f0,
    central,
    left: leftSlope,
    right: rightSlope
  }
}
