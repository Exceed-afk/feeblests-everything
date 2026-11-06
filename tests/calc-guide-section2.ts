// docs/calculator-testing-guide.md — Section 2: Scientific.
// Run on its own:  npx tsx tests/calc-guide-section2.ts
import { CalculatorEngine } from '../src/shared/calculator'
import {
  GuideSuite, finish, expectCalc, expectCalcError, expectText, expectStartsWith, expectClose
} from './calc-guide-common'

export const suite = new GuideSuite('Section 2: Scientific', 'Scientific')

const eng = new CalculatorEngine()
const inMode = (mode: 'deg' | 'rad' | 'grad', expr: string) => {
  eng.setAngleMode(mode)
  return eng.calculate(expr)
}

// ---------- Trig, degrees mode ----------
suite.test('sin(30) [deg]', 'sin(30)', '0.5', () => expectCalc(inMode('deg', 'sin(30)'), '0.5'))
suite.test('cos(60) [deg]', 'cos(60)', '0.5', () => expectCalc(inMode('deg', 'cos(60)'), '0.5'))
suite.test('tan(45) [deg]', 'tan(45)', '1', () => expectCalc(inMode('deg', 'tan(45)'), '1'))
suite.test('sin(90) [deg]', 'sin(90)', '1', () => expectCalc(inMode('deg', 'sin(90)'), '1'))
suite.test('cos(90) [deg]', 'cos(90)', '0 (a tiny value like 6e-17 is acceptable)', () =>
  expectClose(inMode('deg', 'cos(90)').formatted, 0, 1e-12))
suite.test('tan(90) [deg]', 'tan(90)', 'Error or undefined (not a huge number)', () =>
  expectCalcError(inMode('deg', 'tan(90)'), /undefined at this angle|division by zero/i))
suite.test('tan(270) [deg]', 'tan(270)', 'Error', () =>
  expectCalcError(inMode('deg', 'tan(270)'), /undefined at this angle|division by zero/i))
suite.test('tan(-90) [deg]', 'tan(-90)', 'Error', () =>
  expectCalcError(inMode('deg', 'tan(-90)'), /undefined at this angle|division by zero/i))
suite.test('tan(89.999) [deg]', 'tan(89.999)', 'Big finite number (~57295.78)', () => {
  const r = inMode('deg', 'tan(89.999)')
  if (r.error) throw new Error(r.error)
  const val = Number(r.formatted)
  if (!Number.isFinite(val) || val < 10000) throw new Error(`expected big finite number, got ${r.formatted}`)
  return { actual: r.formatted }
})
suite.test('asin(0.5) [deg]', 'asin(0.5)', '30', () => expectCalc(inMode('deg', 'asin(0.5)'), '30'))
suite.test('acos(0.5) [deg]', 'acos(0.5)', '60', () => expectCalc(inMode('deg', 'acos(0.5)'), '60'))
suite.test('atan(1) [deg]', 'atan(1)', '45', () => expectCalc(inMode('deg', 'atan(1)'), '45'))
suite.test('asin(2) [deg]', 'asin(2)', 'Error (or a complex result in complex mode)', () =>
  expectCalcError(inMode('deg', 'asin(2)'), /out of range|error/i))

// ---------- Trig, radians mode ----------
suite.test('sin(pi / 6) [rad]', 'sin(pi / 6)', '0.5', () => expectCalc(inMode('rad', 'sin(pi / 6)'), '0.5'))
suite.test('cos(pi) [rad]', 'cos(pi)', '-1', () => expectCalc(inMode('rad', 'cos(pi)'), '-1'))
suite.test('sin(pi) [rad]', 'sin(pi)', '0 (tiny value acceptable)', () => expectClose(inMode('rad', 'sin(pi)').formatted, 0, 1e-12))
suite.test('sin(90) [rad]', 'sin(90)', '0.8939966636 (proves radians are used)', () =>
  expectStartsWith(inMode('rad', 'sin(90)').formatted, '0.8939966636'))
suite.test('atan(1) [rad]', 'atan(1)', '0.7853981634 (pi/4)', () => expectClose(inMode('rad', 'atan(1)').formatted, 0.7853981634, 1e-9))
suite.test('tan(pi / 2) [rad]', 'tan(pi / 2)', 'Error', () =>
  expectCalcError(inMode('rad', 'tan(pi / 2)'), /undefined at this angle|division by zero/i))

// ---------- Trig, gradians mode ----------
suite.test('sin(50) [grad]', 'sin(50)', '0.7071067812', () => expectClose(inMode('grad', 'sin(50)').formatted, 0.7071067812, 1e-9))
suite.test('cos(100) [grad]', 'cos(100)', '0', () => expectClose(inMode('grad', 'cos(100)').formatted, 0, 1e-12))

