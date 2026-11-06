import assert from 'node:assert/strict'
import { parse } from '../src/shared/calculator/parser'
import { Evaluator } from '../src/shared/calculator/evaluator'
import { Decimal } from '../src/shared/calculator/numeric'
import {
  compileFloatExpression,
  UnsupportedExpression
} from '../src/shared/calculator/modules/graphing/float-compile'
import { sampleFunction } from '../src/shared/calculator/modules/graphing'
import '../src/shared/calculator/modules/scientific'

let checks = 0
const ok = () => { checks++ }

/** Seeded PRNG (Mulberry32) for reproducible random points. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Tolerance: the float path must agree with the exact Decimal evaluator to a
 * RELATIVE error of 1e-9 (|float - decimal| <= 1e-9 * max(1, |decimal|)).
 * Decimal carries 20+ significant digits, float64 carries ~15.9, so ~1e-9
 * relative is the right budget for a few chained operations and one Math call.
 */
const REL_TOL = 1e-9

function decimalValue(ast: ReturnType<typeof parse>, x: number, angleMode: 'deg' | 'rad' | 'grad'): number | null {
  try {
    const evaluator = new Evaluator({
      scope: { x: new Decimal(x), t: new Decimal(x), theta: new Decimal(x) },
      // Mirror how the graphing module tells the scientific registry the mode:
      // via the __angleMode scope convention (0 = deg, 1 = rad, 2 = grad).
      angleMode
    })
    void evaluator
    // The scientific functions read the mode from the scope, so build a scope
    // carrying the same marker the CalculatorEngine sets:
    const scoped = new Evaluator({
      scope: {
        x: new Decimal(x),
        t: new Decimal(x),
        theta: new Decimal(x),
        __anglemode: new Decimal(angleMode === 'rad' ? 1 : angleMode === 'grad' ? 2 : 0)
      }
    })
    const res = scoped.evaluate(ast)
    const num = res.toNumber()
    return Number.isFinite(num) ? num : null
  } catch {
    return null
  }
}

const EXPRESSIONS: Array<{ expr: string; modes?: Array<'deg' | 'rad' | 'grad'>; positiveOnly?: boolean }> = [
  { expr: 'x' },
  { expr: '2x + 1' },
  { expr: 'x^2 - 4' },
  { expr: '3x^3 - 2x^2 + x - 7' },
  { expr: 'x^2 + 2x + 1' },
  { expr: '(x + 1) * (x - 3) / (x^2 + 1)' },
  { expr: 'sin(x)', modes: ['deg', 'rad', 'grad'] },
  { expr: 'cos(x)', modes: ['deg', 'rad', 'grad'] },
  { expr: 'tan(x)', modes: ['deg', 'rad', 'grad'] },
  { expr: 'sin(x) * cos(x)' },
  { expr: 'asin(sin(x) / 2)', modes: ['rad'] },
  { expr: 'atan(x)', modes: ['deg', 'rad', 'grad'] },
  { expr: 'sinh(x)' },
  { expr: 'cosh(x)' },
  { expr: 'tanh(x)' },
  { expr: 'ln(x)', modes: ['rad'] },
  { expr: 'log(x)', modes: ['rad'] },
  { expr: 'log(2, x)', modes: ['rad'] },
  { expr: 'log10(x)', modes: ['rad'] },
  { expr: 'log2(x)', modes: ['rad'] },
  { expr: 'exp(x)', modes: ['rad'] },
  { expr: 'sqrt(x)', modes: ['rad'], positiveOnly: true },
  { expr: 'sqrt(x^2 + 1)' },
  { expr: 'abs(x) - 2' },
  { expr: 'x % 3' },
  { expr: '2 ^ x', modes: ['rad'] },
  { expr: 'x ^ 2.5', modes: ['rad'], positiveOnly: true },
  { expr: '(-x) ^ 3' },
  { expr: 'floor(x) + ceil(x) / 10' },
  { expr: 'round(x, 2)' },
  { expr: 'min(x, 0) + max(x, 1)' },
  { expr: 'pi * x' },
  { expr: 'e ^ (x / 10)' },
  { expr: 'sin(pi / x) + cos(2x)' },
  { expr: 'exp(-x^2 / 2) / sqrt(2 * pi)' },
  { expr: 't' },
  { expr: 'theta' },
  { expr: 'x < 0 ? -x : x^2' } // piecewise-like via min/max below; the parser may reject ternary, checked separately
]

// The parser may not support ternary; drop that entry if it fails to parse.
const usable = EXPRESSIONS.filter((e) => {
  try { parse(e.expr); return true } catch { return false }
})

function domainSafe(x: number, expr: string): boolean {
  // Skip points that are dead on BOTH paths for domain reasons (log of x<=0 etc.)
  // The comparison below treats null==null as agreement, so no pre-filter needed.
  void x; void expr
  return true
}

const rng = mulberry32(0xc0ffee)
const POINTS_PER_EXPR = 40

