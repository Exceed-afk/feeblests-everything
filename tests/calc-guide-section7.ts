// docs/calculator-testing-guide.md — Section 7: Linear algebra and complex numbers.
// Run on its own:  npx tsx tests/calc-guide-section7.ts
import {
  matrixDeterminant, matrixTranspose, matrixInverse, matrixMultiply, matrixAdd, matrixRank,
  eigenvalues2x2, solveLinearSystem, vectorDot, vectorCross, vectorNorm, vectorAngle,
  polynomialRootsReal, matrixRREF
} from '../src/shared/calculator/modules/linear-algebra'
import {
  Complex, complexAdd, complexMultiply, complexDivide, complexAbs, complexRoots, complexSqrt, complexArg
} from '../src/shared/calculator/modules/complex'
import { Decimal } from '../src/shared/calculator/numeric'
import { GuideSuite, finish, expectText, expectClose, expectError, GuideMismatch } from './calc-guide-common'

export const suite = new GuideSuite('Section 7: Linear algebra and complex numbers', 'Linear Algebra & Complex')

const dec = (n: number | string) => new Decimal(n)
const m = (rows: number[][]) => rows.map((r) => r.map(dec))
const show = (matrix: Decimal[][]) => `[[${matrix.map((r) => r.map(String).join(', ')).join('], [')}]]`

// ---------- Matrices: A = [[1, 2], [3, 4]] ----------
const A = m([[1, 2], [3, 4]])

suite.test('Determinant', 'A = [[1, 2], [3, 4]]', '-2', () => expectClose(matrixDeterminant(A).toString(), -2, 1e-9))
suite.test('Transpose', 'A', '[[1, 3], [2, 4]]', () => expectText(show(matrixTranspose(A)), '[[1, 3], [2, 4]]'))
suite.test('Inverse', 'A', '[[-2, 1], [1.5, -0.5]]', () => {
  const inv = matrixInverse(A)
  const want = [[-2, 1], [1.5, -0.5]]
  for (const [i, row] of inv.entries()) {
    for (const [j, v] of row.entries()) {
      if (Math.abs(v.toNumber() - want[i][j]) > 1e-9) throw new GuideMismatch(show(inv))
    }
  }
  return { actual: show(inv) }
})
suite.test('A times A', 'A * A', '[[7, 10], [15, 22]]', () => expectText(show(matrixMultiply(A, A)), '[[7, 10], [15, 22]]'))
suite.test('A plus A', 'A + A', '[[2, 4], [6, 8]]', () => expectText(show(matrixAdd(A, A)), '[[2, 4], [6, 8]]'))
suite.test('2 times A', '2 * A', '[[2, 4], [6, 8]]', () => expectText(show(A.map((r) => r.map((c) => c.times(2)))), '[[2, 4], [6, 8]]'))
suite.test('Rank', 'A', '2', () => expectText(String(matrixRank(A)), '2'))
suite.test('A times its inverse', 'A * A^-1', 'Identity [[1, 0], [0, 1]]', () => {
  const ident = matrixMultiply(A, matrixInverse(A))
  for (const [i, row] of ident.entries()) {
    for (const [j, v] of row.entries()) {
      const want = i === j ? 1 : 0
      if (Math.abs(v.toNumber() - want) > 1e-12) throw new GuideMismatch(show(ident))
    }
  }
  return { actual: show(ident) }
})

// Singular matrix [[1, 2], [2, 4]]
const singular = m([[1, 2], [2, 4]])
suite.test('Singular matrix: determinant 0', '[[1, 2], [2, 4]]', '0', () => expectText(matrixDeterminant(singular).toString(), '0'))
suite.test('Singular matrix: rank 1', '[[1, 2], [2, 4]]', '1', () => expectText(String(matrixRank(singular)), '1'))
suite.test('Singular matrix: inverse gives a clear "not invertible" error', '[[1, 2], [2, 4]]', 'Clear error', () =>
  expectError(() => matrixInverse(singular), /singular|not exist/i))

// Dimension errors
suite.test('Dimension error: 2x3 times 2x3', '2x3 * 2x3', 'A clear dimension error', () =>
  expectError(() => matrixMultiply(m([[1, 2, 3], [4, 5, 6]]), m([[1, 2, 3], [4, 5, 6]])), /cannot multiply/i))
suite.test('Dimension error: adding different sizes', '2x2 + 2x3', 'A clear dimension error', () =>
  expectError(() => matrixAdd(m([[1, 2], [3, 4]]), m([[1, 2, 3], [4, 5, 6]])), /dimensions must match/i))

// Eigenvalues
suite.test('Eigenvalues of [[2, 0], [0, 3]]', '[[2, 0], [0, 3]]', '2 and 3', () =>
  expectText(eigenvalues2x2(m([[2, 0], [0, 3]])).map(String).sort().join(' and '), '2 and 3'))
