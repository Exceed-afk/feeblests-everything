import assert from 'node:assert/strict'
import { CalculatorEngine, CalcError } from '../src/shared/calculator'
import { parse } from '../src/shared/calculator/parser'
import * as finance from '../src/shared/calculator/modules/finance'
import * as stats from '../src/shared/calculator/modules/statistics'
import * as la from '../src/shared/calculator/modules/linear-algebra'
import * as complex from '../src/shared/calculator/modules/complex'
import * as conversions from '../src/shared/calculator/modules/conversions'
import * as datetime from '../src/shared/calculator/modules/datetime'
import * as scripting from '../src/shared/calculator/modules/scripting'
import * as graphing from '../src/shared/calculator/modules/graphing'
import * as cas from '../src/shared/calculator/modules/cas'
import { Decimal } from '../src/shared/calculator/numeric'

const engine = new CalculatorEngine()

// 1. Extreme Edge Cases (Deep nesting, unbalanced, large/small numbers)
const edgeCases = [
  '',
  ' ',
  '   ',
  '+',
  '-',
  '*',
  '/',
  '^',
  '%',
  '()',
  '((()))',
  '((((((((((((((((((((1))))))))))))))))))))',
  '1 + ()',
  '1 + (2 * )',
  '1 + + + 1',
  '1 - - - 1',
  '1...2',
  '..1',
  '1..',
  '1e',
  '1e+',
  '1e-',
  '1e++2',
  '1e9999999999',
  '1e-9999999999',
  'NaN',
  'Infinity',
  '-Infinity',
  'undefined',
  'null',
  'true',
  'false',
  '0/0',
  '1/0',
  '-1/0',
  '0^0',
  '0^-1',
  '(-1)^0.5',
  '(-2)^3.5',
  '9'.repeat(1000),
  '.'.repeat(100),
  '('.repeat(200) + '1' + ')'.repeat(200),
  '('.repeat(500),
  ')'.repeat(500),
  'x = y = z = 1',
  'sin()',
  'sin(1, 2)',
  'unknownFunction(123)',
  '@@@###$$$%%%',
  '// comment\n1 + 1',
  '\u0000\u0001\u0002\u0003',
  'π * 2',
  'Ans + 1'
]

for (const expr of edgeCases) {
  assert.doesNotThrow(() => {
    engine.calculate(expr)
  }, `Engine crashed on edge case: "${expr.slice(0, 30)}"`)
}

// 2. Random fuzz generator (1,000 iterations)
const fuzzChars = '0123456789.+-*/^%()=abcdefghijklmnopqrstuvwxyz_π  '

function randomFuzzString(len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) {
    const idx = Math.floor(Math.random() * fuzzChars.length)
    s += fuzzChars[idx]
  }
  return s
}

let fuzzed = 0
for (let i = 0; i < 1000; i++) {
  const len = Math.floor(Math.random() * 60) + 1
  const expr = randomFuzzString(len)

  assert.doesNotThrow(() => {
    // Should never throw unhandled error or hang
    engine.calculate(expr)
  }, `Fuzz failure on expression: "${expr}"`)

  fuzzed++
}

console.log(`ok   ${edgeCases.length + fuzzed} parser and evaluator fuzz tests passed without crashing`)

// 3. Module API Boundary Fuzz (Calling all exported functions with garbage inputs)
// Every exported function must validate inputs and throw ONLY CalcError, never raw TypeError / RangeError.
let boundaryCalls = 0
let boundaryThrown = 0

const GARBAGE: unknown[] = [
  undefined,
  null,
  NaN,
  Infinity,
  -Infinity,
  '',
  '   ',
  'abc',
  '1,000',
  '1e',
  '--1',
  true,
  false,
  {},
  { re: 'x' },
  [],
  [1, 'x'],
  [null],
  [[1, 2], [3]],
  () => 1,
  10n
]

const PLAUSIBLE: unknown[] = [0, 1, -1, 2.5, '1', '2.5', new Decimal('3'), [1, 2, 3], [[1, 0], [0, 1]], '2024-01-01', '1d 2h']

function describeArg(a: unknown): string {
  if (typeof a === 'string') return JSON.stringify(a.slice(0, 12))
  if (Array.isArray(a)) return '[]'
  if (a instanceof Decimal) return 'Decimal'
  return String(a)
}

let boundaryFn: unknown = null

