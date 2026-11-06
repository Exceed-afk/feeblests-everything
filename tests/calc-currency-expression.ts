// Currency syntax in the expression bar: `100 USD to EUR` / `100 usd in eur`.
// The conversion itself is rates.ts (the Convert panel's code); these tests check
// the parser, the evaluator wiring, the display form and the error messages.
import assert from 'node:assert/strict'
import { CalculatorEngine } from '../src/shared/calculator'
import { parse } from '../src/shared/calculator/parser'
import { Decimal } from '../src/shared/calculator/numeric'
import { formatCurrencyResult, looksLikeCurrencyConversion, loadCurrencyContext } from '../src/shared/calculator/currencyExpression'
import type { CurrencyContext } from '../src/shared/calculator/evaluator'
import type { CalcRate, CalcRateSet } from '../src/shared/calculator/types'
import { MockStorageAdapter } from './calc-adapters'

let checks = 0
const ok = () => { checks++ }

const set: CalcRateSet = { id: 'default', name: 'Default Rates', baseCurrency: 'USD', isActive: true, updatedAt: '2026-11-01T00:00:00.000Z' }
const rate = (code: string, rateToBase: string): CalcRate => ({
  id: code,
  rateSetId: 'default',
  currencyCode: code,
  rateToBase,
  updatedAt: '2026-11-01T00:00:00.000Z'
})
// Base USD: 1 USD = 0.92 EUR, 1 USD = 150 JPY.
const ctx: CurrencyContext = {
  rateSet: set,
  rates: [rate('EUR', '0.92'), rate('JPY', '150')],
  overrides: [],
  baseCurrency: 'USD',
  staleRateDays: 7,
  today: '2026-11-05T12:00:00.000Z'
}

const engine = new CalculatorEngine()
engine.setCurrencyContext(ctx)

// ---------- 1. Normal conversion ----------
const r1 = engine.calculate('100 USD to EUR')
assert.equal(r1.error, undefined, `100 USD to EUR should work, got ${r1.error}`); ok()
assert.equal(r1.value.toString(), '92'); ok()
assert.equal(r1.currency, 'EUR', 'the result carries its code'); ok()
assert.equal(formatCurrencyResult(r1.value, r1.currency!, 2), '92.00 EUR'); ok()

// `in` is accepted as well as `to`.
const r2 = engine.calculate('100 usd in eur')
assert.equal(r2.error, undefined); ok()
assert.equal(r2.value.toString(), '92'); ok()

// Uppercase and lowercase codes are the same currency.
const upper = engine.calculate('50 USD TO EUR')
const lower = engine.calculate('50 usd to eur')
assert.equal(upper.value.toString(), lower.value.toString()); ok()
assert.equal(upper.currency, 'EUR'); ok()

// An expression before the code still works: (50 + 50) USD to EUR.
const r3 = engine.calculate('(50 + 50) USD to EUR')
assert.equal(r3.error, undefined, `(50 + 50) USD to EUR should work, got ${r3.error}`); ok()
assert.equal(r3.value.toString(), '92'); ok()

// Cross rate through the base: 100 EUR to JPY = 100 / 0.92 * 150.
const r4 = engine.calculate('100 EUR to JPY')
assert.equal(r4.error, undefined); ok()
assert.ok(Math.abs(r4.value.toNumber() - (100 / 0.92) * 150) < 1e-9, `cross rate, got ${r4.value}`); ok()

// ---------- 2. Same-currency conversion ----------
const same = engine.calculate('100 USD to USD')
assert.equal(same.error, undefined); ok()
assert.equal(same.value.toString(), '100'); ok()
assert.equal(same.currency, 'USD'); ok()

// ---------- 3. Ans stores the number only ----------
engine.calculate('100 USD to EUR')
assert.equal(engine.getAns().toString(), '92', 'Ans holds the number, not the code'); ok()
const chained = engine.calculate('ans + 8')
assert.equal(chained.value.toString(), '100'); ok()

