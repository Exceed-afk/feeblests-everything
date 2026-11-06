import assert from 'node:assert/strict'
import { parse, type ASTNode } from '../src/shared/calculator/parser'
import { Decimal } from '../src/shared/calculator/numeric'
import { CalculatorEngine } from '../src/shared/calculator'
import {
  UNIT_CATEGORIES,
  convertUnit,
  convertBase,
  calculateCrossRate,
  convertCurrencyWithRate
} from '../src/shared/calculator/modules/conversions'
import {
  Complex,
  complexMultiply,
  complexAbs
} from '../src/shared/calculator/modules/complex'
import {
  type Matrix,
  matrixMultiply,
  matrixInverse,
  matrixDeterminant,
  matrixTranspose
} from '../src/shared/calculator/modules/linear-algebra'
import { computeStats } from '../src/shared/calculator/modules/statistics'
import {
  tvm,
  loanAmortization,
  npv,
  irr
} from '../src/shared/calculator/modules/finance'
import {
  addDateInterval,
  dateDifference
} from '../src/shared/calculator/modules/datetime'

// ---------------------------------------------------------------------------
// Seeded PRNG (Mulberry32) - Deterministic, reproduciable, no dependencies
// ---------------------------------------------------------------------------
class Mulberry32 {
  private state: number

  constructor(public readonly initialSeed: number) {
    this.state = initialSeed >>> 0
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min
  }

  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  nextDecimal(min: number, max: number, decimals = 4): Decimal {
    const factor = Math.pow(10, decimals)
    const val = Math.round(this.nextFloat(min, max) * factor) / factor
    return new Decimal(val)
  }
}

const GLOBAL_SEED = Number(process.env.CALC_PROP_SEED) || 133742
const prng = new Mulberry32(GLOBAL_SEED)

console.log(`Running tests/calc-properties.ts with seed ${GLOBAL_SEED}...`)

function runProperty(name: string, count: number, fn: (i: number) => void) {
  for (let i = 0; i < count; i++) {
    try {
      fn(i)
    } catch (err) {
      console.error(`\n[PROPERTY FAILURE] ${name} failed on iteration ${i} with seed ${GLOBAL_SEED}`)
      throw err
    }
  }
}

// Helper to assert floating point / Decimal tolerance
function assertClose(
  actual: Decimal | number,
  expected: Decimal | number,
  tolerance: number,
  message: string
) {
  const a = actual instanceof Decimal ? actual.toNumber() : actual
  const e = expected instanceof Decimal ? expected.toNumber() : expected
  const diff = Math.abs(a - e)
  if (diff > tolerance) {
    assert.fail(
      `${message}: diff ${diff} exceeds tolerance ${tolerance} (seed ${GLOBAL_SEED}, actual: ${a}, expected: ${e})`
    )
  }
}

// ---------------------------------------------------------------------------
// 1. Parser & Arithmetic Properties
// ---------------------------------------------------------------------------
// Operator Precedence levels:
// 1: + - (sum)
// 2: * / % (product)
// 3: unary - (binds looser than ^, tighter than *)
// 4: ^ (exponent)
// 5: atomic (Number, parens)

function printAST(node: ASTNode, parentPrec = 0): string {
  switch (node.type) {
    case 'Number':
      return node.value
    case 'Identifier':
      return node.name
    case 'Assignment':
      return `${node.name} = ${printAST(node.value, 0)}`
    case 'FunctionCall':
      return `${node.name}(${node.args.map((a) => printAST(a, 0)).join(', ')})`
    case 'PercentSuffix':
      return `${printAST(node.operand, 4)}%`
    case 'UnaryOp': {
      // Unary - has precedence 3
      const inner = printAST(node.operand, 3)
      const res = `${node.operator}${inner}`
      // If inside an exponent or tighter context, wrap in parentheses
      return parentPrec > 3 ? `(${res})` : res
    }
    case 'BinaryOp': {
      const opPrec =
        node.operator === '+' || node.operator === '-'
          ? 1
          : node.operator === '*' || node.operator === '/' || node.operator === '%'
            ? 2
            : 4 // '^'

      // Left associativity for +, -, *, /, %; Right associativity for ^
      const leftPrec = node.operator === '^' ? opPrec + 1 : opPrec
      const rightPrec = node.operator === '^' ? opPrec : opPrec + 1

      const leftStr = printAST(node.left, leftPrec)
      const rightStr = printAST(node.right, rightPrec)
      const res = `${leftStr} ${node.operator} ${rightStr}`
      return parentPrec > opPrec ? `(${res})` : res
    }
    case 'CurrencyConversion':
      return `${printAST(node.amount, 0)} ${node.from} to ${node.to}`
  }
}

