// Budgets service for Expenses (Phase 1).
import type Database from 'better-sqlite3'
import { LIVE, newBatchId, nowIso, trashByWhere } from '../../../main/repo'
import {
  assertNonNegativeCents,
  DEFAULT_CURRENCY,
  type ExpenseBudget,
  type ExpenseBudgetInput
} from './types'

interface BudgetRow {
  id: number
  category_id: number
  month: string
  amount: number
  currency: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  delete_batch_id: string | null
}

const toBudget = (r: BudgetRow): ExpenseBudget => ({
  id: r.id,
  categoryId: r.category_id,
  month: r.month,
  amount: r.amount,
  currency: r.currency,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
  deleteBatchId: r.delete_batch_id
})

export function getBudget(db: Database.Database, id: number): ExpenseBudget {
  const row = db.prepare(
    `SELECT * FROM expense_budgets WHERE id = ? AND ${LIVE()}`
  ).get(id) as BudgetRow | undefined
  if (!row) throw new Error('Budget not found')
  return toBudget(row)
}

export function listBudgets(db: Database.Database, month: string): ExpenseBudget[] {
  const rows = db.prepare(
    `SELECT * FROM expense_budgets WHERE month = ? AND ${LIVE()} ORDER BY category_id ASC`
  ).all(month) as BudgetRow[]
  return rows.map(toBudget)
}

export function setBudget(db: Database.Database, input: ExpenseBudgetInput): ExpenseBudget {
  assertNonNegativeCents(input.amount, 'Budget amount')
  const month = input.month.trim()
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Invalid month format (must be YYYY-MM)')
  const currency = (input.currency || DEFAULT_CURRENCY).toUpperCase().trim()
  const categoryId = input.categoryId
  if (!Number.isInteger(categoryId) || categoryId <= 0) throw new Error('Valid category ID is required')

  const now = nowIso()

  // Upsert: check if a budget row for (category_id, month) already exists and is live
  const existing = db.prepare(
    `SELECT id FROM expense_budgets WHERE category_id = ? AND month = ? AND ${LIVE()}`
  ).get(categoryId, month) as { id: number } | undefined

  if (existing) {
    db.prepare(
      `UPDATE expense_budgets SET amount = ?, currency = ?, updated_at = ?
       WHERE id = ? AND ${LIVE()}`
    ).run(input.amount, currency, now, existing.id)
    return getBudget(db, existing.id)
  }

  const info = db.prepare(
    `INSERT INTO expense_budgets (category_id, month, amount, currency, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(categoryId, month, input.amount, currency, now, now)

  return getBudget(db, Number(info.lastInsertRowid))
}

export function deleteBudget(db: Database.Database, id: number): string {
  getBudget(db, id)
  const batchId = newBatchId()
  const changes = trashByWhere(db, 'expense_budgets', `id = ? AND ${LIVE()}`, [id], batchId)
  if (changes === 0) throw new Error('Budget not found')
  return batchId
}

// Previous month YYYY-MM helper
function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const prevDate = new Date(Date.UTC(y, m - 2, 1))
  const py = prevDate.getUTCFullYear()
  const pm = String(prevDate.getUTCMonth() + 1).padStart(2, '0')
  return `${py}-${pm}`
}

export function copyBudgetsFromPreviousMonth(
  db: Database.Database,
  targetMonth: string
): ExpenseBudget[] {
  const sourceMonth = previousMonth(targetMonth)
  const previous = listBudgets(db, sourceMonth)
  const copied: ExpenseBudget[] = []

  db.transaction(() => {
    for (const b of previous) {
      copied.push(setBudget(db, {
        categoryId: b.categoryId,
        month: targetMonth,
        amount: b.amount,
        currency: b.currency
      }))
    }
  })()

  return copied
}
