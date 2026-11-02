import assert from 'node:assert/strict'
import { projectGoal, projectionText } from '../src/shared/savings'
import type { SavingsTx } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { try { fn(); n++; console.log('ok  ', name) } catch (e) { console.error(e); throw e } }

const TODAY = '2026-11-02'
const day = (offset: number): string =>
  new Date(Date.parse(TODAY) + offset * 86_400_000).toISOString().slice(0, 10)

const tx = (date: string, kind: SavingsTx['kind'], amount: number, id = 0): SavingsTx =>
  ({ id, goalId: 1, date, kind, amount, note: '', createdAt: '', updatedAt: '' })

const goal = (target: number | null, balance: number) => ({ target, balance })

// Steady 40/week: one deposit of 40 every Monday; the oldest is exactly at the
// 8-week edge minus a day, so the window holds 8 deposits over ~7.9 weeks.
const steady = (): SavingsTx[] => {
  const out: SavingsTx[] = []
  for (let w = 7; w >= 0; w--) out.push(tx(day(-w * 7), 'deposit', 40, out.length + 1))
  return out
}

test('I4: steady deposits project the remaining weeks', () => {
  const p = projectGoal(steady(), goal(520, 120), TODAY) // 400 remaining
  assert.ok(p)
  assert.equal(p.perWeek, Math.round((320 / 7) * 1e8) / 1e8) // 320 net over 7 weeks of data
  assert.equal(p.weeksNeeded, Math.ceil(400 / (320 / 7)))
  assert.equal(p.remaining, 400)
  assert.match(projectionText(p, 'Emergency fund') ?? '', /45\.71\/week you will reach "Emergency fund" in about 9 weeks/)
})

test('I4: withdrawals net against deposits', () => {
  const txs = [...steady(), tx(day(-3), 'withdrawal', 80, 99)] // net 240 over 7 weeks
  const p = projectGoal(txs, goal(400, 0), TODAY)
  assert.ok(p)
  assert.equal(p.perWeek, Math.round((240 / 7) * 1e8) / 1e8)
  assert.equal(p.weeksNeeded, Math.ceil(400 / (240 / 7)))
})

test('I4: a reached goal shows nothing', () => {
  assert.equal(projectGoal(steady(), goal(100, 100), TODAY), null)
  assert.equal(projectGoal(steady(), goal(100, 150), TODAY), null)
})

test('I4: no data shows nothing', () => {
  assert.equal(projectGoal([], goal(500, 0), TODAY), null)
})

test('I4: zero or negative average shows nothing', () => {
  const txs = [tx(day(-7), 'deposit', 100, 1), tx(day(-1), 'withdrawal', 100, 2)]
  assert.equal(projectGoal(txs, goal(500, 0), TODAY), null)
})

test('I4: fewer than 4 weeks of data shows nothing', () => {
  const txs = [tx(day(-10), 'deposit', 100, 1), tx(day(-3), 'deposit', 100, 2)] // ~1.5 weeks
  assert.equal(projectGoal(txs, goal(500, 0), TODAY), null)
})

test('I4: a horizon over five years shows nothing', () => {
  // 5/week over 8 weeks, 10_000 remaining -> 2000 weeks.
  const txs = Array.from({ length: 8 }, (_, i) => tx(day(-(7 - i) * 7), 'deposit', 5, i + 1))
  assert.equal(projectGoal(txs, goal(10_000, 0), TODAY), null)
})

test('I4: no target shows nothing', () => {
  assert.equal(projectGoal(steady(), goal(null, 0), TODAY), null)
})

console.log(`${n} goal projection checks passed`)
