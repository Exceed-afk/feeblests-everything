// docs/calculator-testing-guide.md — Section 8: Symbolic math (CAS).
// Run on its own:  npx tsx tests/calc-guide-section8.ts
//
// The rule for this module: a wrong answer is far worse than "could not solve".
// Where the CAS has no feature at all the row is todo; where it answers, the answer
// is checked against the guide.
import {
  casSimplify, casDifferentiate, casSubstitute, casSolveLinear, casIntegratePolynomial, casTaylorSeries
} from '../src/shared/calculator/modules/cas'
import { GuideSuite, finish, expectText, expectClose, expectError, GuideMismatch } from './calc-guide-common'

export const suite = new GuideSuite('Section 8: Symbolic math (CAS)', 'CAS')

// ---------- Simplify, expand, factor ----------
suite.test('Simplify (x^2 - 1)/(x - 1)', '(x^2 - 1)/(x - 1)', 'x + 1', () =>
  expectText(casSimplify('(x^2 - 1)/(x - 1)'), 'x + 1'),
  'simplifyExpr has no polynomial division or factor cancellation, so the fraction is returned unchanged')
suite.todo('Expand (x + 1)^2', '(x + 1)^2', 'x^2 + 2x + 1', 'No expand function exists in the CAS module')
suite.todo('Expand (x + 2)(x - 3)', '(x + 2)(x - 3)', 'x^2 - x - 6', 'No expand function exists in the CAS module')
suite.todo('Factor x^2 - 5x + 6', 'x^2 - 5x + 6', '(x - 2)(x - 3)', 'No factor function exists in the CAS module')
suite.todo('Factor x^2 - 1', 'x^2 - 1', '(x - 1)(x + 1)', 'No factor function exists in the CAS module')
suite.todo('Factor x^2 + 1', 'x^2 + 1', 'Stays as is (or (x - i)(x + i))', 'No factor function exists in the CAS module')
suite.test('Substitute x = 3 into x^2 + 1', 'x^2 + 1, x = 3', '10', () => expectText(casSubstitute('x^2 + 1', 'x', 3), '10'))

// ---------- Solving ----------
suite.test('Solve 2x + 3 = 7', '2x + 3 = 7', 'x = 2', () => expectText(casSolveLinear('2*x + 3 = 7', 'x'), '2'))
suite.todo('Solve x^2 - 4 = 0', 'x^2 - 4 = 0', 'x = 2 and x = -2', 'Only linear equations are solved (casSolveLinear)')
suite.todo('Solve x^2 + 1 = 0', 'x^2 + 1 = 0', 'x = i and x = -i (or "no real solutions")', 'Only linear equations are solved')
suite.todo('Solve x^2 - 5x + 6 = 0', 'x^2 - 5x + 6 = 0', 'x = 2 and x = 3', 'Only linear equations are solved')
suite.todo('Solve x + y = 3 and x - y = 1', 'x + y = 3, x - y = 1', 'x = 2, y = 1', 'No symbolic system solver (the matrix solver in section 7 covers the numeric form)')
suite.test('Solve x = x + 1', 'x = x + 1', 'No solution', () =>
  expectError(() => casSolveLinear('x = x + 1', 'x'), /no unique|not linear/i))
suite.test('Solve x = x', 'x = x', 'All values', () =>
  expectError(() => casSolveLinear('x = x', 'x'), /no unique|not linear/i))

// ---------- Derivatives ----------
suite.test('Derivative of x^3', 'x^3', '3x^2', () => expectText(casDifferentiate('x^3', 'x'), '3*x^2'))
suite.test('Derivative of sin(x)', 'sin(x)', 'cos(x)', () => expectText(casDifferentiate('sin(x)', 'x'), 'cos(x)'))
suite.test('Derivative of cos(x)', 'cos(x)', '-sin(x)', () => expectText(casDifferentiate('cos(x)', 'x'), '-sin(x)'))
suite.test('Derivative of e^(2x)', 'e^(2x)', '2e^(2x)', () => {
  const d = casDifferentiate('e^(2*x)', 'x')
  // Any correct spelling is fine: 2*e^(2*x), e^(2*x)*2, ...
  if (!/e\^\(2\*x\)/.test(d) || !/(^|[^0-9])2\*?/.test(d)) throw new GuideMismatch(d)
  return { actual: d }
})
suite.test('Derivative of ln(x)', 'ln(x)', '1/x', () => expectText(casDifferentiate('ln(x)', 'x'), '1/x'))
suite.test('Derivative of x * sin(x)', 'x * sin(x)', 'sin(x) + x*cos(x)', () => {
  const d = casDifferentiate('x * sin(x)', 'x')
  if (!d.includes('sin(x)') || !d.includes('cos(x)')) throw new GuideMismatch(d)
  return { actual: d }
})
suite.test('Derivative of 5 (a constant)', '5', '0', () => expectText(casDifferentiate('5', 'x'), '0'))

