// Regression tests for the hardening pass (docs/calculator-build-plan.md sections 11 and 12).
//
// Every case below once either hung, took over a second, or died on a raw JS error.
// Each one is now either fast or rejected with a message that names the limit, and every
// case carries a time assertion so a future change cannot quietly bring the hang back.

import assert from 'node:assert/strict'
import {
  CalculatorEngine,
  parse,
  evaluate,
  CALC_LIMITS,
  CalcError,
  ParserError,
  EvaluationError
} from '../src/shared/calculator'
import { computeStats, percentile, linearRegression, tTestOneSample } from '../src/shared/calculator/modules/statistics'
import { matrixDeterminant, matrixInverse, polynomialRootsReal } from '../src/shared/calculator/modules/linear-algebra'
import { executeScript } from '../src/shared/calculator/modules/scripting'
import { sampleFunction } from '../src/shared/calculator/modules/graphing'
import { casSimplify } from '../src/shared/calculator/modules/cas'
import { Decimal } from '../src/shared/calculator/numeric'

let checks = 0
const ok = () => { checks++ }

const REAL_ALLOWANCE_MS = 1000

/**
 * Runs fn and asserts it settles inside `limitMs`. Returns the error it threw, if any.
 * Anything thrown must be a CalcError: a raw TypeError / RangeError here is a test failure.
 */
function timed(label: string, fn: () => unknown, limitMs = REAL_ALLOWANCE_MS): unknown {
  const start = performance.now()
  let thrown: unknown = undefined
  try {
    fn()
  } catch (err) {
    thrown = err
  }
  const ms = performance.now() - start
  assert.ok(ms < limitMs, `${label} took ${ms.toFixed(0)} ms (limit ${limitMs} ms)`)
  if (thrown !== undefined) {
    assert.ok(thrown instanceof CalcError, `${label} threw a non-CalcError: ${thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown)}`)
  }
  ok()
  return thrown
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : ''
}

// ---------------------------------------------------------------------------
// 1. Pathological expressions: rejected from the numbers, never computed
// ---------------------------------------------------------------------------

const engine = new CalculatorEngine()

const powerCases: Array<[string, RegExp]> = [
  ['9^9^9^9', /number magnitude/i],
  ['10^999999999', /number magnitude/i],
  ['1e999999999', /number magnitude/i],
  ['2^(2^40)', /number magnitude/i]
]

for (const [expr, expected] of powerCases) {
  const err = timed(expr, () => {
    const r = engine.calculate(expr)
    if (r.error) throw new CalcError(r.error)
    throw new Error(`${expr} should have been rejected, got ${r.formatted}`)
  }, 50)
  assert.match(messageOf(err), expected, `${expr} message should name the magnitude limit, got "${messageOf(err)}"`)
}

// Factorial / combinatorics: named limits, before any loop starts
for (const [expr, expected] of [
  ['fact(1000000)', /Factorial is limited to 9,999/],
  ['nCr(1000000,500000)', /nCr\(1000000, 500000\) has about 301,027 digits/]
] as Array<[string, RegExp]>) {
  const err = timed(expr, () => {
    const r = engine.calculate(expr)
    if (r.error) throw new CalcError(r.error)
    throw new Error(`${expr} should have been rejected`)
  }, 50)
  assert.match(messageOf(err), expected)
}

// Trigonometry of a huge angle: over the magnitude cap, so rejected (a finite angle is still fine)
{
  const err = timed('sin(1e100000)', () => {
    const r = engine.calculate('sin(1e100000)')
    if (r.error) throw new CalcError(r.error)
  }, 50)
  assert.match(messageOf(err), /number magnitude/i)
  const normal = engine.calculate('sin(30)')
  assert.equal(normal.error, undefined)
  ok()
}

// Legal-but-large magnitudes still evaluate quickly
{
  const r = timed('10^99999', () => engine.calculate('10^99999').formatted)
  assert.ok(String(r ?? '').length >= 0)
  const res = engine.calculate('10^99999')
  assert.equal(res.error, undefined)
  ok()
}

// ---------------------------------------------------------------------------
// 2. Nesting: a counted limit, never a stack overflow
// ---------------------------------------------------------------------------

const deepParens = `${'('.repeat(5000)}1${')'.repeat(5000)}`
{
  const err = timed('5,000 nested parentheses', () => parse(deepParens), 100)
  assert.ok(err instanceof ParserError, 'deep nesting must be a positioned parser error')
  assert.match(messageOf(err), /nesting depth is limited to 200/)
  assert.match(messageOf(err), /at position \d+/)
  ok()
}

// Exactly at the limit parses; one past it fails
{
  const atLimit = `${'('.repeat(CALC_LIMITS.nestingDepth - 1)}1${')'.repeat(CALC_LIMITS.nestingDepth - 1)}`
  timed(`exactly ${CALC_LIMITS.nestingDepth} levels`, () => parse(atLimit), 100)
  const element = timed('evaluate an AST built by hand beyond the cap', () => {
    // The evaluator's own guard, independent of the parser.
    let node: any = { type: 'Number', value: '1', pos: 0 }
    for (let i = 0; i < 5000; i++) node = { type: 'UnaryOp', operator: '-', operand: node, pos: 0 }
    evaluate(node)
  }, 200)
  assert.ok(element instanceof EvaluationError)
  ok()
}

