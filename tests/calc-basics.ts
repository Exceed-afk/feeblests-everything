// Roadmap Section 1 + 2: bugs and missing basics of the bar and keypad.
// Covers number validation, Google-style percent, Ans/chaining support in the engine,
// mod, prime tools, the C/P aliases, gamma factorial and yRoot.
import assert from 'node:assert/strict'
import { CalculatorEngine, parse } from '../src/shared/calculator'
import { CALC_LIMITS } from '../src/shared/calculator/limits'
import { primeFactorsOf, primeFactorsString, isPrimeNumber } from '../src/shared/calculator/modules/scientific'

function testNumberValidation() {
  const eng = new CalculatorEngine()
  // The normal case still parses.
  assert.equal(eng.calculate('2.5').formatted, '2.5')
  assert.equal(eng.calculate('.5').formatted, '0.5')
  // More than one dot is an error, not a silent answer.
  for (const bad of ['2..3', '1.2.3', '0..', '1.2.3.4']) {
    const r = eng.calculate(bad)
    assert.ok(r.error, `${bad} should be an error, got ${r.formatted}`)
    assert.match(r.error!, /Invalid number/i)
  }
  // The parser (not just the engine) throws.
  assert.throws(() => parse('2..3'), /Invalid number/)
}

function testPercent() {
  const eng = new CalculatorEngine()
  // Standalone postfix percent: divide by 100.
  assert.equal(eng.calculate('50%').formatted, '0.5')
  // a + b% adds a x b/100; a - b% subtracts a x b/100.
  assert.equal(eng.calculate('200 + 10%').formatted, '220')
  assert.equal(eng.calculate('200 - 10%').formatted, '180')
  // After * / the percent is just b/100.
  assert.equal(eng.calculate('50 * 10%').formatted, '5')
  assert.equal(eng.calculate('200 / 50%').formatted, '400')
  // Percent inside a bigger chain: 300 - 10% - 10% is 300 x 0.9 x 0.9 style nesting.
  assert.equal(eng.calculate('(200 + 10%) + 10%').formatted, '242')
  // Edge: decimal percent and percent on the right of an exponent.
  assert.equal(eng.calculate('100 - 2.5%').formatted, '97.5')
  assert.ok(Math.abs(Number(eng.calculate('2 ^ 50%').formatted) - Math.SQRT2) < 1e-9)
  // The modulo operator still works when % sits between two numbers.
  assert.equal(eng.calculate('10 % 3').formatted, '1')
  assert.equal(eng.calculate('100 % 7').formatted, '2')
  // Rejected: a dangling % with no value.
  assert.ok(eng.calculate('%').error)
  assert.ok(eng.calculate('5 + %').error)
}

function testAns() {
  const eng = new CalculatorEngine()
  // Before any result, Ans is 0 (a fresh engine; the ans + 1 case is checked on its own engine below).
  const fresh = new CalculatorEngine()
  assert.equal(fresh.calculate('ans + 1').formatted, '1')
  assert.equal(fresh.calculate('Ans').formatted, '1')
  const fresh2 = new CalculatorEngine()
  assert.equal(fresh2.calculate('Ans').formatted, '0')
  // After `=`, the result is Ans and can be used in the next expression.
  assert.equal(eng.calculate('5 + 5').formatted, '10')
  assert.equal(eng.calculate('ans * 2').formatted, '20')
  assert.equal(eng.calculate('ANS + 1').formatted, '21')
  // An error leaves the previous Ans in place.
  assert.ok(eng.calculate('1/0').error)
  assert.equal(eng.calculate('ans').formatted, '21')
}

function testChainArithmetic() {
  // Chaining is a UI rule, but the arithmetic it produces must be right in the engine:
  // `5 + 5 =` then `* 2 =` is `10 * 2` = 20 (not `5 + 5 * 2` = 15).
  const eng = new CalculatorEngine()
  assert.equal(eng.calculate('10 * 2').formatted, '20')
  // And the old behaviour would have produced this, which must not be what the UI builds:
  assert.notEqual(eng.calculate('5 + 5 * 2').formatted, '20')
}

function testMod() {
  const eng = new CalculatorEngine()
  assert.equal(eng.calculate('mod(10, 3)').formatted, '1')
  // Edge: negatives keep the dividend's sign (same rule as JS %).
  assert.equal(eng.calculate('mod(-10, 3)').formatted, '-1')
  assert.equal(eng.calculate('mod(10, -3)').formatted, '1')
  // Rejected: division by zero.
  assert.match(eng.calculate('mod(10, 0)').error!, /Division by zero/)
  assert.match(eng.calculate('mod(3)').error!, /between 2 and 2 arguments/)
}