function checkBoundary(label: string, args: unknown[]): void {
  boundaryCalls++
  try {
    void (boundaryFn as unknown as (...a: unknown[]) => unknown)(...args)
  } catch (err) {
    boundaryThrown++
    assert.ok(
      err instanceof CalcError,
      `${label}(${args.map((a) => describeArg(a)).join(', ')}) threw ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`
    )
    assert.ok(
      typeof (err as CalcError).message === 'string' && (err as CalcError).message.trim().length > 0,
      `${label} threw a CalcError with no message`
    )
    assert.ok(
      !/is not a function|Cannot read propert|undefined is not|Maximum call stack/i.test((err as CalcError).message),
      `${label} leaked an engine message: ${(err as CalcError).message}`
    )
  }
}

function fuzzAll(label: string, f: (...args: unknown[]) => unknown, arity: number): void {
  boundaryFn = f
  for (const g of GARBAGE) checkBoundary(label, [g, ...Array.from({ length: arity - 1 }, () => 1)])
  for (const p of PLAUSIBLE) {
    for (const g of GARBAGE) checkBoundary(label, [p, g, ...Array.from({ length: arity - 2 }, () => 1)])
  }
}

// Finance boundary
fuzzAll('tvm', finance.tvm as never, 1)
fuzzAll('loanAmortization', finance.loanAmortization as never, 1)
fuzzAll('simpleInterest', finance.simpleInterest as never, 3)
fuzzAll('compoundInterest', finance.compoundInterest as never, 4)
fuzzAll('npv', finance.npv as never, 2)
fuzzAll('irr', finance.irr as never, 1)
fuzzAll('xnpv', finance.xnpv as never, 3)
fuzzAll('xirr', finance.xirr as never, 2)
fuzzAll('paybackPeriod', finance.paybackPeriod as never, 1)
fuzzAll('markup', finance.markup as never, 2)
fuzzAll('margin', finance.margin as never, 2)
fuzzAll('discount', finance.discount as never, 2)
fuzzAll('tax', finance.tax as never, 2)
fuzzAll('tip', finance.tip as never, 3)
fuzzAll('percentChange', finance.percentChange as never, 2)
fuzzAll('positionSize', finance.positionSize as never, 1)

// Statistics boundary
fuzzAll('parseDataset', stats.parseDataset as never, 1)
fuzzAll('computeStats', stats.computeStats as never, 1)
fuzzAll('percentile', stats.percentile as never, 2)
fuzzAll('linearRegression', stats.linearRegression as never, 2)
fuzzAll('logarithmicRegression', stats.logarithmicRegression as never, 2)
fuzzAll('exponentialRegression', stats.exponentialRegression as never, 2)
fuzzAll('powerRegression', stats.powerRegression as never, 2)
fuzzAll('gammaLn', stats.gammaLn as never, 1)
fuzzAll('gammaFn', stats.gammaFn as never, 1)
fuzzAll('incompleteBeta', stats.incompleteBeta as never, 3)
fuzzAll('tTestOneSample', stats.tTestOneSample as never, 2)
fuzzAll('tTestTwoSample', stats.tTestTwoSample as never, 3)
fuzzAll('zTestOneSample', stats.zTestOneSample as never, 3)

for (const [name, dist] of Object.entries({
  normal: stats.normal,
  binomial: stats.binomial,
  poisson: stats.poisson,
  studentT: stats.studentT,
  chiSquare: stats.chiSquare,
  uniform: stats.uniform
})) {
  for (const method of ['pdf', 'cdf', 'inv'] as const) {
    fuzzAll(`${name}.${method}`, (dist as unknown as Record<string, (...a: unknown[]) => unknown>)[method], 3)
  }
}

// Linear Algebra boundary
fuzzAll('createMatrix', la.createMatrix as never, 2)
fuzzAll('matrixAdd', la.matrixAdd as never, 2)
fuzzAll('matrixSub', la.matrixSub as never, 2)
fuzzAll('matrixMultiply', la.matrixMultiply as never, 2)
fuzzAll('matrixTranspose', la.matrixTranspose as never, 1)
fuzzAll('matrixDeterminant', la.matrixDeterminant as never, 1)
fuzzAll('matrixInverse', la.matrixInverse as never, 1)
fuzzAll('matrixRREF', la.matrixRREF as never, 1)
fuzzAll('matrixRank', la.matrixRank as never, 1)
fuzzAll('solveLinearSystem', la.solveLinearSystem as never, 2)
fuzzAll('eigenvalues2x2', la.eigenvalues2x2 as never, 1)
fuzzAll('vectorDot', la.vectorDot as never, 2)
fuzzAll('vectorNorm', la.vectorNorm as never, 1)
fuzzAll('vectorCross', la.vectorCross as never, 2)
fuzzAll('vectorAngle', la.vectorAngle as never, 2)
fuzzAll('polynomialRootsReal', la.polynomialRootsReal as never, 1)

