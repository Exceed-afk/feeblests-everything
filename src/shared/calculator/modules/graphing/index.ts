import { parse } from '../../parser'
import { Evaluator } from '../../evaluator'
import { Decimal } from '../../numeric'
import { CALC_LIMITS, limitMessage } from '../../limits'
import { CalcError } from '../../errors'
import { toDecimalInput, toStringInput } from '../../inputs'

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

/**
 * Evaluates an expression at a specific x value using the pure AST evaluator.
 */
export function evaluateAt(ast: import('../../parser').ASTNode, xVal: number): number | null {
  try {
    const evaluator = new Evaluator({
      scope: {
        x: new Decimal(xVal),
        t: new Decimal(xVal),
        theta: new Decimal(xVal)
      }
    })
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
  resolution = 300
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

  let prevY: number | null = null

  for (let i = 0; i <= count; i++) {
    const x = r.xMin + i * dx
    const y = evaluateAt(ast, x)

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
        // Bisection refine
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
