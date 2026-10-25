// Savings math, used by both the database code and the UI.
import { round8 } from './math'
import type { SavingsTx, TxKind } from './types'

export const signedAmount = (kind: TxKind, amount: number): number => (kind === 'deposit' ? amount : -amount)

// Percent of the target reached (can pass 100). null when there is no target.
export const progressPercent = (balance: number, target: number | null): number | null =>
  target !== null && target > 0 ? (balance / target) * 100 : null

// Adds the balance AFTER each transaction. Returned newest first, for display.
export function withRunningBalance(txs: SavingsTx[]): (SavingsTx & { balance: number })[] {
  const oldestFirst = [...txs].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  let running = 0
  return oldestFirst
    .map((t) => {
      running = round8(running + signedAmount(t.kind, t.amount))
      return { ...t, balance: running }
    })
    .reverse()
}