// ---------- 4. Unknown code names the code ----------
const unknown = engine.calculate('100 USD to XYZ')
assert.ok(unknown.error, 'an unknown code is an error'); ok()
assert.match(unknown.error!, /XYZ/, 'the error names the code'); ok()
assert.match(unknown.error!, /Unknown currency code/); ok()

// ---------- 5. Missing rate is a clear error ----------
// GBP is a valid code but has no rate in this set: the error names it.
const missing = engine.calculate('100 GBP to EUR')
assert.ok(missing.error, 'a missing rate is an error'); ok()
assert.match(missing.error!, /GBP/); ok()

// A code that IS in the set but whose rate is unusable (zero) is a missing rate.
const zeroEngine = new CalculatorEngine()
zeroEngine.setCurrencyContext({ ...ctx, rates: [rate('EUR', '0.92'), rate('JPY', '0')] })
const zeroRate = zeroEngine.calculate('100 USD to JPY')
assert.ok(zeroRate.error, 'a zero rate is an error'); ok()
assert.match(zeroRate.error!, /Missing rate|zero/i); ok()

// No rates loaded at all: a clear message, not a wrong number.
const bare = new CalculatorEngine()
const noRates = bare.calculate('100 USD to EUR')
assert.ok(noRates.error); ok()
assert.match(noRates.error!, /offline rates/); ok()

// ---------- 6. `to` and `in` do not clash with names ----------
// `in` is a unit id in the length category, but as a bare identifier it is still
// just an identifier: `2 in` is implicit multiplication of an unknown variable.
const inVar = engine.calculate('2 in')
assert.ok(inVar.error, '`2 in` is not a conversion (no code after it)'); ok()
// A function named `to`-like is untouched: `tan(45)` still parses as a call.
const tan = engine.calculate('tan(45)')
assert.equal(tan.error, undefined); ok()
// `x to y` with 1-character names is not a conversion (codes are 3-5 characters).
const short = engine.calculate('2 x to y')
assert.ok(short.error, '1-character names are not currency codes'); ok()
// A variable named `to` still works as a variable.
engine.setVariable('to', new Decimal(5))
const toVar = engine.calculate('to + 1')
assert.equal(toVar.value.toString(), '6'); ok()

// ---------- 7. Parser shape ----------
const ast = parse('100 USD to EUR')
assert.equal(ast.type, 'CurrencyConversion'); ok()
if (ast.type === 'CurrencyConversion') {
  assert.equal(ast.from, 'USD'); ok()
  assert.equal(ast.to, 'EUR'); ok()
  assert.equal(ast.amount.type, 'Number'); ok()
}
const astIn = parse('(50 + 50) usd in eur')
assert.equal(astIn.type, 'CurrencyConversion'); ok()
if (astIn.type === 'CurrencyConversion') {
  assert.equal(astIn.amount.type, 'BinaryOp'); ok()
  assert.equal(astIn.from, 'USD'); ok()
  assert.equal(astIn.to, 'EUR'); ok()
}

// ---------- 8. Display helpers ----------
assert.equal(formatCurrencyResult(new Decimal('92.314'), 'EUR', 2), '92.31 EUR'); ok()
assert.equal(formatCurrencyResult(new Decimal('92.315'), 'EUR', 2), '92.32 EUR'); ok()
assert.ok(looksLikeCurrencyConversion('100 USD to EUR')); ok()
assert.ok(looksLikeCurrencyConversion('100 usd in eur')); ok()
assert.ok(!looksLikeCurrencyConversion('2 + 2')); ok()

// ---------- 9. Loading the context from storage ----------
async function runAsync() {
  const adapter = new MockStorageAdapter()
  const loaded = await loadCurrencyContext(adapter)
  assert.ok(loaded, 'a default rate set is always present'); ok()
  assert.equal(loaded!.rateSet.id, 'default'); ok()
  assert.equal(loaded!.baseCurrency, 'USD'); ok()
  assert.ok(Array.isArray(loaded!.rates)); ok()
  console.log(`ok   ${checks} currency expression checks passed`)
}

void runAsync()
