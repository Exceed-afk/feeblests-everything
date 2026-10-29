import assert from 'node:assert/strict'
import { asPercentage, calculateAge, compoundInterest, convertCurrency, convertUnit, dateDifferenceDays, loanPayment, percentChange, percentOf, tipSplit } from '../src/shared/calculators'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }
const close = (actual: number | null, expected: number, tolerance = 0.000001) =>
  assert.ok(actual !== null && Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`)

test('loan payments handle standard and zero-interest loans', () => {
  close(loanPayment(12000, 0, 12), 1000)
  close(loanPayment(10000, 6, 12), 860.664297)
  close(loanPayment(10000, 6, 18), 582.317305)
  assert.equal(loanPayment(10000, -1, 12), null)
  assert.equal(loanPayment(10000, 5, 0), null)
  assert.equal(loanPayment(10000, 5, 1.5), null)
})

test('compound interest handles compounding and invalid inputs', () => {
  assert.deepEqual(compoundInterest(1000, 10, 1, 1), { total: 1100, interest: 100 })
  close(compoundInterest(1000, 12, 1, 12)?.total ?? null, 1126.825030)
  assert.equal(compoundInterest(1000, 5, 1, 0), null)
})

test('tip split validates people and calculates equal shares', () => {
  assert.deepEqual(tipSplit(100, 20, 4), { tip: 20, total: 120, perPerson: 30 })
  assert.equal(tipSplit(100, 20, 0), null)
  assert.equal(tipSplit(100, 20, 1.5), null)
})

test('percentage operations cover percent-of, change, and ratio', () => {
  assert.equal(percentOf(200, 15), 30)
  assert.equal(percentChange(80, 100), 25)
  assert.equal(percentChange(0, 10), null)
  assert.equal(asPercentage(30, 200), 15)
  assert.equal(asPercentage(1, 0), null)
})

test('unit conversion supports factors and temperature scales', () => {
  close(convertUnit(1, 'length', 'km', 'mi'), 0.621371192)
  close(convertUnit(32, 'temperature', 'f', 'c'), 0)
  close(convertUnit(0, 'temperature', 'c', 'k'), 273.15)
  assert.equal(convertUnit(1, 'length', 'km', 'unknown'), null)
  assert.equal(convertUnit(-1, 'temperature', 'k', 'c'), null)
})

test('currency conversion requires a positive user-provided rate', () => {
  assert.equal(convertCurrency(100, 0.92), 92)
  assert.equal(convertCurrency(100, 0), null)
})

test('date difference is absolute and rejects invalid calendar dates', () => {
  assert.equal(dateDifferenceDays('2026-10-01', '2026-10-27'), 26)
  assert.equal(dateDifferenceDays('2026-10-27', '2026-10-01'), 26)
  assert.equal(dateDifferenceDays('2026-02-30', '2026-03-01'), null)
})

test('age calculation returns calendar years, months and days including leap-day birthdays', () => {
  assert.deepEqual(calculateAge('2000-01-15', '2026-10-27'), { years: 26, months: 9, days: 12 })
  assert.deepEqual(calculateAge('2000-10-27', '2026-10-27'), { years: 26, months: 0, days: 0 })
  assert.deepEqual(calculateAge('2000-02-29', '2021-02-28'), { years: 21, months: 0, days: 0 })
  assert.equal(calculateAge('2026-10-28', '2026-10-27'), null)
})

console.log(`\n${n} calculator checks passed`)
