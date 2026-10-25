// The ONE place where trade math lives. Both the database code and the UI
// use these functions, so a fix here applies everywhere.
import { round8 } from './math'
import type { PnlPoint, Trade, TradeInput, TradeStats } from './types'

export { round8 }

// Long:  (exit - entry) x size - fees
// Short: (entry - exit) x size - fees
export function calcPnl(t: Pick<TradeInput, 'direction' | 'entryPrice' | 'exitPrice' | 'quantity' | 'fees'>): number | null {
  if (t.exitPrice === null) return null
  const move = t.direction === 'long' ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice
  return round8(move * t.quantity - t.fees)
}

export function computeStats(trades: Trade[]): TradeStats {
  const closed = trades.filter((t) => t.pnl !== null)
  const pnls = closed.map((t) => t.pnl as number)
  const wins = pnls.filter((p) => p > 0)
  const losses = pnls.filter((p) => p < 0)
  const sum = (a: number[]) => round8(a.reduce((x, y) => x + y, 0))
  const grossWin = sum(wins)
  const grossLoss = Math.abs(sum(losses))
  return {
    total: trades.length,
    open: trades.length - closed.length,
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : null,
    totalPnl: sum(pnls),
    totalFees: sum(trades.map((t) => t.fees)),
    avgWin: wins.length ? round8(grossWin / wins.length) : null,
    avgLoss: losses.length ? round8(sum(losses) / losses.length) : null,
    profitFactor: grossLoss > 0 ? round8(grossWin / grossLoss) : null,
    best: pnls.length ? Math.max(...pnls) : null,
    worst: pnls.length ? Math.min(...pnls) : null
  }
}

// Running total of P&L, one point per CLOSED trade, oldest first (same date: lower id first).
// Open trades are left out. Trades only store an entry date, so that date is used.
export function pnlSeries(trades: Trade[]): PnlPoint[] {
  const closed = trades.filter((t) => t.pnl !== null)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  let total = 0
  return closed.map((t) => {
    total = round8(total + (t.pnl as number))
    return { tradeId: t.id, date: t.date, asset: t.asset, pnl: t.pnl as number, cumulative: total }
  })
}
