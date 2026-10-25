// Savings database queries (same pattern as logbook.ts and trades.ts).
import type Database from 'better-sqlite3'
import { round8 } from '../shared/math'
import { signedAmount } from '../shared/savings'
import { isDate, searchWhere } from './util'
import type { ParsedQuery } from '../shared/search'
import type { SavingsGoal, SavingsGoalInput, SavingsTx, SavingsTxHit, SavingsTxInput, SearchGroup, TxKind } from '../shared/types'

interface GoalRow {
  id: number; name: string; target: number | null; notes: string
  balance: number; tx_count: number; created_at: string; updated_at: string
}
interface TxRow {
  id: number; goal_id: number; date: string; kind: TxKind; amount: number
  note: string; created_at: string; updated_at: string
}

// The balance is worked out here, from the transactions, every time.
const GOAL_SQL = `
  SELECT g.*,
    COALESCE((SELECT SUM(CASE t.kind WHEN 'deposit' THEN t.amount ELSE -t.amount END)
              FROM savings_transactions t WHERE t.goal_id = g.id), 0) AS balance,
    (SELECT COUNT(*) FROM savings_transactions t WHERE t.goal_id = g.id) AS tx_count
  FROM savings_goals g`

const toGoal = (r: GoalRow): SavingsGoal => ({
  id: r.id, name: r.name, target: r.target, notes: r.notes, balance: round8(r.balance),
  txCount: r.tx_count, createdAt: r.created_at, updatedAt: r.updated_at
})
const toTx = (r: TxRow): SavingsTx => ({
  id: r.id, goalId: r.goal_id, date: r.date, kind: r.kind, amount: r.amount,
  note: r.note, createdAt: r.created_at, updatedAt: r.updated_at
})

export function listGoals(db: Database.Database): SavingsGoal[] {
  return (db.prepare(`${GOAL_SQL} ORDER BY g.created_at, g.id`).all() as GoalRow[]).map(toGoal)
}

function getGoal(db: Database.Database, id: number): SavingsGoal {
  const row = db.prepare(`${GOAL_SQL} WHERE g.id = ?`).get(id) as GoalRow | undefined
  if (!row) throw new Error('Goal not found')
  return toGoal(row)
}

function prepareGoal(i: SavingsGoalInput) {
  const name = i.name.trim()
  if (!name) throw new Error('Give the goal a name')
  if (i.target !== null && !(i.target > 0)) throw new Error('Target must be above 0, or left empty')
  return { name, target: i.target, notes: i.notes }
}

export function createGoal(db: Database.Database, input: SavingsGoalInput): SavingsGoal {
  const g = prepareGoal(input)
  const now = new Date().toISOString()
  const info = db.prepare(
    'INSERT INTO savings_goals (name, target, notes, created_at, updated_at) VALUES (@name, @target, @notes, @now, @now)'
  ).run({ ...g, now })
  return getGoal(db, Number(info.lastInsertRowid))
}

export function updateGoal(db: Database.Database, id: number, input: SavingsGoalInput): SavingsGoal {
  const g = prepareGoal(input)
  db.prepare('UPDATE savings_goals SET name=@name, target=@target, notes=@notes, updated_at=@now WHERE id=@id')
    .run({ ...g, id, now: new Date().toISOString() })
  return getGoal(db, id)
}

// Transactions are removed too (ON DELETE CASCADE in the table definition).
export function deleteGoal(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM savings_goals WHERE id = ?').run(id)
}

export function listTransactions(db: Database.Database, goalId: number): SavingsTx[] {
  return (db.prepare('SELECT * FROM savings_transactions WHERE goal_id = ? ORDER BY date DESC, id DESC')
    .all(goalId) as TxRow[]).map(toTx)
}

function getTx(db: Database.Database, id: number): SavingsTx {
  const row = db.prepare('SELECT * FROM savings_transactions WHERE id = ?').get(id) as TxRow | undefined
  if (!row) throw new Error('Transaction not found')
  return toTx(row)
}