// ---------- Integrals ----------
suite.todo('Indefinite integral of x^2', 'x^2', 'x^3/3 (plus C)', 'casIntegratePolynomial only returns hard-coded patterns for indefinite integrals')
suite.todo('Indefinite integral of sin(x)', 'sin(x)', '-cos(x)', 'No symbolic trigonometric integration')
suite.todo('Indefinite integral of 1/x', '1/x', 'ln(x) or ln(abs(x))', 'No symbolic rational integration')
suite.test('Definite integral of x^2 from 0 to 1', 'x^2, 0..1', '1/3 (0.3333)', () =>
  expectClose(casIntegratePolynomial('x^2', 'x', 0, 1), 1 / 3, 1e-3))
suite.test('Definite integral of sin(x) from 0 to pi', 'sin(x), 0..pi', '2', () =>
  expectClose(casIntegratePolynomial('sin(x)', 'x', 0, Math.PI), 2, 1e-3))
suite.test('Definite integral of 1 from 0 to 5', '1, 0..5', '5', () =>
  expectClose(casIntegratePolynomial('1', 'x', 0, 5), 5, 1e-3))

// ---------- Limits and series ----------
suite.todo('Limit: sin(x)/x as x approaches 0', 'sin(x)/x, x->0', '1', 'No limit engine (casLimitPolynomial only substitutes the value)')
suite.todo('Limit: 1/x as x approaches infinity', '1/x, x->inf', '0', 'No limits at infinity')
suite.todo('Limit: (1 - cos(x))/x^2 as x approaches 0', '(1 - cos(x))/x^2, x->0', '1/2', 'No indeterminate-form limits')
suite.todo('Limit: (1 + 1/x)^x as x approaches infinity', '(1 + 1/x)^x, x->inf', 'e', 'No limits at infinity')
suite.todo('Limit: 1/x as x approaches 0', '1/x, x->0', 'Does not exist (or left and right differ)', 'No one-sided limits')
suite.test('Taylor series of e^x around 0', 'e^x, around 0', '1 + x + x^2/2 + x^3/6 + ...', () => {
  const res = casTaylorSeries('e^x', 'x', 0, 3)
  for (const x of [0, 0.1, 0.5, -0.2]) {
    const approx = Number(casSubstitute(res, 'x', x))
    const expected = 1 + x + (x * x) / 2 + (x * x * x) / 6
    if (Math.abs(approx - expected) > 1e-6) throw new GuideMismatch(`at x=${x}: got ${approx}, expected ${expected}`)
  }
  return { actual: res }
})

// ---------- Limits of the engine ----------
suite.test('A hard integral (e^(x^2)) fails safely', 'e^(x^2)', 'erf answer or "could not solve", never a wrong answer', () => {
  // The only indefinite-integration path is the hard-coded one; anything else must not
  // come back as a confident wrong answer.
  const out = casIntegratePolynomial('e^(x^2)', 'x')
  if (/erf/.test(out)) return { actual: out }
  if (/could not|not supported|unsupported/i.test(out)) return { actual: out }
  throw new GuideMismatch(out, 'a made-up antiderivative was returned')
}, 'casIntegratePolynomial falls back to "<expr>*x + C", which is a wrong answer for e^(x^2)')
suite.skip('A very large CAS expression stops by itself after the time limit', 'heavy CAS problem', 'Stops with a clear message', 'Needs the CAS worker and the running app')
suite.skip('Running a heavy CAS problem while using the rest of the app', 'heavy CAS + other tools', 'The rest of the app does not freeze', 'Needs the running app')
suite.skip('Rendered math looks right and can be copied', 'rendered result', 'Fractions, exponents, roots render and copy', 'Needs the rendered panel')

finish(suite)