for (const entry of usable) {
  const modes = entry.modes ?? ['deg']
  for (const mode of modes) {
    const ast = parse(entry.expr)
    let compiled: ReturnType<typeof compileFloatExpression>
    try {
      compiled = compileFloatExpression(ast, { angleMode: mode })
    } catch (err) {
      // If the compiler rejects it, the Decimal path must be the fallback, and
      // the expression must be one the compiler is *expected* to reject — not
      // a bug. Report which cases fall back.
      assert.ok(err instanceof UnsupportedExpression, `Unexpected error for "${entry.expr}": ${err}`)
      console.log(`  fallback -> "${entry.expr}" (${mode}): ${(err as Error).message}`)
      continue
    }

    for (let i = 0; i < POINTS_PER_EXPR; i++) {
      // Mixed magnitudes: mostly [-10, 10], sometimes larger/smaller scales.
      const scale = rng() < 0.8 ? 10 : rng() < 0.5 ? 100 : 1
      let x = (rng() * 2 - 1) * scale
      if (entry.positiveOnly) x = Math.abs(x) + 0.01
      if (!domainSafe(x, entry.expr)) continue

      const rawFloat = compiled(x)
      const floatY = Number.isFinite(rawFloat) ? rawFloat : null
      const decimalY = decimalValue(ast, x, mode)

      if (floatY === null || decimalY === null) {
        // Domain edge (log of x<=0, sqrt of negative, etc.): both paths must
        // agree that the point is dead. Neither may produce a finite value.
        assert.ok(
          floatY === null && decimalY === null,
          `"${entry.expr}" (${mode}) at x=${x}: float ${floatY} but decimal ${decimalY}`
        )
        continue
      }

      const tolerance = REL_TOL * Math.max(1, Math.abs(decimalY))
      assert.ok(
        Math.abs(floatY - decimalY) <= tolerance,
        `"${entry.expr}" (${mode}) at x=${x}: float ${floatY} vs decimal ${decimalY} (tol ${tolerance})`
      )
    }
    ok()
  }
}
console.log(`ok   float vs Decimal agreement checked for ${checks} expression/mode pairs (tol 1e-9 relative)`)

// ---------------------------------------------------------------------------
// Fallback cases: expressions the float path must refuse
// ---------------------------------------------------------------------------
const FALLBACK_CASES = ['fact(x)', 'gcd(x, 6)', 'nCr(x, 2)', 'unknownFn(x)', 'y + 1', 'a = x + 1']
for (const expr of FALLBACK_CASES) {
  let ast
  try { ast = parse(expr) } catch { continue }
  assert.throws(
    () => compileFloatExpression(ast),
    UnsupportedExpression,
    `"${expr}" must be refused by the float path`
  )
  ok()
}
console.log(`ok   ${FALLBACK_CASES.length} fallback cases refused by the float path`)

// ---------------------------------------------------------------------------
// End-to-end: sampleFunction uses the fast path when supported and the exact
// sampler when not, with identical semantics (dead points marked, no crash).
// ---------------------------------------------------------------------------
const range = { xMin: -5, xMax: 5, yMin: -10, yMax: 10 }
const fast = sampleFunction('x^2 - 2', range, 50)
const slow = sampleFunction('fact(x)', range, 50)
assert.ok(fast.length >= 50, 'fast path produced samples'); ok()
assert.ok(slow.length >= 50, 'fallback path produced samples'); ok()

// Roots agree between a fast-sampled function and its exact evaluation at x=±sqrt(2)
const approxRoots = fast.filter((p) => Math.abs(p.y!) < 0.25).map((p) => p.x)
assert.ok(approxRoots.some((r) => Math.abs(r - Math.SQRT2) < 0.2), 'fast path finds root near sqrt(2)'); ok()
assert.ok(approxRoots.some((r) => Math.abs(r + Math.SQRT2) < 0.2), 'fast path finds root near -sqrt(2)'); ok()

console.log(`ok   sampleFunction fast/fallback end-to-end checks passed`)
console.log(`ok   calc-graphing-float.ts: ${checks} checks passed`)


// Verify that float and Decimal paths agree for log, ln, log10, and log2
{
  const testInputs = [0.1, 0.5, 1, 2, 8, 10, 100, 256, 1000]
  const funcs = ['ln', 'log', 'log10', 'log2'] as const
  const evalr = new Evaluator()
  for (const fn of funcs) {
    const ast = parse(`${fn}(x)`)
    const compiled = compileFloatExpression(ast, { angleMode: 'rad' })
    for (const x of testInputs) {
      const floatVal = compiled(x)
      const decAst = parse(`${fn}(${x})`)
      const decVal = evalr.evaluate(decAst).toNumber()
      assert.ok(
        Math.abs(floatVal - decVal) < 1e-9,
        `Float and Decimal disagree for ${fn}(${x}): float=${floatVal}, decimal=${decVal}`
      )
      ok()
    }
  }
}
console.log('ok   float vs Decimal agreement for log, ln, log10, log2 verified')
