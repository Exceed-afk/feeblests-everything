import assert from 'node:assert/strict'
import {
  matrixAdd,
  matrixSub,
  matrixMultiply,
  matrixTranspose,
  matrixDeterminant,
  matrixInverse,
  matrixRank,
  matrixRREF,
  solveLinearSystem,
  eigenvalues2x2,
  vectorDot,
  vectorCross,
  vectorNorm,
  vectorAngle,
  polynomialRootsReal
} from '../src/shared/calculator/modules/linear-algebra'
import { Decimal } from '../src/shared/calculator/numeric'

const dec = (n: number | string): Decimal => new Decimal(n)
const close = (actual: Decimal | number, expected: number, tol = 1e-5, label?: string) => {
  const a = typeof actual === 'number' ? actual : actual.toNumber()
  assert.ok(
    Math.abs(a - expected) <= tol,
    `${label || ''} expected ${expected}, got ${a} (diff ${Math.abs(a - expected)})`
  )
}

let checks = 0
const ok = () => { checks++ }

// ---------- 1. Matrix Add & Multiply ----------
// A = [[1, 2], [3, 4]], B = [[5, 6], [7, 8]]
const A = [
  [dec(1), dec(2)],
  [dec(3), dec(4)]
]
const B = [
  [dec(5), dec(6)],
  [dec(7), dec(8)]
]

const sum = matrixAdd(A, B)
close(sum[0][0], 6); close(sum[0][1], 8); close(sum[1][0], 10); close(sum[1][1], 12); ok()

const diff = matrixSub(B, A)
close(diff[0][0], 4); close(diff[0][1], 4); close(diff[1][0], 4); close(diff[1][1], 4); ok()

// A * B = [[19, 22], [43, 50]]
const prod = matrixMultiply(A, B)
close(prod[0][0], 19); close(prod[0][1], 22); close(prod[1][0], 43); close(prod[1][1], 50); ok()

// Transpose
const At = matrixTranspose(A)
close(At[0][1], 3); close(At[1][0], 2); ok()

// ---------- 2. Determinant & Inverse ----------
// det(A) = 1*4 - 2*3 = -2
const detA = matrixDeterminant(A)
close(detA, -2, 1e-9, 'det(A)'); ok()

// Inverse of A: A^-1 = (1/-2) * [[4, -2], [-3, 1]] = [[-2, 1], [1.5, -0.5]]
const invA = matrixInverse(A)
close(invA[0][0], -2); close(invA[0][1], 1); close(invA[1][0], 1.5); close(invA[1][1], -0.5); ok()

// A * A^-1 = Identity
const ident = matrixMultiply(A, invA)
close(ident[0][0], 1, 1e-9); close(ident[0][1], 0, 1e-9);
close(ident[1][0], 0, 1e-9); close(ident[1][1], 1, 1e-9); ok()

// 3x3 Determinant:
// M = [[6, 1, 1], [4, -2, 5], [2, 8, 7]] -> det = -306
const M = [
  [dec(6), dec(1), dec(1)],
  [dec(4), dec(-2), dec(5)],
  [dec(2), dec(8), dec(7)]
]
const detM = matrixDeterminant(M)
close(detM, -306, 1e-7, '3x3 det'); ok()

// Singular matrix (det = 0)
const Sing = [
  [dec(1), dec(2)],
  [dec(2), dec(4)]
]
assert.throws(() => matrixInverse(Sing), /Singular matrix/); ok()

// ---------- 3. Rank & RREF ----------
// Rank of A is 2; Rank of Sing is 1
assert.equal(matrixRank(A), 2); ok()
assert.equal(matrixRank(Sing), 1); ok()

const rrefSing = matrixRREF(Sing)
close(rrefSing[0][0], 1); close(rrefSing[0][1], 2);
close(rrefSing[1][0], 0); close(rrefSing[1][1], 0); ok()

// ---------- 4. Solve Linear System A * x = b ----------
// 2x + y = 8, x + 3y = 14 -> x = 2, y = 4
const linA = [
  [dec(2), dec(1)],
  [dec(1), dec(3)]
]
const linB = [dec(8), dec(14)]
const xSol = solveLinearSystem(linA, linB)
close(xSol[0], 2, 1e-7, 'x = 2'); ok()
close(xSol[1], 4, 1e-7, 'y = 4'); ok()

// ---------- 5. 2x2 Eigenvalues ----------
// M = [[2, 1], [1, 2]] -> det(M - λI) = (2-λ)^2 - 1 = λ^2 - 4λ + 3 = (λ-3)(λ-1) -> λ = 3, 1
const symM = [
  [dec(2), dec(1)],
  [dec(1), dec(2)]
]
const evals = eigenvalues2x2(symM)
assert.equal(evals.length, 2); ok()
close(evals[0], 3, 1e-7, 'lambda1 = 3'); ok()
close(evals[1], 1, 1e-7, 'lambda2 = 1'); ok()

// ---------- 6. Vector Operations ----------
const v1 = [dec(1), dec(2), dec(3)]
const v2 = [dec(4), dec(5), dec(6)]

// Dot product: 1*4 + 2*5 + 3*6 = 32
const dot = vectorDot(v1, v2)
close(dot, 32, 1e-9, 'Dot product'); ok()

// Norm: sqrt(1^2 + 2^2 + 3^2) = sqrt(14) ~ 3.741657
close(vectorNorm(v1), Math.sqrt(14), 1e-7, 'Norm v1'); ok()

// Cross product of [1,0,0] and [0,1,0] is [0,0,1]
const cross = vectorCross([dec(1), dec(0), dec(0)], [dec(0), dec(1), dec(0)])
close(cross[0], 0); close(cross[1], 0); close(cross[2], 1); ok()

// Angle between [1,0] and [0,1] is pi/2 (rad) or 90 deg
const angle = vectorAngle([dec(1), dec(0)], [dec(0), dec(1)])
close(angle, Math.PI / 2, 1e-7, 'Vector angle'); ok()

// ---------- 7. Polynomial Roots (Quadratic & Cubic) ----------
// x^2 - 5x + 6 = 0 -> x = 2, 3
const rootsQuad = polynomialRootsReal([dec(6), dec(-5), dec(1)])
assert.equal(rootsQuad.length, 2); ok()
close(rootsQuad[0], 2, 1e-6); close(rootsQuad[1], 3, 1e-6); ok()

// x^3 - 6x^2 + 11x - 6 = 0 -> x = 1, 2, 3
const rootsCubic = polynomialRootsReal([dec(-6), dec(11), dec(-6), dec(1)])
assert.equal(rootsCubic.length, 3); ok()
close(rootsCubic[0], 1, 1e-5); close(rootsCubic[1], 2, 1e-5); close(rootsCubic[2], 3, 1e-5); ok()

console.log(`ok   ${checks} linear algebra & matrix tests passed`)
