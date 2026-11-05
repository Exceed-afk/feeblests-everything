import { Decimal } from '../../numeric'
import { registry } from '../../registry'
import { CALC_LIMITS, limitMessage } from '../../limits'
import { CalcError } from '../../errors'
import { toDecimalInput, describe } from '../../inputs'

export type Matrix = Decimal[][]
export type Vector = Decimal[]

/** Largest polynomial degree the root finder handles (it solves deg <= 3 exactly). */
const MAX_POLYNOMIAL_DEGREE = 20

/**
 * Matrix gate used by every entry point: a non-empty, rectangular list of finite
 * numbers, at most matrixDimension x matrixDimension (section 11).
 */
function matrixInput(value: unknown, what = 'matrix'): Matrix {
  if (!Array.isArray(value)) throw new CalcError(`${what} must be a list of rows (got ${describe(value)})`)
  if (value.length === 0) throw new CalcError(`${what} cannot be empty`)
  if (value.length > CALC_LIMITS.matrixDimension) {
    throw new CalcError(`${limitMessage('matrixDimension', 'rows or columns')} (this one has ${value.length} rows)`)
  }
  const cols = Array.isArray(value[0]) ? (value[0] as unknown[]).length : -1
  if (cols === 0) throw new CalcError(`${what} rows cannot be empty`)
  if (cols > CALC_LIMITS.matrixDimension) {
    throw new CalcError(`${limitMessage('matrixDimension', 'rows or columns')} (this one has ${cols} columns)`)
  }
  return value.map((row, i) => {
    if (!Array.isArray(row)) throw new CalcError(`${what} row ${i + 1} must be a list of numbers`)
    if (row.length !== cols) {
      throw new CalcError(`${what} must have the same number of columns in every row (row ${i + 1} has ${row.length}, expected ${cols})`)
    }
    return row.map((v, j) => toDecimalInput(v, `${what}[${i + 1}][${j + 1}]`))
  })
}

function vectorInput(value: unknown, what = 'vector', opts: { exactLength?: number } = {}): Vector {
  if (!Array.isArray(value)) throw new CalcError(`${what} must be a list of numbers (got ${describe(value)})`)
  if (value.length === 0) throw new CalcError(`${what} cannot be empty`)
  if (value.length > CALC_LIMITS.vectorLength) {
    throw new CalcError(`${limitMessage('vectorLength', 'values')} (this one has ${value.length.toLocaleString('en-US')})`)
  }
  if (opts.exactLength !== undefined && value.length !== opts.exactLength) {
    throw new CalcError(`${what} must have ${opts.exactLength} values (got ${value.length})`)
  }
  return value.map((v, i) => toDecimalInput(v, `${what}[${i + 1}]`))
}

function squareMatrixInput(value: unknown, what = 'matrix'): Matrix {
  const m = matrixInput(value, what)
  if (m.length !== m[0].length) throw new CalcError(`${what} must be square (got ${m.length}x${m[0].length})`)
  return m
}

export function createMatrix(rows: number, cols: number, fill = '0'): Matrix {
  const r = toInteger(rows, 'rows')
  const c = toInteger(cols, 'cols')
  if (r > CALC_LIMITS.matrixDimension || c > CALC_LIMITS.matrixDimension) {
    throw new CalcError(limitMessage('matrixDimension', 'rows or columns'))
  }
  const fillValue = toDecimalInput(fill, 'fill')
  return Array.from({ length: r }, () => Array.from({ length: c }, () => fillValue))
}

function toInteger(value: unknown, what: string): number {
  const d = toDecimalInput(value, what)
  if (!d.isInteger() || d.isNegative()) throw new CalcError(`${what} must be a non-negative whole number`)
  return d.toNumber()
}

export function matrixAdd(A: Matrix, B: Matrix): Matrix {
  const a = matrixInput(A, 'A')
  const b = matrixInput(B, 'B')
  if (a.length !== b.length || a[0].length !== b[0].length) {
    throw new CalcError('Matrix dimensions must match for addition')
  }
  return a.map((row, i) => row.map((val, j) => val.plus(b[i][j])))
}