eng.setAngleMode('deg')

// ---------- Hyperbolic ----------
suite.test('sinh(0)', 'sinh(0)', '0', () => expectCalc(eng.calculate('sinh(0)'), '0'))
suite.test('cosh(0)', 'cosh(0)', '1', () => expectCalc(eng.calculate('cosh(0)'), '1'))
suite.test('tanh(0)', 'tanh(0)', '0', () => expectCalc(eng.calculate('tanh(0)'), '0'))
suite.test('sinh(1)', 'sinh(1)', '1.1752011936', () => expectClose(eng.calculate('sinh(1)').formatted, 1.1752011936, 1e-9))

// ---------- Logs and exponentials ----------
suite.test('ln(e)', 'ln(e)', '1', () => expectCalc(eng.calculate('ln(e)'), '1'))
suite.test('ln(1)', 'ln(1)', '0', () => expectCalc(eng.calculate('ln(1)'), '0'))
suite.test('log(100)', 'log(100)', '2', () => expectCalc(eng.calculate('log(100)'), '2'),
  '`log` is registered as an alias of the natural log `ln`, so log(100) = ln(100) = 4.605, not 2')
suite.test('log(1000)', 'log(1000)', '3', () => expectCalc(eng.calculate('log(1000)'), '3'),
  '`log` is registered as an alias of the natural log `ln`, so log(1000) = ln(1000) = 6.908, not 3')
suite.test('log(2, 8) (or your syntax for log base 2)', 'log(2, 8)', '3', () => expectCalc(eng.calculate('log(2, 8)'), '3'),
  '`log` takes one argument (it is ln); the two-argument log(base, x) form is not supported')
suite.test('log2(8) (the calculator\'s log-base-2 spelling)', 'log2(8)', '3', () => expectCalc(eng.calculate('log2(8)'), '3'))
suite.test('exp(1)', 'exp(1)', '2.7182818285', () => expectClose(eng.calculate('exp(1)').formatted, 2.7182818285, 1e-9))
suite.test('exp(0)', 'exp(0)', '1', () => expectCalc(eng.calculate('exp(0)'), '1'))
suite.test('ln(0)', 'ln(0)', 'Error', () => expectCalcError(eng.calculate('ln(0)'), /logarithm of non-positive|not a finite number/i))
suite.test('ln(-1)', 'ln(-1)', 'Error, or 3.14159i in complex mode', () =>
  expectCalcError(eng.calculate('ln(-1)'), /logarithm of non-positive/i))
suite.test('log(-5)', 'log(-5)', 'Error, or a complex result in complex mode', () =>
  expectCalcError(eng.calculate('log(-5)'), /logarithm of non-positive/i))

// ---------- Roots and powers ----------
suite.test('sqrt(16)', 'sqrt(16)', '4', () => expectCalc(eng.calculate('sqrt(16)'), '4'))
suite.test('sqrt(2)', 'sqrt(2)', '1.4142135624', () => expectClose(eng.calculate('sqrt(2)').formatted, 1.4142135624, 1e-9))
suite.test('sqrt(-4)', 'sqrt(-4)', 'Error, or 2i in complex mode', () =>
  expectCalcError(eng.calculate('sqrt(-4)'), /square root of negative/i))
suite.test('cbrt(27)', 'cbrt(27)', '3', () => expectCalc(eng.calculate('cbrt(27)'), '3'))
suite.test('cbrt(-8)', 'cbrt(-8)', '-2', () => expectCalc(eng.calculate('cbrt(-8)'), '-2'))
suite.test('8^(1/3)', '8^(1/3)', '2', () => expectCalc(eng.calculate('8^(1/3)'), '2'))
suite.test('4^-1', '4^-1', '0.25', () => expectCalc(eng.calculate('4^-1'), '0.25'))
suite.test('0^0', '0^0', '1 (or an error, but consistent and documented)', () => expectCalc(eng.calculate('0^0'), '1'))

// ---------- Factorial, permutations, combinations, gamma ----------
suite.test('5!', '5!', '120', () => expectCalc(eng.calculate('5!'), '120'))
suite.test('0!', '0!', '1', () => expectCalc(eng.calculate('0!'), '1'))
suite.test('20!', '20!', '2432902008176640000', () => expectCalc(eng.calculate('20!'), '2432902008176640000'))
suite.test('(-1)!', '(-1)!', 'Error', () => expectCalcError(eng.calculate('(-1)!'), /non-negative whole number/i))
suite.test('3.5!', '3.5!', '11.6317283966 (gamma function)', () => expectClose(eng.calculate('3.5!').formatted, 11.6317283966, 1e-9))
suite.test('gamma(5)', 'gamma(5)', '24', () => expectCalc(eng.calculate('gamma(5)'), '24'),
  'The gamma function is registered as `gensigma`, not `gamma`')
