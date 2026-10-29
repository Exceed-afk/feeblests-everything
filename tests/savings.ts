// Checks for the savings math (balances, progress, running balance) and for the
// "a goal can never go below zero" rule. No database needed:
//   npm test
import assert from 'node:assert/strict'
import { progressPercent, signedAmount, withRunningBalance } from '../src/shared/savings'
import { parseBackup } from '../src/shared/backup'
import type { SavingsTx, TxKind } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const tx = (id: number, kind: TxKind, amount: number, date = '2026-10-01'): SavingsTx =>
  ({ id, goalId: 1, date, kind, amount, note: '', createdAt: '', updatedAt: '' })

test('deposits add and withdrawals subtract', () => {
  assert.equal(signedAmount('deposit', 25), 25)
  assert.equal(signedAmount('withdrawal', 25), -25)
})

test('progress is balance / target as a percent, and may pass 100', () => {
  assert.equal(progressPercent(50, 200), 25)
  assert.equal(progressPercent(200, 200), 100)
  assert.equal(progressPercent(300, 200), 150)
  assert.equal(progressPercent(0, 200), 0)
})
test('progress is null when there is no usable target', () => {
  assert.equal(progressPercent(50, null), null)
  assert.equal(progressPercent(50, 0), null)
})

test('running balance is shown newest first and adds up in date order', () => {
  const rows = withRunningBalance([
    tx(2, 'withdrawal', 30, '2026-10-02'),
    tx(1, 'deposit', 100, '2026-10-01'),
    tx(3, 'deposit', 10, '2026-10-03')
  ])
  assert.deepEqual(rows.map((r) => r.id), [3, 2, 1])
  assert.deepEqual(rows.map((r) => r.balance), [80, 70, 100])
})
test('same-day transactions are ordered by id', () => {
  const rows = withRunningBalance([tx(2, 'withdrawal', 40), tx(1, 'deposit', 50)])
  assert.deepEqual(rows.map((r) => r.balance), [10, 50]) // deposit first, then the withdrawal
})
test('running balance has no floating point noise', () => {
  const rows = withRunningBalance([tx(1, 'deposit', 0.1), tx(2, 'deposit', 0.2)])
  assert.equal(rows[0].balance, 0.3)
})
test('running balance of nothing is nothing, and the input is not reordered', () => {
  assert.deepEqual(withRunningBalance([]), [])
  const list = [tx(2, 'deposit', 1, '2026-10-02'), tx(1, 'deposit', 1, '2026-10-01')]
  withRunningBalance(list)
  assert.deepEqual(list.map((t) => t.id), [2, 1])
})
test('a goal can end at exactly zero', () => {
  const rows = withRunningBalance([tx(1, 'deposit', 75.5), tx(2, 'withdrawal', 75.5, '2026-10-02')])
  assert.equal(rows[0].balance, 0)
})

// ---- The no-negative rule, as enforced when a backup is imported ----
// (The same rule guards add / edit / delete in src/main/savings.ts; that file needs a database,
// so the rule is checked here through the pure import validation.)
const SCHEMA = 5
const stamp = { createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
const backup = (txs: unknown[]) => JSON.stringify({
  app: 'feeblests-everything', format: 1, schemaVersion: SCHEMA, exportedAt: '2026-10-25T00:00:00Z', settings: {},
  logbook: [], trades: [],
  savingsGoals: [{ id: 1, name: 'Car', target: 100, notes: '', ...stamp }],
  savingsTransactions: txs
})
const row = (id: number, kind: string, amount: number, date: string) => ({ id, goalId: 1, date, kind, amount, note: '', ...stamp })

test('import accepts a withdrawal that leaves exactly zero', () => {
  assert.doesNotThrow(() => parseBackup(backup([row(1, 'deposit', 50, '2026-10-01'), row(2, 'withdrawal', 50, '2026-10-02')]), SCHEMA))
})
test('import rejects a withdrawal larger than the balance at that moment', () => {
  assert.throws(() => parseBackup(backup([row(1, 'deposit', 50, '2026-10-01'), row(2, 'withdrawal', 50.01, '2026-10-02')]), SCHEMA), /below|negative|zero/i)
})
// Documented behaviour: the rule looks at the END balance of each goal, not at every date along the way.
// So a withdrawal dated before the deposit that covers it is allowed (the history list would show a
// negative running balance for that stretch). If the rule is ever tightened, change these two tests.
test('import allows a withdrawal dated before its covering deposit, because only the end balance is checked', () => {
  assert.doesNotThrow(() => parseBackup(backup([row(1, 'withdrawal', 20, '2026-10-01'), row(2, 'deposit', 50, '2026-10-02')]), SCHEMA))
  const rows = withRunningBalance([tx(1, 'withdrawal', 20, '2026-10-01'), tx(2, 'deposit', 50, '2026-10-02')])
  assert.deepEqual(rows.map((r) => r.balance), [30, -20])
})
test('import rejects a goal whose END balance is below zero, however the dates fall', () => {
  assert.throws(() => parseBackup(backup([
    row(1, 'deposit', 10, '2026-10-03'), row(2, 'withdrawal', 30, '2026-10-01')
  ]), SCHEMA), /negative balance/i)
})
test('import accepts decimal amounts that add up exactly', () => {
  assert.doesNotThrow(() => parseBackup(backup([row(1, 'deposit', 0.1, '2026-10-01'), row(2, 'deposit', 0.2, '2026-10-01'), row(3, 'withdrawal', 0.3, '2026-10-02')]), SCHEMA))
})

console.log(`\n${n} savings checks passed`)
