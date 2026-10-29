// Checks for the trade math (P&L, stats, running P&L curve). No database needed:
//   npm test
import assert from 'node:assert/strict'
import { calcPnl, computeStats, pnlSeries } from '../src/shared/trades'
import type { Direction, Trade } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const input = (direction: Direction, entryPrice: number, exitPrice: number | null, quantity = 1, fees = 0) =>
  ({ direction, entryPrice, exitPrice, quantity, fees })

let nextId = 1
// Builds a Trade the way the database layer would: pnl is calculated, never typed in by hand.
const trade = (direction: Direction, entry: number, exit: number | null, qty = 1, fees = 0, date = '2026-10-01', id = nextId++): Trade => ({
  id, date, asset: 'XAUUSD', direction, entryPrice: entry, exitPrice: exit, quantity: qty, fees, notes: '', tags: [],
  pnl: calcPnl(input(direction, entry, exit, qty, fees)), createdAt: '', updatedAt: ''
})

test('long P&L is (exit - entry) x size', () => {
  assert.equal(calcPnl(input('long', 2000, 2010, 2)), 20)
  assert.equal(calcPnl(input('long', 2000, 1990, 2)), -20)
})
test('short P&L is (entry - exit) x size', () => {
  assert.equal(calcPnl(input('short', 2000, 1990, 2)), 20)
  assert.equal(calcPnl(input('short', 2000, 2010, 2)), -20)
})
test('fees are always subtracted, so they turn a small win into a loss', () => {
  assert.equal(calcPnl(input('long', 100, 101, 1, 0.5)), 0.5)
  assert.equal(calcPnl(input('long', 100, 100.5, 1, 1)), -0.5)
  assert.equal(calcPnl(input('short', 100, 100, 1, 2)), -2)
})
test('an open trade (no exit price) has no P&L', () => {
  assert.equal(calcPnl(input('long', 100, null)), null)
  assert.equal(calcPnl(input('short', 100, null, 1, 5)), null)
})
test('P&L has no floating point noise (0.1 + 0.2 style)', () => {
  assert.equal(calcPnl(input('long', 0.1, 0.3, 1)), 0.2)
  assert.equal(calcPnl(input('long', 1.1, 2.2, 3)), 3.3)
})
test('tiny crypto sizes keep 8 decimals', () => {
  assert.equal(calcPnl(input('long', 60000, 60100, 0.00012345)), 0.012345)
})
test('a flat trade with no fees is exactly zero, and counts as neither win nor loss', () => {
  const t = trade('long', 50, 50)
  assert.equal(t.pnl, 0)
  const s = computeStats([t])
  assert.equal(s.closed, 1)
  assert.equal(s.wins, 0)
  assert.equal(s.losses, 0)
  assert.equal(s.winRate, 0)
})

test('stats of no trades are empty, not NaN', () => {
  assert.deepEqual(computeStats([]), {
    total: 0, open: 0, closed: 0, wins: 0, losses: 0, winRate: null, totalPnl: 0, totalFees: 0,
    avgWin: null, avgLoss: null, profitFactor: null, best: null, worst: null
  })
})
test('open trades are counted but never touch P&L, win rate or best/worst', () => {
  const s = computeStats([trade('long', 100, null, 1, 3)])
  assert.equal(s.total, 1)
  assert.equal(s.open, 1)
  assert.equal(s.closed, 0)
  assert.equal(s.winRate, null)
  assert.equal(s.totalPnl, 0)
  assert.equal(s.best, null)
  assert.equal(s.worst, null)
  assert.equal(s.totalFees, 3) // fees are still real money spent
})
test('stats over a mix of wins, losses and an open trade', () => {
  const s = computeStats([
    trade('long', 100, 110, 1, 1), //  +9
    trade('long', 100, 105, 1, 1), //  +4
    trade('short', 100, 108, 1, 1), // -9
    trade('long', 100, 100, 1, 0), //   0 (flat)
    trade('long', 100, null, 1, 2) //  open
  ])
  assert.equal(s.total, 5)
  assert.equal(s.open, 1)
  assert.equal(s.closed, 4)
  assert.equal(s.wins, 2)
  assert.equal(s.losses, 1)
  assert.equal(s.winRate, 50) // 2 of 4 closed; the flat trade is in the denominator
  assert.equal(s.totalPnl, 4)
  assert.equal(s.totalFees, 5)
  assert.equal(s.avgWin, 6.5)
  assert.equal(s.avgLoss, -9)
  assert.equal(s.profitFactor, 1.44444444) // 13 / 9, rounded to 8 places
  assert.equal(s.best, 9)
  assert.equal(s.worst, -9)
})
test('profit factor is null when there are no losses (it would be infinite)', () => {
  const s = computeStats([trade('long', 1, 2), trade('long', 1, 3)])
  assert.equal(s.profitFactor, null)
  assert.equal(s.avgLoss, null)
  assert.equal(s.winRate, 100)
})
test('only losses: win rate 0, no average win', () => {
  const s = computeStats([trade('long', 10, 5), trade('short', 10, 12)])
  assert.equal(s.winRate, 0)
  assert.equal(s.avgWin, null)
  assert.equal(s.avgLoss, -3.5)
  assert.equal(s.profitFactor, 0)
})
test('totals add up cleanly with decimal prices', () => {
  const s = computeStats([trade('long', 0.1, 0.2, 1), trade('long', 0.1, 0.2, 1), trade('long', 0.1, 0.2, 1)])
  assert.equal(s.totalPnl, 0.3)
})

test('the P&L curve is a running total over closed trades only, oldest first', () => {
  const series = pnlSeries([
    trade('long', 10, 15, 1, 0, '2026-10-03', 3), // +5
    trade('long', 10, null, 1, 0, '2026-10-02', 2), // open: left out
    trade('long', 10, 8, 1, 0, '2026-10-01', 1) //   -2
  ])
  assert.deepEqual(series.map((p) => [p.tradeId, p.cumulative]), [[1, -2], [3, 3]])
  assert.deepEqual(series.map((p) => p.pnl), [-2, 5])
})
test('trades on the same date are ordered by id', () => {
  const series = pnlSeries([
    trade('long', 10, 11, 1, 0, '2026-10-01', 8),
    trade('long', 10, 12, 1, 0, '2026-10-01', 7)
  ])
  assert.deepEqual(series.map((p) => p.tradeId), [7, 8])
  assert.deepEqual(series.map((p) => p.cumulative), [2, 3])
})
test('the last point of the curve equals total P&L in the stats', () => {
  const ts = [trade('long', 0.1, 0.2, 1, 0, '2026-10-01'), trade('short', 5, 4.1, 3, 0.25, '2026-10-02'), trade('long', 9, 8, 2, 1, '2026-10-03')]
  const series = pnlSeries(ts)
  assert.equal(series[series.length - 1].cumulative, computeStats(ts).totalPnl)
})
test('the P&L curve does not reorder the list it is given', () => {
  const list = [trade('long', 1, 2, 1, 0, '2026-10-05', 1), trade('long', 1, 2, 1, 0, '2026-10-01', 2)]
  pnlSeries(list)
  assert.deepEqual(list.map((t) => t.id), [1, 2])
})

console.log(`\n${n} trade checks passed`)