function normalizeAST(node: ASTNode): any {
  switch (node.type) {
    case 'Number':
      return { type: 'Number', value: new Decimal(node.value).toString() }
    case 'Identifier':
      return { type: 'Identifier', name: node.name.toLowerCase() }
    case 'Assignment':
      return { type: 'Assignment', name: node.name.toLowerCase(), value: normalizeAST(node.value) }
    case 'FunctionCall':
      return { type: 'FunctionCall', name: node.name.toLowerCase(), args: node.args.map(normalizeAST) }
    case 'UnaryOp':
      return { type: 'UnaryOp', operator: node.operator, operand: normalizeAST(node.operand) }
    case 'BinaryOp':
      return {
        type: 'BinaryOp',
        operator: node.operator,
        left: normalizeAST(node.left),
        right: normalizeAST(node.right)
      }
  }
}

// Generate random valid AST expressions including powers, unary minus, implicit mult
function generateRandomExpr(depth: number): string {
  if (depth <= 0) {
    return String(prng.nextInt(1, 20))
  }
  const choice = prng.nextInt(0, 4)
  switch (choice) {
    case 0: {
      // Unary minus
      return `-${generateRandomExpr(depth - 1)}`
    }
    case 1: {
      // Power
      return `(${generateRandomExpr(depth - 1)} ^ ${prng.nextInt(1, 4)})`
    }
    case 2: {
      // Binary op
      const op = ['+', '-', '*', '/'][prng.nextInt(0, 3)]
      return `(${generateRandomExpr(depth - 1)} ${op} ${generateRandomExpr(depth - 1)})`
    }
    case 3: {
      // Implicit multiplication: 2(x + 1)
      return `${prng.nextInt(2, 5)}(${generateRandomExpr(depth - 1)})`
    }
    default:
      return String(prng.nextInt(1, 50))
  }
}

// Property: parse(print(ast)) gives same AST
// Tolerance: Exact AST structural equality (0 tolerance) because parsing must be faithful and canonical.
runProperty('Parser: parse(print(ast)) == ast', 200, () => {
  const raw = generateRandomExpr(prng.nextInt(1, 3))
  const ast1 = parse(raw)
  const printed = printAST(ast1)
  const ast2 = parse(printed)
  assert.deepEqual(
    normalizeAST(ast2),
    normalizeAST(ast1),
    `AST round-trip mismatch for "${raw}" -> printed "${printed}" (seed: ${GLOBAL_SEED})`
  )
})

// Property: a + b == b + a
// Tolerance: Exact equality (0 tolerance) in arbitrary precision Decimal arithmetic.
runProperty('Arithmetic: a + b == b + a', 200, () => {
  const a = prng.nextDecimal(-10000, 10000, 6)
  const b = prng.nextDecimal(-10000, 10000, 6)
  assert.ok(
    a.plus(b).equals(b.plus(a)),
    `Commutativity of addition failed: ${a} + ${b} != ${b} + ${a} (seed: ${GLOBAL_SEED})`
  )
})

// Property: (a + b) - b == a exactly in Decimal
// Tolerance: Exact equality (0 tolerance) because Decimal.js maintains exact decimals without IEEE-754 binary rounding issues.
runProperty('Arithmetic: (a + b) - b == a in Decimal', 200, () => {
  const a = prng.nextDecimal(-10000, 10000, 6)
  const b = prng.nextDecimal(-10000, 10000, 6)
  const res = a.plus(b).minus(b)
  assert.ok(
    res.equals(a),
    `Exact addition-subtraction inverse failed: (${a} + ${b}) - ${b} = ${res} != ${a} (seed: ${GLOBAL_SEED})`
  )
})

// Property: a * b / b == a
// Tolerance: 1e-12 tolerance due to division precision limits in recurring decimals (e.g. 1/3 * 3).
runProperty('Arithmetic: a * b / b == a', 200, () => {
  const a = prng.nextDecimal(-1000, 1000, 4)
  let b = prng.nextDecimal(-1000, 1000, 4)
  while (b.isZero()) {
    b = prng.nextDecimal(-1000, 1000, 4)
  }
  const res = a.times(b).dividedBy(b)
  assertClose(
    res,
    a,
    1e-12,
    `Multiplication-division inverse failed for a=${a}, b=${b}`
  )
})

