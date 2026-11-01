import assert from 'node:assert/strict'
import {
  comparisonChange, parseAssistantReply, previousRange, resolveRange
} from '../src/shared/assistant'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

test('previousRange creates an equal-length period immediately before a month', () => {
  const month = resolveRange({ kind: 'this_month' }, '2026-10-20')
  assert.deepEqual(month, { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(previousRange(month), { from: '2026-08-31', to: '2026-09-30' })
})

test('previousRange creates the week before a seven-day week', () => {
  const week = resolveRange({ kind: 'this_week' }, '2026-11-01')
  assert.deepEqual(week, { from: '2026-10-26', to: '2026-11-01' })
  assert.deepEqual(previousRange(week), { from: '2026-10-19', to: '2026-10-25' })
})

test('previousRange creates the same number of days before a last-n-days range', () => {
  const range = resolveRange({ kind: 'last_n_days', n: 14 }, '2026-11-01')
  assert.deepEqual(range, { from: '2026-10-19', to: '2026-11-01' })
  assert.deepEqual(previousRange(range), { from: '2026-10-05', to: '2026-10-18' })
})

test('comparison shows a signed improvement and computes percent relative to prior magnitude', () => {
  assert.deepEqual(comparisonChange(120, 90), { change: 30, percent: 33.33333333, direction: 'up' })
  assert.deepEqual(comparisonChange(-5, -10), { change: 5, percent: 50, direction: 'up' })
  assert.deepEqual(comparisonChange(10, 10), { change: 0, percent: 0, direction: 'unchanged' })
})

test('comparison does not divide by zero', () => {
  assert.deepEqual(comparisonChange(20, 0), { change: 20, percent: null, direction: 'up' })
})

test('compare is opt-in and accepts only the previous-period mode', () => {
  const without = parseAssistantReply('{"function":"trade_pnl","range":{"kind":"this_month"}}')
  assert.ok(without.ok)
  assert.equal(without.ok && without.call.kind === 'function' ? without.call.compare : 'none', null)

  const withComparison = parseAssistantReply('{"function":"trade_pnl","range":{"kind":"this_month"},"compare":"previous"}')
  assert.ok(withComparison.ok)
  assert.equal(withComparison.ok && withComparison.call.kind === 'function' ? withComparison.call.compare : null, 'previous')
  assert.equal(parseAssistantReply('{"function":"trade_pnl","range":{"kind":"today"},"compare":"future"}').ok, false)
})

console.log(`\n${n} assistant comparison checks passed`)
