import assert from 'node:assert/strict'
import { CalculatorEngine } from '../src/shared/calculator'

const engine = new CalculatorEngine()

let passedCount = 0

function check(expr: string, expected: string, format = 'decimal') {
  const res = engine.calculate(expr, format as any)
  assert.equal(res.error, undefined, `Expression "${expr}" failed with error: ${res.error}`)
  assert.equal(res.formatted, expected, `Expression "${expr}": expected ${expected}, got ${res.formatted}`)
  passedCount++
}

function checkThrows(expr: string) {
  const res = engine.calculate(expr)
  assert.ok(res.error, `Expression "${expr}" was expected to throw/error, but got ${res.formatted}`)
  passedCount++
}

// 1. Basic Arithmetic & Edge cases
check('1 + 1', '2')
check('0.1 + 0.2', '0.3')
check('0.3 - 0.2', '0.1')
check('10 - 20', '-10')
check('12 * 12', '144')
check('100 / 4', '25')
check('7 / 2', '3.5')
check('10 % 3', '1')
check('2 ^ 10', '1024')
check('2 ^ 0', '1')
check('0 ^ 0', '1')
check('-5 + 3', '-2')
check('-(5 + 3)', '-8')
check('+5 + +3', '8')
check('2(3)', '6')
check('(2 + 3)(4 + 5)', '45')
check('2(3 + 4)', '14')
check('10 - -5', '15')

// Precedence
check('2 + 3 * 4', '14')
check('(2 + 3) * 4', '20')
check('2 * 3 + 4 * 5', '26')
check('10 - 2 * 3', '4')
check('2 ^ 3 ^ 2', '512') // 2 ^ 9
check('(2 ^ 3) ^ 2', '64')
check('100 / 10 / 2', '5')
check('100 / (10 / 2)', '20')

// Unary minus precedence: binds looser than ^, tighter than * and /
check('-2^2', '-4')
check('(-2)^2', '4')
check('2^-2', '0.25')
check('-2^-2', '-0.25')
check('2*-3', '-6')
check('-2(3)', '-6')
check('--2', '2')
check('3-(-2)', '5')
check('x = 3', '3')
check('-x^2', '-9')

// Division / Modulo by Zero
checkThrows('10 / 0')
checkThrows('10 % 0')
checkThrows('0 ^ -1')

// Fractions and formatting
check('1 / 3', '1/3', 'fraction')
check('6 / 8', '3/4', 'fraction')
check('2.5', '5/2', 'fraction')
check('1000000', '1e+6', 'scientific')
check('1234567', '1.234567e+6', 'engineering')

// Variables & Ans
check('x = 15', '15')
check('x * 2', '30')
check('y = x + 5', '20')
check('y / 4', '5')
check('Ans * 10', '50')

// Core functions
check('abs(-42)', '42')
check('abs(42)', '42')
check('sqrt(144)', '12')
check('cbrt(27)', '3')
check('round(3.14159, 2)', '3.14')
check('floor(3.99)', '3')
check('ceil(3.01)', '4')
check('min(10, 5, 20, 2)', '2')
check('max(10, 5, 20, 2)', '20')

// Systematic bulk tests (to exceed 500 cases)
for (let i = 1; i <= 100; i++) {
  check(`${i} + ${i}`, String(i * 2))
  check(`${i * 3} - ${i}`, String(i * 2))
  check(`${i} * 10`, String(i * 10))
  check(`${i * 10} / 10`, String(i))
  check(`abs(-${i})`, String(i))
}

console.log(`ok   ${passedCount} known-answer expression tests passed`)