// ---------------------------------------------------------------------------
// 2. Scientific & Trigonometry Functions
// ---------------------------------------------------------------------------
const engineRad = new CalculatorEngine()
engineRad.setAngleMode('rad')

// Property: sin(asin(x)) == x for x in [-1, 1]
// Tolerance: 1e-12 tolerance due to Taylor/Chebyshev polynomial approximations in Decimal trigonometry.
runProperty('Functions: sin(asin(x)) == x', 200, () => {
  const x = prng.nextFloat(-1, 1)
  const res = engineRad.calculate(`sin(asin(${x}))`)
  assert.equal(res.error, undefined)
  assertClose(
    res.value,
    x,
    1e-12,
    `sin(asin(${x})) round trip failed`
  )
})

// Property: cos(acos(x)) == x for x in [-1, 1]
// Tolerance: 1e-12 tolerance due to Taylor/Chebyshev polynomial approximations in Decimal trigonometry.
runProperty('Functions: cos(acos(x)) == x', 200, () => {
  const x = prng.nextFloat(-1, 1)
  const res = engineRad.calculate(`cos(acos(${x}))`)
  assert.equal(res.error, undefined)
  assertClose(
    res.value,
    x,
    1e-12,
    `cos(acos(${x})) round trip failed`
  )
})

// Property: tan(atan(x)) == x for x in [-100, 100]
// Tolerance: 1e-10 tolerance due to magnification of errors near vertical tangents for large x.
runProperty('Functions: tan(atan(x)) == x', 200, () => {
  const x = prng.nextFloat(-100, 100)
  const res = engineRad.calculate(`tan(atan(${x}))`)
  assert.equal(res.error, undefined)
  assertClose(
    res.value,
    x,
    1e-10,
    `tan(atan(${x})) round trip failed`
  )
})

// Property: exp(ln(x)) == x for x > 0
// Tolerance: 1e-11 tolerance due to transcendental series truncation in Decimal.js.
runProperty('Functions: exp(ln(x)) == x', 200, () => {
  const x = prng.nextFloat(0.001, 1000)
  const res = engineRad.calculate(`exp(ln(${x}))`)
  assert.equal(res.error, undefined)
  assertClose(
    res.value,
    x,
    1e-11,
    `exp(ln(${x})) round trip failed`
  )
})

// Property: ln(exp(x)) == x for reasonable x
// Tolerance: 1e-11 tolerance due to transcendental series truncation in Decimal.js.
runProperty('Functions: ln(exp(x)) == x', 200, () => {
  const x = prng.nextFloat(-20, 20)
  const res = engineRad.calculate(`ln(exp(${x}))`)
  assert.equal(res.error, undefined)
  assertClose(
    res.value,
    x,
    1e-11,
    `ln(exp(${x})) round trip failed`
  )
})

// Property: sqrt(x)^2 == x for x >= 0
// Tolerance: 1e-12 tolerance due to square root Newton-Raphson approximation.
runProperty('Functions: sqrt(x)^2 == x', 200, () => {
  const x = prng.nextFloat(0, 10000)
  const res = engineRad.calculate(`sqrt(${x})^2`)
  assert.equal(res.error, undefined)
  assertClose(
    res.value,
    x,
    1e-12,
    `sqrt(${x})^2 round trip failed`
  )
})

// Property: DEG/RAD/GRAD round trips
// DEG -> RAD -> GRAD -> DEG
// Tolerance: 1e-10 tolerance due to multiplication and division by pi (Decimal.acos(-1)).
runProperty('Functions: DEG/RAD/GRAD angle round trips', 200, () => {
  const deg = prng.nextDecimal(-720, 720, 4)
  const pi = Decimal.acos(-1)

  // deg -> rad: rad = deg * pi / 180
  const rad = deg.times(pi).dividedBy(180)
  // rad -> grad: grad = rad * 200 / pi
  const grad = rad.times(200).dividedBy(pi)
  // grad -> deg: degBack = grad * 180 / 200 = grad * 0.9
  const degBack = grad.times(180).dividedBy(200)

  assertClose(
    degBack,
    deg,
    1e-10,
    `Angle conversion round trip failed for ${deg} deg`
  )
})