// Balance of a goal, optionally pretending one transaction does not exist.
function balanceWithout(db: Database.Database, goalId: number, excludeTxId = 0): number {
  const r = db.prepare(
    `SELECT COALESCE(SUM(CASE kind WHEN 'deposit' THEN amount ELSE -amount END), 0) AS b
     FROM savings_transactions WHERE goal_id = ? AND id != ?`
  ).get(goalId, excludeTxId) as { b: number }
  return round8(r.b)
}

// Rule for add, edit and delete alike: the balance may never go below 0.
function assertNotNegative(balance: number, message: string): void {
  if (balance < 0) throw new Error(message)
}

function prepareTx(i: SavingsTxInput) {
  if (!isDate(i.date)) throw new Error('Date must look like 2026-10-25')
  if (i.kind !== 'deposit' && i.kind !== 'withdrawal') throw new Error('Kind must be deposit or withdrawal')
  if (!(i.amount > 0)) throw new Error('Amount must be above 0')
  return { date: i.date, kind: i.kind, amount: round8(i.amount), note: i.note.trim() }
}

export function addTransaction(db: Database.Database, input: SavingsTxInput): SavingsTx {
  const t = prepareTx(input)
  getGoal(db, input.goalId) // throws if the goal does not exist
  const after = round8(balanceWithout(db, input.goalId) + signedAmount(t.kind, t.amount))
  assertNotNegative(after, 'That withdrawal is more than the current balance.')
  const now = new Date().toISOString()
  const info = db.prepare(
    `INSERT INTO savings_transactions (goal_id, date, kind, amount, note, created_at, updated_at)
     VALUES (@goalId, @date, @kind, @amount, @note, @now, @now)`
  ).run({ ...t, goalId: input.goalId, now })
  return getTx(db, Number(info.lastInsertRowid))
}

export function updateTransaction(db: Database.Database, id: number, input: SavingsTxInput): SavingsTx {
  const t = prepareTx(input)
  const existing = getTx(db, id) // a transaction cannot move to another goal
  const after = round8(balanceWithout(db, existing.goalId, id) + signedAmount(t.kind, t.amount))
  assertNotNegative(after, 'That change would take the balance below 0.')
  db.prepare('UPDATE savings_transactions SET date=@date, kind=@kind, amount=@amount, note=@note, updated_at=@now WHERE id=@id')
    .run({ ...t, id, now: new Date().toISOString() })
  return getTx(db, id)
}

export function deleteTransaction(db: Database.Database, id: number): void {
  const existing = getTx(db, id)
  assertNotNegative(balanceWithout(db, existing.goalId, id), 'Deleting this would take the balance below 0.')
  db.prepare('DELETE FROM savings_transactions WHERE id = ?').run(id)
}

// Universal search over goals: name and notes. Goals have no tags.
export function searchGoals(db: Database.Database, q: ParsedQuery, limit: number): SearchGroup<SavingsGoal> {
  const w = searchWhere(q, ['g.name', 'g.notes'], null)
  const items = (db.prepare(`${GOAL_SQL} WHERE ${w.sql} ORDER BY g.created_at, g.id LIMIT ?`)
    .all(...w.params, limit) as GoalRow[]).map(toGoal)
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM savings_goals g WHERE ${w.sql}`).get(...w.params) as { n: number }
  return { items, total: n }
}

// Universal search over transactions: note, date and kind. The goal name is
// deliberately NOT searched, otherwise finding a goal would also list every
// one of its transactions.
export function searchTransactions(db: Database.Database, q: ParsedQuery, limit: number): SearchGroup<SavingsTxHit> {
  const w = searchWhere(q, ['t.note', 't.date', 't.kind'], null)
  const from = 'FROM savings_transactions t JOIN savings_goals g ON g.id = t.goal_id'
  const rows = db.prepare(`SELECT t.*, g.name AS goal_name ${from} WHERE ${w.sql} ORDER BY t.date DESC, t.id DESC LIMIT ?`)
    .all(...w.params, limit) as (TxRow & { goal_name: string })[]
  const { n } = db.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${w.sql}`).get(...w.params) as { n: number }
  return { items: rows.map((r) => ({ ...toTx(r), goalName: r.goal_name })), total: n }
}
