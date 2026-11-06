import assert from 'node:assert/strict'
import {
  casSimplify,
  casDifferentiate,
  casIntegratePolynomial,
  casLimitPolynomial,
  casSubstitute,
  casSolveLinear,
  casTaylorSeries
} from '../src/shared/calculator/modules/cas'

let checks = 0
const ok = () => { checks++ }

// ---------- 1. Simplification & Expansion ----------
// 2 + 3 -> 5
assert.equal(casSimplify('2 + 3'), '5'); ok()
// 2 * x + 3 * x -> 5*x
assert.equal(casSimplify('2x + 3x'), '5*x'); ok()
// 0 * x -> 0
assert.equal(casSimplify('0 * x'), '0'); ok()
// 1 * x -> x
assert.equal(casSimplify('1 * x'), 'x'); ok()
// x + 0 -> x
assert.equal(casSimplify('x + 0'), 'x'); ok()

// ---------- 2. Substitution ----------
// Substitute x = 4 into x^2 + 2x - 1 -> 4^2 + 2(4) - 1 = 16 + 8 - 1 = 23
assert.equal(casSubstitute('x^2 + 2*x - 1', 'x', '4'), '23'); ok()
// Substitute x = 0 into sin(x) + cos(x) -> 0 + 1 = 1
assert.equal(casSubstitute('sin(x) + cos(x)', 'x', '0'), '1'); ok()

// ---------- 3. Symbolic Derivatives ----------
// d/dx (x^3) = 3*x^2
assert.equal(casDifferentiate('x^3', 'x'), '3*x^2'); ok()
// d/dx (x) = 1
assert.equal(casDifferentiate('x', 'x'), '1'); ok()
// d/dx (5) = 0
assert.equal(casDifferentiate('5', 'x'), '0'); ok()
// d/dx (x^2 + 4x - 7) = 2*x + 4
assert.equal(casDifferentiate('x^2 + 4*x - 7', 'x'), '2*x + 4'); ok()
// d/dx (-x^2) = -2*x
assert.equal(casDifferentiate('-x^2', 'x'), '-2*x'); ok()
// d/dx (sin(x)) = cos(x)
assert.equal(casDifferentiate('sin(x)', 'x'), 'cos(x)'); ok()
// d/dx (cos(x)) = -sin(x)
assert.equal(casDifferentiate('cos(x)', 'x'), '-sin(x)'); ok()
// d/dx (e^x) = e^x
assert.equal(casDifferentiate('e^x', 'x'), 'e^x'); ok()
// d/dx (ln(x)) = 1/x
assert.equal(casDifferentiate('ln(x)', 'x'), '1/x'); ok()

// ---------- 4. Symbolic Polynomial Integration ----------
// ∫ (3x^2 + 2x + 1) dx = x^3 + x^2 + x + C
assert.equal(casIntegratePolynomial('3*x^2 + 2*x + 1', 'x'), 'x^3 + x^2 + x + C'); ok()
// Definite integral: ∫_0^2 (3x^2) dx = 2^3 - 0 = 8
assert.equal(casIntegratePolynomial('3*x^2', 'x', 0, 2), '8'); ok()

// ---------- 5. Limits ----------
// lim_{x -> 2} (x^2 + 3) = 7
assert.equal(casLimitPolynomial('x^2 + 3', 'x', 2), '7'); ok()

// ---------- 6. Solve Linear Equation ----------
// 2x + 5 = 15 -> x = 5
assert.equal(casSolveLinear('2*x + 5 = 15', 'x'), '5'); ok()
// 3x - 9 = 0 -> x = 3
assert.equal(casSolveLinear('3*x - 9 = 0', 'x'), '3'); ok()

// ---------- 7. Taylor Series (Maclaurin) ----------
// e^x around 0 up to degree 3 -> 1 + x + (1/2)*x^2 + (1/6)*x^3
const taylorExp = casTaylorSeries('e^x', 'x', 0, 3)
assert.ok(taylorExp.includes('x^2'), 'Contains quadratic term'); ok()
assert.ok(taylorExp.includes('x^3'), 'Contains cubic term'); ok()

// ---------- 8. Differentiator Property Test (at least 25 expressions at 5 points) ----------
import { parse } from '../src/shared/calculator/parser'
import { Evaluator } from '../src/shared/calculator/evaluator'
import { Decimal } from '../src/shared/calculator/numeric'

const evalRad = (eStr: string, xVal: number) => {
  const ast = parse(eStr)
  const ev = new Evaluator({ scope: { x: new Decimal(xVal), __anglemode: new Decimal(1) }, angleMode: 'rad' })
  return ev.evaluate(ast).toNumber()
}

const h = 1e-6
const expressions = [
  'e^(2*x)', 'e^(x^2)', 'e^(-x)', 'exp(3*x+1)', 'sin(2*x)', 'cos(x^2)',
  'ln(3*x)', 'ln(x^2+1)', '(2*x+1)^3', 'sqrt(2*x)', '2^x', '3^(2*x)',
  'x*e^x', 'sin(x)*cos(x)', 'tan(x)', '1/x', '1/(x^2+1)', 'atan(2*x)',
  'x^3 + 2*x^2 + 5*x + 7', '3*x - 4', 'sinh(x)', 'cosh(x)', 'tanh(x)',
  'asin(x)', 'acos(x)', '(x+1)/(x+2)', '5'
]

for (const expr of expressions) {
  const d = casDifferentiate(expr, 'x')
  for (const x of [0.3, 0.4, 0.5, 0.6, 0.7]) {
    const sym = evalRad(d, x)
    const num = (evalRad(expr, x + h) - evalRad(expr, x - h)) / (2 * h)
    const tol = 1e-3 * Math.max(1, Math.abs(sym))
    assert.ok(
      Math.abs(sym - num) <= tol,
      `Differentiator property test mismatch for ${expr} at x=${x}: symbolic=${sym}, numeric=${num}`
    )
    ok()
  }
}

// Unsupported expressions throw clear CalcError
assert.throws(() => casDifferentiate('unsupported_fn(x)', 'x'), /Could not differentiate/)
ok()

console.log(`ok   ${checks} CAS symbolic math tests passed`)