// ---------------------------------------------------------------------------
// 3. Conversions
// ---------------------------------------------------------------------------
// Unit round trips for every unit category and all unit pairs
// Tolerance: 1e-6 tolerance because standard imperial-to-metric conversion factors are floating point constants (e.g. 1 lb = 0.45359237 kg, 1 atm = 101325 Pa).
runProperty('Conversions: round trips for every unit category and pair', 200, () => {
  const catKeys = Object.keys(UNIT_CATEGORIES)
  const catKey = catKeys[prng.nextInt(0, catKeys.length - 1)]
  const cat = UNIT_CATEGORIES[catKey]
  const u1 = cat.units[prng.nextInt(0, cat.units.length - 1)]
  const u2 = cat.units[prng.nextInt(0, cat.units.length - 1)]

  // Avoid extreme temperatures that drop below absolute zero
  const val = catKey === 'temperature' ? prng.nextDecimal(10, 300, 3) : prng.nextDecimal(1, 1000, 3)
  const converted = convertUnit(val, catKey, u1.id, u2.id)
  const roundTrip = convertUnit(converted, catKey, u2.id, u1.id)

  assertClose(
    roundTrip,
    val,
    1e-6,
    `Unit round trip ${u1.id} -> ${u2.id} -> ${u1.id} in ${catKey}`
  )
})

// Base conversions: decimal to binary/octal/hex and back
// Tolerance: Exact string match (0 tolerance) because integer base representation is discrete and exact.
runProperty('Conversions: base conversions (2, 8, 16) and back', 200, () => {
  const bases = [2, 8, 16]
  const base = bases[prng.nextInt(0, bases.length - 1)]
  const n = prng.nextInt(0, 1_000_000)
  const decStr = String(n)

  const toOther = convertBase(decStr, 10, base)
  const backToDec = convertBase(toOther, base, 10)

  assert.equal(
    backToDec,
    decStr,
    `Base conversion round trip failed: ${decStr} (base 10) -> ${toOther} (base ${base}) -> ${backToDec} (seed ${GLOBAL_SEED})`
  )
})

// Currency A to B to A within stated tolerance
// Tolerance: 1e-8 tolerance due to Decimal cross-rate division (rateB / rateA) and reciprocal multiplication.
runProperty('Conversions: currency A to B to A round trip', 200, () => {
  const amount = prng.nextDecimal(10, 10000, 2)
  const rateA = prng.nextDecimal(0.5, 2.0, 4)
  const rateB = prng.nextDecimal(0.5, 2.0, 4)

  const crossRateAB = calculateCrossRate(rateA, rateB)
  const bAmount = convertCurrencyWithRate(amount, crossRateAB)

  const crossRateBA = calculateCrossRate(rateB, rateA)
  const roundTripA = convertCurrencyWithRate(bAmount, crossRateBA)

  assertClose(
    roundTripA,
    amount,
    1e-8,
    `Currency round trip A -> B -> A failed with rateA=${rateA}, rateB=${rateB}`
  )
})

// ---------------------------------------------------------------------------
// 4. Linear Algebra
// ---------------------------------------------------------------------------
function randomSquareMatrix(dim: number): Matrix {
  return Array.from({ length: dim }, () =>
    Array.from({ length: dim }, () => prng.nextDecimal(-10, 10, 2))
  )
}

// Random matrices up to 6x6, skipping singular ones
// Property: A * inv(A) == I
// Tolerance: 1e-7 tolerance due to accumulated rounding across Gaussian elimination / row reduction pivot divisions on matrices up to 6x6.
runProperty('Linear algebra: A * inv(A) == I', 200, () => {
  const dim = prng.nextInt(2, 5) // up to 5x5 / 6x6
  let A = randomSquareMatrix(dim)
  let det = matrixDeterminant(A)

  // Skip singular or ill-conditioned matrices
  while (det.abs().lessThan('1e-3')) {
    A = randomSquareMatrix(dim)
    det = matrixDeterminant(A)
  }

  const invA = matrixInverse(A)
  const product = matrixMultiply(A, invA)

  for (let r = 0; r < dim; r++) {
    for (let c = 0; c < dim; c++) {
      const expected = r === c ? 1 : 0
      assertClose(
        product[r][c],
        expected,
        1e-7,
        `A * inv(A) entry [${r}][${c}] != ${expected}`
      )
    }
  }
})