export function matrixSub(A: Matrix, B: Matrix): Matrix {
  const a = matrixInput(A, 'A')
  const b = matrixInput(B, 'B')
  if (a.length !== b.length || a[0].length !== b[0].length) {
    throw new CalcError('Matrix dimensions must match for subtraction')
  }
  return a.map((row, i) => row.map((val, j) => val.minus(b[i][j])))
}

export function matrixMultiply(A: Matrix, B: Matrix): Matrix {
  const a = matrixInput(A, 'A')
  const b = matrixInput(B, 'B')
  const rowsA = a.length
  const colsA = a[0].length
  const rowsB = b.length
  const colsB = b[0].length

  if (colsA !== rowsB) {
    throw new CalcError(`Cannot multiply ${rowsA}x${colsA} matrix with ${rowsB}x${colsB} matrix`)
  }

  const result: Matrix = Array.from({ length: rowsA }, () => Array.from({ length: colsB }, () => new Decimal(0)))
  for (let i = 0; i < rowsA; i++) {
    for (let j = 0; j < colsB; j++) {
      let sum = new Decimal(0)
      for (let k = 0; k < colsA; k++) {
        sum = sum.plus(a[i][k].times(b[k][j]))
      }
      result[i][j] = sum
    }
  }
  return result
}

export function matrixTranspose(A: Matrix): Matrix {
  const a = matrixInput(A, 'A')
  const rows = a.length
  const cols = a[0].length
  const result: Matrix = Array.from({ length: cols }, () => Array.from({ length: rows }, () => new Decimal(0)))
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      result[j][i] = a[i][j]
    }
  }
  return result
}

/**
 * Computes the determinant of a square matrix using Gaussian elimination with partial pivoting.
 */
export function matrixDeterminant(A: Matrix): Decimal {
  const square = squareMatrixInput(A, 'A')
  const n = square.length

  // Clone matrix
  const M: Matrix = square.map((row) => [...row])
  let det = new Decimal(1)

  for (let i = 0; i < n; i++) {
    // Find pivot
    let pivot = i
    for (let j = i + 1; j < n; j++) {
      if (M[j][i].abs().greaterThan(M[pivot][i].abs())) {
        pivot = j
      }
    }

    if (M[pivot][i].isZero()) return new Decimal(0)

    if (pivot !== i) {
      const temp = M[i]
      M[i] = M[pivot]
      M[pivot] = temp
      det = det.neg()
    }

    det = det.times(M[i][i])
    const pivotVal = M[i][i]

    for (let j = i + 1; j < n; j++) {
      const factor = M[j][i].dividedBy(pivotVal)
      for (let k = i; k < n; k++) {
        M[j][k] = M[j][k].minus(factor.times(M[i][k]))
      }
    }
  }

  return det
}

/**
 * Computes the matrix inverse using Gauss-Jordan elimination with an augmented identity.
 */
export function matrixInverse(A: Matrix): Matrix {
  const square = squareMatrixInput(A, 'A')
  const n = square.length

  // Augmented matrix [A | I]
  const aug: Matrix = square.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => new Decimal(i === j ? 1 : 0))
  ])

  for (let i = 0; i < n; i++) {
    let pivot = i
    for (let j = i + 1; j < n; j++) {
      if (aug[j][i].abs().greaterThan(aug[pivot][i].abs())) {
        pivot = j
      }
    }

    if (aug[pivot][i].abs().lessThan('1e-12')) {
      throw new CalcError('Singular matrix: determinant is zero, inverse does not exist')
    }

    if (pivot !== i) {
      const temp = aug[i]
      aug[i] = aug[pivot]
      aug[pivot] = temp
    }

    const pivotVal = aug[i][i]
    for (let k = 0; k < 2 * n; k++) {
      aug[i][k] = aug[i][k].dividedBy(pivotVal)
    }

    for (let j = 0; j < n; j++) {
      if (j !== i) {
        const factor = aug[j][i]
        for (let k = 0; k < 2 * n; k++) {
          aug[j][k] = aug[j][k].minus(factor.times(aug[i][k]))
        }
      }
    }
  }

  return aug.map((row) => row.slice(n))
}

