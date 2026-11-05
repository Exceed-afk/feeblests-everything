// Transfer leftover budget to savings in one database transaction (Phase 1).
//
// Rules from the plan:
// - "Savings: a month-end prompt, 'You have X left. Move it to a goal?' Creating the deposit
//   and the transfer must happen in one database transaction so nothing is double counted."
// - Money in expenses is integer cents; savings amounts are major units (cents / 100).
import type Database from 'better-sqlite3'
import { LIVE, nowIso } from '../../../main/repo'
import {
  assertPositiveCents,
  DEFAULT_CURRENCY,
  type SavingsTransferInput,
  type SavingsTransferResult
} from './types'
import { createExpenseTransaction } from './transactions'
import { round8 } from '../../../shared/math'

interface GoalRow {
  id: number
  name: string
  target: number | null
  balance: number
}

export function transferLeftoverToSavings(
  db: Database.Database,
  input: SavingsTransferInput
): SavingsTransferResult {
  assertPositiveCents(input.amountCents, 'Transfer amount')
  const currency = (input.currency || DEFAULT_CURRENCY).toUpperCase().trim()
  const date = input.date.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date format (must be YYYY-MM-DD)')
  const goalId = input.goalId
  if (!Number.isInteger(goalId) || goalId <= 0) throw new Error('Valid savings goal ID is required')

  // Run the transfer in ONE atomic database transaction
  return db.transaction(() => {
    // 1. Verify goal exists and is live
    const goal = db.prepare(
      `SELECT g.id, g.name, g.target,
         COALESCE((SELECT SUM(CASE t.kind WHEN 'deposit' THEN t.amount ELSE -t.amount END)
                   FROM savings_transactions t WHERE t.goal_id = g.id AND ${LIVE('t')}), 0) AS balance
       FROM savings_goals g WHERE g.id = ? AND ${LIVE('g')}`
    ).get(goalId) as GoalRow | undefined

    if (!goal) throw new Error(`Goal not found (id: ${goalId})`)

    const note = input.note ? input.note.trim() : `Transfer to savings: ${goal.name}`

    // 2. Create the expense transfer transaction (amount in integer cents)
    const expenseTx = createExpenseTransaction(db, {
      amount: input.amountCents,
      currency,
      date,
      categoryId: null,
      payee: `Savings: ${goal.name}`,
      note,
      type: 'transfer',
      transferTarget: `savings:${goalId}`
    })

    // 3. Create the savings deposit transaction (amount in major units = cents / 100)
    const depositAmountMajor = round8(input.amountCents / 100)
    const now = nowIso()

    const savingsTxInfo = db.prepare(
      `INSERT INTO savings_transactions (goal_id, date, kind, amount, note, created_at, updated_at)
       VALUES (?, ?, 'deposit', ?, ?, ?, ?)`
    ).run(goalId, date, depositAmountMajor, note, now, now)

    const savingsTxId = Number(savingsTxInfo.lastInsertRowid)

    // Calculate new goal balance
    const newGoalBalance = round8(goal.balance + depositAmountMajor)

    return {
      expenseTransaction: expenseTx,
      savingsTransactionId: savingsTxId,
      goalId: goal.id,
      goalName: goal.name,
      amountCents: input.amountCents,
      currency,
      date,
      newGoalBalance
    }
  })()
}