// A flat 10,000-term sum is bounded by length, not by nesting, and stays fast
{
  const terms = Math.floor((CALC_LIMITS.expressionLength - 1) / 2)
  const sum = Array.from({ length: terms }, () => '1').join('+')
  const r = timed('10,000-term flat sum', () => new CalculatorEngine().calculate(sum).formatted)
  void r
  const res = new CalculatorEngine().calculate(sum)
  assert.equal(res.error, undefined, `flat sum should evaluate, got ${res.error}`)
  ok()
}

// Over the length cap is refused by name
{
  const tooLong = '1+'.repeat(CALC_LIMITS.expressionLength)
  const err = timed('expression over the length cap', () => parse(tooLong), 50)
  assert.match(messageOf(err), /expression length is limited to 20,000/)
  ok()
}

// ---------------------------------------------------------------------------
// 3. Heavy but legal data stays inside the time budget
// ---------------------------------------------------------------------------

const big = Array.from({ length: 50_000 }, (_, i) => new Decimal((i % 97) - 40))
timed('statistics on 50,000 values (computeStats)', () => computeStats(big).mean)
timed('statistics on 50,000 values (percentile)', () => percentile(big, 95))
timed('regression on 50,000 values', () => linearRegression(big, big.map((d) => d.times(2))))
timed('t-test on 50,000 values', () => tTestOneSample(big.map((d) => d.toNumber())))
{
  // Over the dataset cap: refused by name, not attempted
  const err = timed('100,001-value dataset', () => computeStats(Array.from({ length: 100_001 }, () => new Decimal(1))), 50)
  assert.match(messageOf(err), /dataset size is limited to 100,000/)
  ok()
}

const makeMatrix = (n: number) =>
  Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => new Decimal(i === j ? n + 1 : 1)))

timed('50x50 determinant', () => matrixDeterminant(makeMatrix(50)))
timed('50x50 inverse', () => matrixInverse(makeMatrix(50)))
{
  const err = timed('200x200 determinant', () => matrixDeterminant(makeMatrix(200)), 50)
  assert.match(messageOf(err), /matrix size is limited to 50/)
  ok()
  const err2 = timed('200x200 inverse', () => matrixInverse(makeMatrix(200)), 50)
  assert.match(messageOf(err2), /matrix size is limited to 50/)
  ok()
}

{
  const err = timed('100-degree polynomial roots', () =>
    polynomialRootsReal(Array.from({ length: 101 }, (_, i) => new Decimal(i + 1))), 50)
  assert.match(messageOf(err), /degree 20/)
  ok()
  timed('degree-20 polynomial roots', () => polynomialRootsReal(Array.from({ length: 21 }, (_, i) => new Decimal(i + 1))))
}

// ---------------------------------------------------------------------------
// 4. Scripts: the step cap cannot be raised by a caller
// ---------------------------------------------------------------------------

{
  const loop = 'i = 0\nwhile i < 1000000 {\ni = i + 1\n}'
  const err = timed('infinite-ish while loop', () => executeScript(loop, { maxSteps: 1e12 }), 800)
  assert.match(messageOf(err), /Step limit exceeded \([0-9,]+ steps\)/)
  ok()
}
{
  const err = timed('script over the length cap', () => executeScript('x = 1\n'.repeat(5000)), 50)
  assert.match(messageOf(err), /script length is limited to 20,000/)
  ok()
}

// ---------------------------------------------------------------------------
// 5. Graph sampling and CAS follow the same caps
// ---------------------------------------------------------------------------

{
  const err = timed('graph with 1,000,000 samples', () =>
    sampleFunction('sin(x)', { xMin: -10, xMax: 10, yMin: -2, yMax: 2 }, 1_000_000), 50)
  assert.match(messageOf(err), /graph sample count is limited to 10,000/)
  ok()
  timed('graph with the maximum samples', () =>
    sampleFunction('sin(x)', { xMin: -10, xMax: 10, yMin: -2, yMax: 2 }, CALC_LIMITS.graphSampleCount))
}
{
  const err = timed('CAS on 5,000 nested parentheses', () => casSimplify(deepParens), 100)
  assert.ok(err instanceof CalcError)
  assert.match(messageOf(err), /nesting depth is limited to 200/)
  ok()
}

// ---------------------------------------------------------------------------
// 6. The limit constants themselves
// ---------------------------------------------------------------------------

assert.equal(CALC_LIMITS.expressionLength, 20_000)
assert.equal(CALC_LIMITS.nestingDepth, 200)
assert.equal(CALC_LIMITS.datasetSize, 100_000)
assert.equal(CALC_LIMITS.matrixDimension, 50)
assert.equal(CALC_LIMITS.scriptLength, 20_000)
assert.equal(CALC_LIMITS.scriptSteps, 100_000)
assert.equal(CALC_LIMITS.scriptRecursionDepth, 100)
assert.equal(CALC_LIMITS.graphSampleCount, 10_000)
assert.equal(CALC_LIMITS.exponentLimit, 100_000)
ok()

console.log(`ok   ${checks} limit and pathological-input regression tests passed`)