/**
 * Computes the Reduced Row Echelon Form (RREF).
 */
export function matrixRREF(A: Matrix): Matrix {
  const input = matrixInput(A, 'A')
  const rows = input.length
  const cols = input[0].length
  const M: Matrix = input.map((row) => [...row])

  let lead = 0
  for (let r = 0; r < rows; r++) {
    if (lead >= cols) break
    let i = r
    while (M[i][lead].abs().lessThan('1e-12')) {
      i++
      if (i === rows) {
        i = r
        lead++
        if (lead === cols) break
      }
    }
    if (lead >= cols) break

    const temp = M[i]
    M[i] = M[r]
    M[r] = temp

    const lv = M[r][lead]
    for (let j = 0; j < cols; j++) {
      M[r][j] = M[r][j].dividedBy(lv)
    }

    for (let j = 0; j < rows; j++) {
      if (j !== r) {
        const factor = M[j][lead]
        for (let k = 0; k < cols; k++) {
          M[j][k] = M[j][k].minus(factor.times(M[r][k]))
        }
      }
    }
    lead++
  }

  return M
}

/**
 * Computes the rank of a matrix (number of non-zero rows in RREF).
 */
export function matrixRank(A: Matrix): number {
  const rref = matrixRREF(A)
  let count = 0
  for (const row of rref) {
    if (row.some((val) => val.abs().greaterThan('1e-9'))) {
      count++
    }
  }
  return count
}

/**
 * Solves A * x = b for square A using matrix inverse / Gauss-Jordan.
 */
export function solveLinearSystem(A: Matrix, b: Vector): Vector {
  const a = squareMatrixInput(A, 'A')
  const n = a.length
  const rhs = vectorInput(b, 'b', { exactLength: n })
  const invA = matrixInverse(a)
  const bMat: Matrix = rhs.map((val) => [val])
  const xMat = matrixMultiply(invA, bMat)
  return xMat.map((row) => row[0])
}

/**
 * Closed-form 2x2 matrix eigenvalues (roots of characteristic poly λ² - tr(A)λ + det(A) = 0).
 */
export function eigenvalues2x2(A: Matrix): Decimal[] {
  const a = matrixInput(A, 'A')
  if (a.length !== 2 || a[0].length !== 2) throw new CalcError('Requires a 2x2 matrix')
  const tr = a[0][0].plus(a[1][1])
  const det = matrixDeterminant(a)

  // Discr = tr² - 4*det
  const discr = tr.times(tr).minus(det.times(4))
  if (discr.isNegative()) {
    throw new CalcError('2x2 matrix has complex eigenvalues')
  }

  const sqrtD = discr.sqrt()
  const l1 = tr.plus(sqrtD).dividedBy(2)
  const l2 = tr.minus(sqrtD).dividedBy(2)
  return [l1, l2]
}

// ---------- Vector Tools ----------

export function vectorDot(a: Vector, b: Vector): Decimal {
  const av = vectorInput(a, 'a')
  const bv = vectorInput(b, 'b', { exactLength: av.length })
  return av.reduce((sum, val, i) => sum.plus(val.times(bv[i])), new Decimal(0))
}

export function vectorNorm(a: Vector): Decimal {
  const av = vectorInput(a, 'a')
  return vectorDot(av, av).sqrt()
}

export function vectorCross(a: Vector, b: Vector): Vector {
  const av = vectorInput(a, 'a', { exactLength: 3 })
  const bv = vectorInput(b, 'b', { exactLength: 3 })
  return [
    av[1].times(bv[2]).minus(av[2].times(bv[1])),
    av[2].times(bv[0]).minus(av[0].times(bv[2])),
    av[0].times(bv[1]).minus(av[1].times(bv[0]))
  ]
}