function testPrimes() {
  const eng = new CalculatorEngine()
  assert.equal(eng.calculate('isprime(7)').formatted, '1')
  assert.equal(eng.calculate('isprime(60)').formatted, '0')
  assert.equal(eng.calculate('isprime(2)').formatted, '1')
  // primefactors shows the factor list at the top level.
  assert.equal(eng.calculate('primefactors(60)').formatted, '2 x 2 x 3 x 5')
  assert.equal(eng.calculate('primefactors(97)').formatted, '97')
  assert.equal(eng.calculate('primefactors(2)').formatted, '2')
  // Rejected: below 2, non-whole, and over the size limit.
  assert.match(eng.calculate('isprime(1)').error!, /2 or more/)
  assert.match(eng.calculate('isprime(0)').error!, /2 or more/)
  assert.match(eng.calculate('primefactors(2.5)').error!, /whole number/)
  const huge = '9'.repeat(20)
  assert.match(eng.calculate(`primefactors(${huge})`).error!, /prime number is limited/)
  // The pure helpers agree with the registry functions.
  assert.deepEqual(primeFactorsOf(60), [2, 2, 3, 5])
  assert.equal(primeFactorsString(360), '2 x 2 x 2 x 3 x 3 x 5')
  assert.equal(isPrimeNumber(9973), true)
  assert.equal(isPrimeNumber(9973 * 3), false)
  assert.equal(isPrimeNumber(1), false)
  // The limit exists and is enforced (a huge n cannot freeze the app).
  assert.equal(CALC_LIMITS.primeNumberLimit, 10_000_000_000)
}

function testCombinatoricsAliasesAndGamma() {
  const eng = new CalculatorEngine()
  // nCr(10, 0) = 1, so C and P are just short aliases of nCr / nPr.
  assert.equal(eng.calculate('nCr(10, 0)').formatted, '1')
  assert.equal(eng.calculate('C(10, 0)').formatted, '1')
  assert.equal(eng.calculate('C(10, 3)').formatted, '120')
  assert.equal(eng.calculate('P(5, 2)').formatted, '20')
  assert.equal(eng.calculate('P(5, 5)').formatted, '120')
  // Rejected: r larger than n.
  assert.match(eng.calculate('C(3, 5)').error!, /r cannot be larger than n/)
  // Gamma factorial: 3.5! = gamma(4.5) = 11.6317283966 (Google's calculator agrees).
  const r = eng.calculate('3.5!')
  assert.ok(!r.error, `3.5! errored: ${r.error}`)
  assert.ok(Math.abs(Number(r.formatted) - 11.6317283966) < 1e-9, `3.5! = ${r.formatted}`)
  assert.ok(Math.abs(Number(eng.calculate('0.5!').formatted) - 0.8862269255) < 1e-9)
  // Negative whole numbers are poles of gamma: an error, not a number.
  assert.match(eng.calculate('(-1)!').error!, /non-negative whole number/)
  assert.match(eng.calculate('fact(-3)').error!, /non-negative whole number/)

  // Gamma function tests: gamma(5) = 24, gamma(0.5) = sqrt(pi)
  assert.equal(eng.calculate('gamma(5)').formatted, '24')
  const gHalf = Number(eng.calculate('gamma(0.5)').formatted)
  const sqrtPi = Math.sqrt(Math.PI)
  assert.ok(Math.abs(gHalf - sqrtPi) < 1e-9, `gamma(0.5) = ${gHalf} vs sqrt(pi) = ${sqrtPi}`)
  // Old alias gensigma still works
  assert.equal(eng.calculate('gensigma(5)').formatted, '24')
  // gamma(0) and negative integers give a clear error
  assert.match(eng.calculate('gamma(0)').error!, /non-positive integer/i)
  assert.match(eng.calculate('gamma(-1)').error!, /non-positive integer/i)
  assert.match(eng.calculate('gamma(-5)').error!, /non-positive integer/i)
}

function testYRoot() {
  const eng = new CalculatorEngine()
  assert.equal(eng.calculate('yRoot(8, 3)').formatted, '2')
  assert.equal(eng.calculate('yRoot(16, 4)').formatted, '2')
  // Odd root of a negative keeps the sign.
  assert.equal(eng.calculate('yRoot(-27, 3)').formatted, '-3')
  // Rejected: y = 0, and even root of a negative.
  assert.match(eng.calculate('yRoot(16, 0)').error!, /0-th root/)
  assert.match(eng.calculate('yRoot(-16, 2)').error!, /no real even root/)
}

function testTokenizerPostfix() {
  // The tokenizer turns `5!` and `50%` into postfix tokens but leaves `10 % 3` alone.
  const { tokenize } = require('../src/shared/calculator/parser/tokenizer') as {
    tokenize: (s: string) => Array<{ type: string; value: string }>
  }
  assert.deepEqual(tokenize('5!').map((t) => t.type), ['NUMBER', 'BANG', 'EOF'])
  assert.deepEqual(tokenize('50%').map((t) => t.type), ['NUMBER', 'PERCENT_SUFFIX', 'EOF'])
  assert.deepEqual(tokenize('10 % 3').map((t) => t.type), ['NUMBER', 'PERCENT', 'NUMBER', 'EOF'])
}

let passed = 0
for (const t of [
  testNumberValidation,
  testPercent,
  testAns,
  testChainArithmetic,
  testMod,
  testPrimes,
  testCombinatoricsAliasesAndGamma,
  testYRoot,
  testTokenizerPostfix
]) {
  t()
  passed++
  console.log(`ok - ${t.name}`)
}
console.log(`\n${passed} test groups passed`)