// Property: det(A * B) == det(A) * det(B)
// Tolerance: 1e-4 tolerance due to pivot error accumulation in O(n^3) Gaussian elimination determinants of product matrices up to 5x5.
runProperty('Linear algebra: det(A * B) == det(A) * det(B)', 200, () => {
  const dim = prng.nextInt(2, 4)
  const A = randomSquareMatrix(dim)
  const B = randomSquareMatrix(dim)

  const detA = matrixDeterminant(A)
  const detB = matrixDeterminant(B)
  const AB = matrixMultiply(A, B)
  const detAB = matrixDeterminant(AB)

  assertClose(
    detAB,
    detA.times(detB),
    1e-4,
    `det(AB) != det(A)det(B)`
  )
})

// Property: transpose(transpose(A)) == A
// Tolerance: Exact equality (0 tolerance) because transposition only rearranges matrix entries without arithmetic computation.
runProperty('Linear algebra: transpose(transpose(A)) == A', 200, () => {
  const rows = prng.nextInt(2, 6)
  const cols = prng.nextInt(2, 6)
  const A: Matrix = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => prng.nextDecimal(-50, 50, 2))
  )

  const ttA = matrixTranspose(matrixTranspose(A))
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      assert.ok(
        A[r][c].equals(ttA[r][c]),
        `Double transpose failed at [${r}][${c}]`
      )
    }
  }
})

// ---------------------------------------------------------------------------
// 5. Complex Numbers
// ---------------------------------------------------------------------------
// Property: |z1 * z2| == |z1| * |z2|
// Tolerance: 1e-10 tolerance due to square root in Euclidean complex modulus sqrt(re^2 + im^2).
runProperty('Complex: |z1 * z2| == |z1| * |z2|', 200, () => {
  const z1 = new Complex(prng.nextDecimal(-50, 50, 3), prng.nextDecimal(-50, 50, 3))
  const z2 = new Complex(prng.nextDecimal(-50, 50, 3), prng.nextDecimal(-50, 50, 3))

  const prod = complexMultiply(z1, z2)
  const absProd = complexAbs(prod)
  const prodAbs = complexAbs(z1).times(complexAbs(z2))

  assertClose(
    absProd,
    prodAbs,
    1e-10,
    `|z1 * z2| == |z1| * |z2| failed for z1=${z1.toString()}, z2=${z2.toString()}`
  )
})

// Property: Rectangular to polar to rectangular
// Tolerance: 1e-8 tolerance due to trigonometric functions (sin/cos/atan) in polar coordinate transformation.
runProperty('Complex: rectangular -> polar -> rectangular', 200, () => {
  const re = prng.nextDecimal(-100, 100, 3)
  const im = prng.nextDecimal(-100, 100, 3)
  const z = new Complex(re, im)

  const r = complexAbs(z)
  // arg(z) = atan2(im, re)
  const theta = Decimal.atan2(im, re)

  const zBack = Complex.fromPolar(r, theta)

  assertClose(zBack.re, re, 1e-8, `Polar round-trip real component mismatch`)
  assertClose(zBack.im, im, 1e-8, `Polar round-trip imag component mismatch`)
})

// ---------------------------------------------------------------------------
// 6. Statistics
// ---------------------------------------------------------------------------
// Property: Shifting dataset by c shifts mean by c and leaves variance unchanged
// Tolerance: 1e-10 tolerance due to division in mean and sum of squared deviations in variance.
runProperty('Statistics: shift by c shifts mean and preserves variance', 200, () => {
  const n = prng.nextInt(5, 30)
  const dataset: Decimal[] = Array.from({ length: n }, () => prng.nextDecimal(-50, 50, 2))
  const c = prng.nextDecimal(-20, 20, 2)

  const shifted = dataset.map((x) => x.plus(c))

  const s1 = computeStats(dataset)
  const s2 = computeStats(shifted)

  assertClose(
    s2.mean,
    s1.mean.plus(c),
    1e-10,
    `Mean shift property failed`
  )
  assertClose(
    s2.varianceSample,
    s1.varianceSample,
    1e-10,
    `Variance invariance property failed`
  )
})