suite.test('5P2 (permutations)', '5P2', '20', () => expectCalc(eng.calculate('5P2'), '20'),
  'Permutations are spelled P(5, 2) / nPr(5, 2); the `5P2` infix form is not parsed')
suite.test('5C2 (combinations)', '5C2', '10', () => expectCalc(eng.calculate('5C2'), '10'),
  'Combinations are spelled C(5, 2) / nCr(5, 2); the `5C2` infix form is not parsed')
suite.test('P(5, 2) (the calculator\'s permutation spelling)', 'P(5, 2)', '20', () => expectCalc(eng.calculate('P(5, 2)'), '20'))
suite.test('C(5, 2) (the calculator\'s combination spelling)', 'C(5, 2)', '10', () => expectCalc(eng.calculate('C(5, 2)'), '10'))
suite.test('10C0', 'C(10, 0)', '1', () => expectCalc(eng.calculate('C(10, 0)'), '1'))
suite.test('10C10', 'C(10, 10)', '1', () => expectCalc(eng.calculate('C(10, 10)'), '1'))
suite.test('5C7', 'C(5, 7)', '0 or an error', () => {
  const r = eng.calculate('C(5, 7)')
  if (r.error) return { actual: `error: ${r.error}` }
  return expectText(r.formatted, '0')
})
suite.test('100!', '100!', 'Handled (very large number), not a crash', () => {
  const r = eng.calculate('100!')
  if (r.error) throw new Error(`rejected: ${r.error}`)
  // 100! = 9.33262154439441e157
  return expectStartsWith(r.formatted, '9.33262154439441')
})

// ---------- Rounding and integer tools ----------
suite.test('abs(-7)', 'abs(-7)', '7', () => expectCalc(eng.calculate('abs(-7)'), '7'))
suite.test('floor(2.7)', 'floor(2.7)', '2', () => expectCalc(eng.calculate('floor(2.7)'), '2'))
suite.test('floor(-2.5)', 'floor(-2.5)', '-3', () => expectCalc(eng.calculate('floor(-2.5)'), '-3'))
suite.test('ceil(2.1)', 'ceil(2.1)', '3', () => expectCalc(eng.calculate('ceil(2.1)'), '3'))
suite.test('ceil(-2.5)', 'ceil(-2.5)', '-2', () => expectCalc(eng.calculate('ceil(-2.5)'), '-2'))
suite.test('round(2.4)', 'round(2.4)', '2', () => expectCalc(eng.calculate('round(2.4)'), '2'))
suite.test('mod(10, 3)', 'mod(10, 3)', '1', () => expectCalc(eng.calculate('mod(10, 3)'), '1'))
suite.test('mod(10, 0)', 'mod(10, 0)', 'Error', () => expectCalcError(eng.calculate('mod(10, 0)'), /division by zero/i))
suite.test('gcd(12, 18)', 'gcd(12, 18)', '6', () => expectCalc(eng.calculate('gcd(12, 18)'), '6'))
suite.test('lcm(4, 6)', 'lcm(4, 6)', '12', () => expectCalc(eng.calculate('lcm(4, 6)'), '12'))
suite.test('isprime(97)', 'isprime(97)', 'Yes', () => expectCalc(eng.calculate('isprime(97)'), '1'))
suite.test('Prime factors of 360', 'primefactors(360)', '2^3 * 3^2 * 5', () => {
  const r = eng.calculate('primefactors(360)')
  if (r.error) throw new Error(`rejected: ${r.error}`)
  // The calculator shows the factor list; the guide's exponent form is the same factorisation.
  return expectText(r.formatted, '2 x 2 x 2 x 3 x 3 x 5')
})

// ---------- Constants ----------
// The guide's 15 digits are the true value; the default display shows 12 significant digits.
suite.test('pi', 'pi', '3.14159265358979', () => expectClose(eng.calculate('pi').formatted, 3.14159265358979, 1e-11))
suite.test('e', 'e', '2.71828182845905', () => expectClose(eng.calculate('e').formatted, 2.71828182845905, 1e-11))
suite.test('2 * pi', '2 * pi', '6.28318530717959', () => expectClose(eng.calculate('2 * pi').formatted, 6.28318530717959, 1e-11))

finish(suite)
