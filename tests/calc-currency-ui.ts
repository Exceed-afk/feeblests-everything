import assert from 'node:assert/strict'
import { performCurrencyConversion } from '../src/shared/calculator/rates'
import {
  buildCurrencyHistoryItem,
  readCurrencyHistoryItem,
  sortRatesForDisplay,
  formatRateDate,
  describeDays,
  isDefaultRateSet,
  DEFAULT_DISPLAY_DECIMALS
} from '../src/shared/calculator/currencyUi'
import { Decimal } from '../src/shared/calculator/numeric'
import type { CalcRate, CalcRateSet } from '../src/shared/calculator/types'

let checks = 0
const ok = () => { checks++ }

// ---- Display formatting -----------------------------------------------------
assert.equal(formatRateDate('2026-11-04T14:30:00.000Z').length, 10); ok()
assert.equal(formatRateDate('not a date'), 'unknown'); ok()
assert.equal(describeDays(0), '0 days old'); ok()
assert.equal(describeDays(1), '1 day old'); ok()
assert.equal(describeDays(8), '8 days old'); ok()
assert.equal(describeDays(null), 'unknown age'); ok()

// ---- Ordering --------------------------------------------------------------
const rates: CalcRate[] = [
  { id: '1', rateSetId: 'default', currencyCode: 'GBP', rateToBase: '0.79', updatedAt: '2026-11-01T00:00:00Z' },
  { id: '2', rateSetId: 'default', currencyCode: 'USD', rateToBase: '1', updatedAt: '2026-11-01T00:00:00Z' },
  { id: '3', rateSetId: 'default', currencyCode: 'EUR', rateToBase: '0.92', updatedAt: '2026-11-01T00:00:00Z' }
]
assert.deepEqual(sortRatesForDisplay(rates, 'USD').map((r) => r.currencyCode), ['USD', 'EUR', 'GBP']); ok()
assert.equal(isDefaultRateSet({ id: 'default' }), true); ok()
assert.equal(isDefaultRateSet({ id: 'travel' }), false); ok()

// ---- Currency history round trip ------------------------------------------
const set: CalcRateSet = { id: 'default', name: 'Default', baseCurrency: 'USD', isActive: true, updatedAt: '2026-11-01T00:00:00Z' }
const conv = performCurrencyConversion({
  amount: new Decimal('100'),
  from: 'EUR',
  to: 'JPY',
  targetSet: set,
  rates: [
    { id: '1', rateSetId: 'default', currencyCode: 'EUR', rateToBase: '0.92', updatedAt: '2026-11-02T00:00:00Z' },
    { id: '2', rateSetId: 'default', currencyCode: 'JPY', rateToBase: '150.0', updatedAt: '2026-10-20T00:00:00Z' }
  ],
  overrides: [],
  baseCurrency: 'USD',
  staleRateDays: 7,
  today: '2026-11-04T00:00:00Z'
})

assert.equal(conv.result, new Decimal('100').times(new Decimal('150.0').dividedBy(new Decimal('0.92'))).toString()); ok()
assert.equal(conv.isStale, true); ok()
assert.equal(conv.oldestRateAgeDays, 15); ok()

const historyInput = buildCurrencyHistoryItem({
  amount: '100',
  from: 'EUR',
  to: 'JPY',
  set: set.id,
  rate: conv.rate,
  rates: conv.snapshot.ratesUsed,
  override: conv.isDirectOverride,
  stale: conv.isStale,
  age: conv.oldestRateAgeDays,
  result: conv.result,
  decimals: DEFAULT_DISPLAY_DECIMALS
})
assert.equal(historyInput.mode, 'currency'); ok()
assert.equal(historyInput.input, '100 EUR → JPY'); ok()
assert.equal(historyInput.result, conv.result, 'history keeps the exact, unrounded result'); ok()

const back = readCurrencyHistoryItem({
  id: '1',
  createdAt: '2026-11-04T00:00:00Z',
  mode: historyInput.mode,
  input: historyInput.input,
  result: historyInput.result,
  resultFormat: historyInput.resultFormat,
  rateSnapshot: historyInput.rateSnapshot
})
assert.ok(back, 'currency row is readable again'); ok()
assert.equal(back!.from, 'EUR'); ok()
assert.equal(back!.to, 'JPY'); ok()
assert.equal(back!.set, 'default'); ok()
assert.equal(back!.rate, conv.rate); ok()
assert.equal(back!.override, false); ok()
assert.equal(back!.stale, true); ok()
assert.equal(back!.age, 15); ok()
assert.equal(back!.rates.length, 2); ok()

// Non-currency history (no snapshot) and a plain expression snapshot are ignored
assert.equal(readCurrencyHistoryItem({
  id: '2', createdAt: '', mode: 'standard', input: '1+1', result: '2', resultFormat: 'decimal'
}), null); ok()
assert.equal(readCurrencyHistoryItem({
  id: '3', createdAt: '', mode: 'standard', input: '1+1', result: '2', resultFormat: 'decimal',
  rateSnapshot: '{not json'
}), null); ok()

// ---- Override conversions are flagged --------------------------------------
const overridden = performCurrencyConversion({
  amount: new Decimal('50'),
  from: 'EUR',
  to: 'GBP',
  targetSet: set,
  rates: [
    { id: '1', rateSetId: 'default', currencyCode: 'EUR', rateToBase: '0.92', updatedAt: '2026-11-02T00:00:00Z' },
    { id: '2', rateSetId: 'default', currencyCode: 'GBP', rateToBase: '0.79', updatedAt: '2026-11-02T00:00:00Z' }
  ],
  overrides: [{ id: '9', rateSetId: 'default', fromCode: 'EUR', toCode: 'GBP', rate: '0.88', updatedAt: '2026-11-04T00:00:00Z' }],
  baseCurrency: 'USD',
  staleRateDays: 7,
  today: '2026-11-04T00:00:00Z'
})
assert.equal(overridden.result, '44'); ok()
assert.equal(overridden.isDirectOverride, true); ok()
const overriddenRow = buildCurrencyHistoryItem({
  amount: '50', from: 'EUR', to: 'GBP', set: set.id, rate: overridden.rate,
  rates: overridden.snapshot.ratesUsed, override: true, stale: false, age: null,
  result: overridden.result, decimals: 2
})
const overriddenBack = readCurrencyHistoryItem({
  id: '4', createdAt: '', mode: overriddenRow.mode, input: overriddenRow.input,
  result: overriddenRow.result, resultFormat: overriddenRow.resultFormat, rateSnapshot: overriddenRow.rateSnapshot
})
assert.equal(overriddenBack!.override, true); ok()

console.log(`ok   ${checks} currency UI helper tests passed`)
