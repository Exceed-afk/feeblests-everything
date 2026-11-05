import assert from 'node:assert/strict'
import { CalculatorEngine } from '../src/shared/calculator'

const engine = new CalculatorEngine()

// Degree mode (default)
engine.setAngleMode('deg')
assert.equal(engine.calculate('sin(0)').formatted, '0')
assert.equal(engine.calculate('sin(90)').formatted, '1')
assert.equal(engine.calculate('cos(0)').formatted, '1')
assert.equal(engine.calculate('cos(180)').formatted, '-1')
assert.equal(engine.calculate('tan(45)').formatted, '1')
assert.equal(engine.calculate('asin(1)').formatted, '90')
assert.equal(engine.calculate('acos(1)').formatted, '0')
assert.equal(engine.calculate('atan(1)').formatted, '45')

// Radian mode
engine.setAngleMode('rad')
assert.equal(engine.calculate('sin(pi / 2)').formatted, '1')
assert.equal(engine.calculate('cos(pi)').formatted, '-1')
assert.equal(engine.calculate('tan(pi / 4)').formatted, '1')

// Gradian mode
engine.setAngleMode('grad')
assert.equal(engine.calculate('sin(100)').formatted, '1')
assert.equal(engine.calculate('cos(200)').formatted, '-1')

// Logs and Exponentials
assert.equal(engine.calculate('ln(e)').formatted, '1')
assert.equal(engine.calculate('log10(100)').formatted, '2')
assert.equal(engine.calculate('log10(1000)').formatted, '3')
assert.equal(engine.calculate('log2(8)').formatted, '3')
assert.equal(engine.calculate('log2(1024)').formatted, '10')
assert.equal(engine.calculate('exp(0)').formatted, '1')

// Combinatorics & Number Theory
assert.equal(engine.calculate('fact(0)').formatted, '1')
assert.equal(engine.calculate('fact(5)').formatted, '120')
assert.equal(engine.calculate('fact(10)').formatted, '3628800')
assert.equal(engine.calculate('gcd(24, 36)').formatted, '12')
assert.equal(engine.calculate('gcd(17, 13)').formatted, '1')
assert.equal(engine.calculate('lcm(4, 6)').formatted, '12')
assert.equal(engine.calculate('nPr(5, 2)').formatted, '20')
assert.equal(engine.calculate('nCr(5, 2)').formatted, '10')
assert.equal(engine.calculate('nCr(10, 3)').formatted, '120')

console.log('ok   calc-scientific known-answers and angle-mode tests passed')