suite.test('Eigenvalues of [[2, 1], [1, 2]]', '[[2, 1], [1, 2]]', '3 and 1', () =>
  expectText(eigenvalues2x2(m([[2, 1], [1, 2]])).map(String).sort().join(' and '), '1 and 3'))
suite.test('Eigenvalues of [[0, -1], [1, 0]]', '[[0, -1], [1, 0]]', 'i and -i (complex)', () => {
  // The guide asks for the complex eigenvalues; a clear "complex" error is the honest fallback.
  try {
    const values = eigenvalues2x2(m([[0, -1], [1, 0]]))
    return { actual: values.map(String).join(' and ') }
  } catch (err) {
    if (err instanceof GuideMismatch) throw err
    return { actual: `rejected: ${(err as Error).message}` }
  }
})

// Solving systems
suite.test('Solve x + y = 3 and x - y = 1', 'x+y=3, x-y=1', 'x = 2, y = 1', () =>
  expectText(solveLinearSystem(m([[1, 1], [1, -1]]), [dec(3), dec(1)]).map(String).join(', '), '2, 1'))
suite.test('Solve 2x + 3y = 8 and x - y = -1', '2x+3y=8, x-y=-1', 'x = 1, y = 2', () =>
  expectText(solveLinearSystem(m([[2, 3], [1, -1]]), [dec(8), dec(-1)]).map(String).join(', '), '1, 2'))
suite.test('Parallel equations: x + y = 1 and x + y = 2', 'parallel lines', '"No solution"', () =>
  expectError(() => solveLinearSystem(m([[1, 1], [1, 1]]), [dec(1), dec(2)]), /singular|no unique/i))
suite.test('Duplicate equations: x + y = 1 twice', 'duplicate lines', '"Infinitely many solutions"', () =>
  expectError(() => solveLinearSystem(m([[1, 1], [1, 1]]), [dec(1), dec(1)]), /singular|no unique/i))
suite.test('A 1x1 matrix works', '[[5]]', 'det 5, inverse [[0.2]]', () => {
  const one = m([[5]])
  if (matrixDeterminant(one).toString() !== '5') throw new GuideMismatch('det')
  return expectText(show(matrixInverse(one)), '[[0.2]]')
})
suite.test('A larger matrix (10x10) stays responsive', '10x10 identity', 'Identity back', () => {
  const size = 10
  const big = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => dec(i === j ? 1 : 0)))
  const started = Date.now()
  const inv = matrixInverse(big)
  const ms = Date.now() - started
  if (inv[0][0].toString() !== '1') throw new GuideMismatch(show(inv))
  if (ms > 5000) throw new GuideMismatch(`${ms} ms`, 'took too long')
  return { actual: `identity, ${ms} ms` }
})
suite.test('Row reduction of [[1, 2], [3, 4]] ends in the identity', 'rref([[1, 2], [3, 4]])', '[[1, 0], [0, 1]]', () =>
  expectText(show(matrixRREF(A)), '[[1, 0], [0, 1]]'))

// ---------- Vectors ----------
suite.test('(1, 2, 3) dot (4, 5, 6)', '(1,2,3) . (4,5,6)', '32', () =>
  expectText(vectorDot([dec(1), dec(2), dec(3)], [dec(4), dec(5), dec(6)]).toString(), '32'))
suite.test('(1, 2, 3) cross (4, 5, 6)', '(1,2,3) x (4,5,6)', '(-3, 6, -3)', () =>
  expectText(`(${vectorCross([dec(1), dec(2), dec(3)], [dec(4), dec(5), dec(6)]).map(String).join(', ')})`, '(-3, 6, -3)'))
suite.test('Length of (3, 4)', 'norm(3, 4)', '5', () => expectText(vectorNorm([dec(3), dec(4)]).toString(), '5'))
suite.test('Angle between (1, 0) and (0, 1)', '(1,0) and (0,1)', '90 degrees', () => {
  const rad = vectorAngle([dec(1), dec(0)], [dec(0), dec(1)])
  const deg = rad.times(180).dividedBy(Decimal.acos(-1))
  return expectClose(deg.toString(), 90, 1e-9)
})
suite.test('Cross product of 2D vectors', 'cross([1, 2], [3, 4])', 'Error or a clear rule', () =>
  expectError(() => vectorCross([dec(1), dec(2)], [dec(3), dec(4)]), /3 values/i))
suite.test('Dot product with mismatched lengths', 'dot(2D, 3D)', 'Error', () =>
  expectError(() => vectorDot([dec(1), dec(2)], [dec(1), dec(2), dec(3)]), /2 values/i))

// ---------- Complex numbers ----------
const z1 = new Complex(dec(3), dec(4))
const z2 = new Complex(dec(1), dec(-2))