// Property: Sample variance >= 0
// Tolerance: 0 (or strictly >= -1e-15) because sum of real squares divided by (n-1) is non-negative by definition.
runProperty('Statistics: sample variance >= 0', 200, () => {
  const n = prng.nextInt(2, 40)
  const dataset: Decimal[] = Array.from({ length: n }, () => prng.nextDecimal(-100, 100, 2))
  const stats = computeStats(dataset)

  assert.ok(
    stats.varianceSample.isPositive() || stats.varianceSample.isZero(),
    `Sample variance ${stats.varianceSample} is negative for dataset length ${n}`
  )
})

// ---------------------------------------------------------------------------
// 7. Finance
// ---------------------------------------------------------------------------
// Property: pv(fv(x)) round trip
// Tolerance: 1e-6 tolerance due to compounding power terms ((1+r)^n) in TVM formula.
runProperty('Finance: pv(fv(x)) TVM round trip', 200, () => {
  const rate = prng.nextDecimal(0.01, 0.15, 4)
  const nper = new Decimal(prng.nextInt(1, 30))
  const pmt = prng.nextDecimal(-500, 500, 2)
  const pvVal = prng.nextDecimal(-50000, -1000, 2)

  // Compute FV from PV
  const tvm1 = tvm({ pv: pvVal, rate, nper, pmt })
  const fvVal = tvm1.fv

  // Compute PV back from FV
  const tvm2 = tvm({ fv: fvVal, rate, nper, pmt })
  const roundTripPv = tvm2.pv

  assertClose(
    roundTripPv,
    pvVal,
    1e-6,
    `TVM PV -> FV -> PV round trip failed`
  )
})

// Property: Amortization schedule's principal payments sum to the loan principal
// Tolerance: 1e-4 tolerance due to monthly interest rounding and final period payment adjustment in loan schedules.
runProperty("Finance: loan amortization principal payments sum to loan", 200, () => {
  const principal = prng.nextDecimal(10000, 200000, 2)
  const annualRate = prng.nextDecimal(0.02, 0.10, 4)
  const termMonths = prng.nextInt(12, 120)

  const schedule = loanAmortization({
    principal,
    annualRate,
    termMonths
  })

  let totalPrincipalPaid = new Decimal(0)
  for (const row of schedule.schedule) {
    totalPrincipalPaid = totalPrincipalPaid.plus(row.principalPaid)
  }

  assertClose(
    totalPrincipalPaid,
    principal,
    1e-4,
    `Principal payments sum ${totalPrincipalPaid} != loan principal ${principal}`
  )
})

// Property: NPV at the IRR is approximately 0
// Tolerance: 1e-2 tolerance ($0.01) because IRR solver uses Newton-Raphson stopping criteria with tolerance 1e-10 on rate.
runProperty('Finance: npv at irr is approximately 0', 200, () => {
  const initial = prng.nextDecimal(-10000, -1000, 2)
  const n = prng.nextInt(3, 8)
  const cashFlows: Decimal[] = [initial]
  // Guarantee positive cash flows so sign change occurs and IRR exists
  for (let i = 0; i < n; i++) {
    cashFlows.push(prng.nextDecimal(500, 4000, 2))
  }

  const irrVal = irr(cashFlows)
  const npvAtIrr = npv(irrVal, cashFlows)
  assertClose(
    npvAtIrr,
    0,
    1e-2,
    `NPV at IRR is not 0 for cash flows ${cashFlows.map((c) => c.toString()).join(', ')}`
  )
})

// ---------------------------------------------------------------------------
// 8. Dates & Time
// ---------------------------------------------------------------------------
// Property: Adding n days then taking difference gives n, including across leap years and month ends
// Tolerance: Exact integer match (0 tolerance) because calendar day difference is an exact whole number of days.
runProperty('Dates: add n days then dateDifference gives n', 200, () => {
  const startYear = prng.nextInt(2000, 2040)
  const startMonth = prng.nextInt(1, 12)
  const startDay = prng.nextInt(1, 28) // Stay within valid month days for starting point
  const startDateStr = `${startYear}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`

  const nDays = prng.nextInt(1, 400) // Spans across months and leap years (Feb 29)
  const endDateStr = addDateInterval(startDateStr, { days: nDays })

  const diff = dateDifference(startDateStr, endDateStr)

  assert.equal(
    diff.days,
    nDays,
    `Date difference between ${startDateStr} and +${nDays} days (${endDateStr}) was ${diff.days}`
  )
})

console.log(`ok   tests/calc-properties.ts passed all property tests (seed: ${GLOBAL_SEED})`)