export function vectorAngle(a: Vector, b: Vector): Decimal {
  const av = vectorInput(a, 'a')
  const bv = vectorInput(b, 'b', { exactLength: av.length })
  const dot = vectorDot(av, bv)
  const denom = vectorNorm(av).times(vectorNorm(bv))
  if (denom.isZero()) throw new CalcError('Cannot compute angle with zero vector')
  const cos = dot.dividedBy(denom)
  // Clamp between -1 and 1
  const clamped = Decimal.min(new Decimal(1), Decimal.max(new Decimal(-1), cos))
  return clamped.acos()
}

// ---------- Polynomial Roots (Real) ----------

/**
 * Finds real roots of polynomial c0 + c1*x + c2*x^2 + ... = 0 (coeffs ascending order).
 */
export function polynomialRootsReal(coeffs: Vector): Decimal[] {
  const values = vectorInput(coeffs, 'coefficients')
  coeffs = values
  if (coeffs.length > MAX_POLYNOMIAL_DEGREE + 1) {
    throw new CalcError(
      `polynomialRootsReal handles polynomials up to degree ${MAX_POLYNOMIAL_DEGREE} ` +
        `(this one has degree ${coeffs.length - 1})`
    )
  }
  // Trim leading zeros in highest degree
  let deg = coeffs.length - 1
  while (deg > 0 && coeffs[deg].isZero()) deg--

  if (deg === 1) {
    // c0 + c1*x = 0 -> x = -c0/c1
    return [coeffs[0].neg().dividedBy(coeffs[1])]
  }

  if (deg === 2) {
    // c0 + c1*x + c2*x^2 = 0 -> a = c2, b = c1, c = c0
    const a = coeffs[2]
    const b = coeffs[1]
    const c = coeffs[0]
    const discr = b.times(b).minus(a.times(c).times(4))
    if (discr.isNegative()) return []
    const sqrtD = discr.sqrt()
    const r1 = b.neg().minus(sqrtD).dividedBy(a.times(2))
    const r2 = b.neg().plus(sqrtD).dividedBy(a.times(2))
    return r1.equals(r2) ? [r1] : [r1, r2].sort((x, y) => x.comparedTo(y))
  }

  if (deg === 3) {
    // Cardano's method for cubic: a*x^3 + b*x^2 + c*x + d = 0
    const a = coeffs[3].toNumber()
    const b = coeffs[2].toNumber()
    const c = coeffs[1].toNumber()
    const d = coeffs[0].toNumber()

    // Depressed cubic t^3 + p*t + q = 0, where x = t - b/(3a)
    const p = (3 * a * c - b * b) / (3 * a * a)
    const q = (2 * b * b * b - 9 * a * b * c + 27 * a * a * d) / (27 * a * a * a)
    const delta = (q * q) / 4 + (p * p * p) / 27

    const shift = b / (3 * a)
    const roots: number[] = []

    if (Math.abs(delta) < 1e-12) {
      if (Math.abs(q) < 1e-12) {
        roots.push(-shift)
      } else {
        roots.push((3 * q) / p - shift)
        roots.push((-3 * q) / (2 * p) - shift)
      }
    } else if (delta > 0) {
      const u = Math.cbrt(-q / 2 + Math.sqrt(delta))
      const v = Math.cbrt(-q / 2 - Math.sqrt(delta))
      roots.push(u + v - shift)
    } else {
      // 3 real roots
      const r = Math.sqrt(-((p * p * p) / 27))
      const phi = Math.acos(-q / (2 * r))
      const m = 2 * Math.cbrt(r)
      roots.push(m * Math.cos(phi / 3) - shift)
      roots.push(m * Math.cos((phi + 2 * Math.PI) / 3) - shift)
      roots.push(m * Math.cos((phi + 4 * Math.PI) / 3) - shift)
    }

    return roots.map((r) => new Decimal(r)).sort((x, y) => x.comparedTo(y))
  }

  return []
}

// ---------- Registry Integration ----------

export function registerLinearAlgebraFunctions(): void {
  registry.registerFunction({
    name: 'dot',
    category: 'matrix',
    description: 'Dot product of two vectors represented as numbers',
    examples: ['dot(3, 4)'],
    minArity: 2,
    maxArity: 2,
    impl: ([a, b]) => a.times(b)
  })
}

registerLinearAlgebraFunctions()