// Complex boundary
fuzzAll('complexAdd', complex.complexAdd as never, 2)
fuzzAll('complexSub', complex.complexSub as never, 2)
fuzzAll('complexMultiply', complex.complexMultiply as never, 2)
fuzzAll('complexDivide', complex.complexDivide as never, 2)
fuzzAll('complexAbs', complex.complexAbs as never, 1)
fuzzAll('complexArg', complex.complexArg as never, 1)
fuzzAll('complexSqrt', complex.complexSqrt as never, 1)
fuzzAll('complexPower', complex.complexPower as never, 2)
fuzzAll('complexRoots', complex.complexRoots as never, 2)
boundaryFn = () => new complex.Complex('nope' as never)
for (const g of GARBAGE) checkBoundary('new Complex', [g])

// Conversions boundary
fuzzAll('convertUnit', conversions.convertUnit as never, 4)
fuzzAll('convertBase', conversions.convertBase as never, 3)
fuzzAll('formatBaseWithGrouping', conversions.formatBaseWithGrouping as never, 2)
fuzzAll('convertCurrencyWithRate', conversions.convertCurrencyWithRate as never, 2)
fuzzAll('calculateCrossRate', conversions.calculateCrossRate as never, 2)
fuzzAll('validateCurrencyCode', conversions.validateCurrencyCode as never, 1)
fuzzAll('calculateEffectiveRate', conversions.calculateEffectiveRate as never, 1)
fuzzAll('performCurrencyConversion', conversions.performCurrencyConversion as never, 1)
fuzzAll('exportRateSetToCsv', conversions.exportRateSetToCsv as never, 1)
fuzzAll('exportRateSetToJson', conversions.exportRateSetToJson as never, 3)
fuzzAll('parseAndValidateRatesCsv', conversions.parseAndValidateRatesCsv as never, 1)
fuzzAll('parseAndValidateRatesJson', conversions.parseAndValidateRatesJson as never, 1)
fuzzAll('checkRateStaleness', conversions.checkRateStaleness as never, 3)

// Datetime boundary
fuzzAll('dateDifference', datetime.dateDifference as never, 2)
fuzzAll('addDateInterval', datetime.addDateInterval as never, 2)
fuzzAll('subtractDateInterval', datetime.subtractDateInterval as never, 2)
fuzzAll('calculateAgeDetailed', datetime.calculateAgeDetailed as never, 2)
fuzzAll('businessDaysBetween', datetime.businessDaysBetween as never, 2)
fuzzAll('addBusinessDays', datetime.addBusinessDays as never, 2)
fuzzAll('parseDuration', datetime.parseDuration as never, 1)
fuzzAll('formatDuration', datetime.formatDuration as never, 1)
fuzzAll('durationArithmetic', datetime.durationArithmetic as never, 3)
fuzzAll('timeZoneConvert', datetime.timeZoneConvert as never, 3)

// Scripting, Graphing, CAS boundary
fuzzAll('bitwiseAnd', scripting.bitwiseAnd as never, 2)
fuzzAll('bitwiseOr', scripting.bitwiseOr as never, 2)
fuzzAll('bitwiseXor', scripting.bitwiseXor as never, 2)
fuzzAll('bitwiseNot', scripting.bitwiseNot as never, 2)
fuzzAll('bitwiseShiftLeft', scripting.bitwiseShiftLeft as never, 3)
fuzzAll('bitwiseShiftRight', scripting.bitwiseShiftRight as never, 2)
fuzzAll('formatBinaryWord', scripting.formatBinaryWord as never, 2)
fuzzAll('parseBinaryWord', scripting.parseBinaryWord as never, 1)
fuzzAll('executeScript', scripting.executeScript as never, 2)
fuzzAll('sampleFunction', graphing.sampleFunction as never, 3)
fuzzAll('findRoots', graphing.findRoots as never, 4)
fuzzAll('findExtrema', graphing.findExtrema as never, 4)
fuzzAll('casSimplify', cas.casSimplify as never, 1)
fuzzAll('casDifferentiate', cas.casDifferentiate as never, 2)
fuzzAll('casSubstitute', cas.casSubstitute as never, 3)
fuzzAll('casIntegratePolynomial', cas.casIntegratePolynomial as never, 4)
fuzzAll('casLimitPolynomial', cas.casLimitPolynomial as never, 3)
fuzzAll('casSolveLinear', cas.casSolveLinear as never, 2)
fuzzAll('casTaylorSeries', cas.casTaylorSeries as never, 4)

console.log(`ok   ${boundaryCalls} module API boundary fuzz calls passed (${boundaryThrown} threw CalcError)`)