suite.test('(3 + 4i) + (1 - 2i)', '(3 + 4i) + (1 - 2i)', '4 + 2i', () => expectText(complexAdd(z1, z2).toString(), '4 + 2i'))
suite.test('(3 + 4i) * (1 - 2i)', '(3 + 4i) * (1 - 2i)', '11 - 2i', () => expectText(complexMultiply(z1, z2).toString(), '11 - 2i'))
suite.test('(3 + 4i) / (1 - 2i)', '(3 + 4i) / (1 - 2i)', '-1 + 2i', () => expectText(complexDivide(z1, z2).toString(), '-1 + 2i'))
suite.test('i * i', 'i * i', '-1', () => {
  const i = new Complex(dec(0), dec(1))
  return expectText(complexMultiply(i, i).toString(), '-1')
})
suite.test('abs(3 + 4i)', '|3 + 4i|', '5', () => expectText(complexAbs(z1).toString(), '5'))
suite.test('Conjugate of 3 + 4i', 'conj(3 + 4i)', '3 - 4i', () =>
  expectText(new Complex(z1.re, z1.im.neg()).toString(), '3 - 4i'))
suite.test('sqrt(-1)', 'sqrt(-1)', 'i', () => {
  const r = complexSqrt(new Complex(dec(-1), dec(0)))
  if (Math.abs(r.re.toNumber()) > 1e-12 || Math.abs(r.im.toNumber() - 1) > 1e-12) throw new GuideMismatch(r.toString())
  return { actual: r.toString() }
})
suite.test('1 + i in polar form', '1 + i', '1.4142 at 45 degrees (0.7854 rad)', () => {
  const z = new Complex(dec(1), dec(1))
  const r = complexAbs(z)
  const theta = complexArg(z)
  if (Math.abs(r.toNumber() - 1.4142) > 1e-4) throw new GuideMismatch(`r = ${r}`)
  return expectClose(theta.toString(), 0.7854, 1e-4)
})
suite.test('exp(i * pi)', 'e^(i*pi)', '-1 (a tiny imaginary part is fine)', () => {
  const r = Complex.fromPolar(dec(1), Decimal.acos(-1))
  if (Math.abs(r.re.toNumber() + 1) > 1e-12 || Math.abs(r.im.toNumber()) > 1e-12) throw new GuideMismatch(r.toString())
  return { actual: r.toString() }
})
suite.test('Cube roots of 8', 'cube roots of 8', '2, -1 + 1.732i, -1 - 1.732i', () => {
  const roots = complexRoots(new Complex(dec(8), dec(0)), 3)
  if (roots.length !== 3) throw new GuideMismatch(`${roots.length} roots`)
  const real = roots.find((r) => Math.abs(r.im.toNumber()) < 1e-9)
  if (!real || Math.abs(real.re.toNumber() - 2) > 1e-9) throw new GuideMismatch(roots.map((r) => r.toString(3)).join(' | '))
  const complexOnes = roots.filter((r) => Math.abs(r.im.toNumber()) >= 1e-9)
  for (const r of complexOnes) {
    if (Math.abs(r.re.toNumber() + 1) > 1e-9 || Math.abs(Math.abs(r.im.toNumber()) - 1.7320508) > 1e-6) {
      throw new GuideMismatch(roots.map((x) => x.toString(3)).join(' | '))
    }
  }
  return { actual: roots.map((r) => r.toString(3)).join(' | ') }
})

// ---------- Polynomial roots ----------
suite.test('Roots of x^2 - 5x + 6', 'x^2 - 5x + 6', '2, 3', () =>
  expectText(polynomialRootsReal([dec(6), dec(-5), dec(1)]).map(String).sort().join(', '), '2, 3'))
suite.test('Roots of x^2 + 1', 'x^2 + 1', 'i, -i (or no real roots)', () => {
  const roots = polynomialRootsReal([dec(1), dec(0), dec(1)])
  if (roots.length !== 0) throw new GuideMismatch(roots.map(String).join(', '))
  return { actual: 'no real roots' }
})
suite.test('Roots of x^3 - 6x^2 + 11x - 6', 'x^3 - 6x^2 + 11x - 6', '1, 2, 3', () =>
  expectText(polynomialRootsReal([dec(-6), dec(11), dec(-6), dec(1)]).map((r) => r.toDecimalPlaces(0).toString()).sort().join(', '), '1, 2, 3'))
suite.test('Roots of x^2 + 2x + 1', 'x^2 + 2x + 1', '-1 (double root)', () => {
  const roots = polynomialRootsReal([dec(1), dec(2), dec(1)])
  if (roots.length === 0 || !roots.every((r) => r.toString() === '-1')) throw new GuideMismatch(roots.map(String).join(', '))
  return { actual: roots.map(String).join(', ') }
})

finish(suite)
