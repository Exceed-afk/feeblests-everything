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

// ---------- I4: goal projection (a projection, not a rule) ----------

export interface GoalProjection {
  weeksNeeded: number
  perWeek: number
  remaining: number
}

// "At your last 8 weeks' average of X/week you will reach '<goal>' in about N
// weeks." Average weekly NET (deposits minus withdrawals, signedAmount) over
// the last 8 weeks. Shows nothing when:
//  - fewer than 4 weeks of tx data (too thin to project from),
//  - the average is zero or negative (withdrawals cancel deposits, or dominate),
//  - the goal has no target or is already reached,
//  - the horizon would exceed 5 years (260 weeks) — the average is not a promise.
export function projectGoal(
  txs: SavingsTx[],
  goal: { target: number | null; balance: number },
  today: string
): GoalProjection | null {
  if (goal.target === null || goal.target <= 0) return null
  const remaining = round8(goal.target - goal.balance)
  if (remaining <= 0) return null // already reached

  const windowStartMs = Date.parse(today) - 8 * 7 * 86_400_000
  const windowStart = new Date(windowStartMs).toISOString().slice(0, 10)
  const recent = txs.filter((t) => t.date > windowStart && t.date <= today)
  const net = round8(recent.reduce((sum, t) => sum + signedAmount(t.kind, t.amount), 0))
  if (recent.length === 0 || net <= 0) return null

  // How much of the 8-week window actually has data (first tx to today), capped at 8 weeks.
  const oldest = recent.map((t) => t.date).sort()[0]
  const weeksOfData = Math.min(8, Math.max(1, (Date.parse(today) - Date.parse(oldest)) / 86_400_000 / 7))
  if (weeksOfData < 4) return null // fewer than 4 weeks of data

  const perWeek = round8(net / weeksOfData)
  if (perWeek <= 0) return null

  const weeksNeededFloat = remaining / perWeek
  if (weeksNeededFloat > 260) return null // over five years: do not pretend
  return { weeksNeeded: Math.max(1, Math.ceil(weeksNeededFloat)), perWeek, remaining }
}

// The sentence the UI shows; kept next to the projection so the wording and the
// math cannot drift apart. Null input -> no sentence.
export const projectionText = (
  p: GoalProjection | null,
  goalName: string
): string | null =>
  p === null ? null
    : `At your recent average of ${String(Math.round(p.perWeek * 100) / 100)}/week you will reach "${goalName}" in about ${p.weeksNeeded} week${p.weeksNeeded === 1 ? '' : 's'}.`
