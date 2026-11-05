// Transactions service for Expenses (Phase 1).
import type Database from 'better-sqlite3'
import { LIVE, newBatchId, nowIso, trashByWhere } from '../../../main/repo'
import { indexOne, removeOne } from '../../../main/searchIndex'
import {
  assertPositiveCents,
  DEFAULT_CURRENCY,
  type ExpenseTransaction,
  type ExpenseTransactionInput,
  type ExpenseTxType
} from './types'

interface TxRow {
  id: number
  amount: number
  currency: string
  date: string
  category_id: number | null
  payee: string
  note: string
  type: ExpenseTxType
  tags: string
  transfer_target: string | null
  recurring_id: number | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  delete_batch_id: string | null
}

const toTx = (r: TxRow): ExpenseTransaction => ({
  id: r.id,
  amount: r.amount,
  currency: r.currency,
  date: r.date,
  categoryId: r.category_id,
  payee: r.payee,
  note: r.note,
  type: r.type,
  tags: JSON.parse(r.tags || '[]'),
  transferTarget: r.transfer_target,
  recurringId: r.recurring_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
  deleteBatchId: r.delete_batch_id
})

export function getExpenseTransaction(db: Database.Database, id: number): ExpenseTransaction {
  const row = db.prepare(
    `SELECT * FROM expense_transactions WHERE id = ? AND ${LIVE()}`
  ).get(id) as TxRow | undefined
  if (!row) throw new Error('Transaction not found')
  return toTx(row)
}

export function createExpenseTransaction(
  db: Database.Database,
  input: ExpenseTransactionInput
): ExpenseTransaction {
  assertPositiveCents(input.amount, 'Transaction amount')
  const currency = (input.currency || DEFAULT_CURRENCY).toUpperCase().trim()
  if (!currency) throw new Error('Currency cannot be empty')
  const date = input.date.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date format (must be YYYY-MM-DD)')
  const payee = input.payee ? input.payee.trim() : ''
  const note = input.note ? input.note.trim() : ''
  const type = input.type
  if (!['expense', 'income', 'transfer'].includes(type)) throw new Error(`Invalid transaction type: ${type}`)
  const tags = JSON.stringify(Array.isArray(input.tags) ? input.tags : [])
  const transferTarget = input.transferTarget ? input.transferTarget.trim() : null
  const recurringId = input.recurringId ?? null
  const categoryId = input.categoryId ?? null

  const now = nowIso()
  const info = db.prepare(
    `INSERT INTO expense_transactions
     (amount, currency, date, category_id, payee, note, type, tags, transfer_target, recurring_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(input.amount, currency, date, categoryId, payee, note, type, tags, transferTarget, recurringId, now, now)

  const tx = getExpenseTransaction(db, Number(info.lastInsertRowid))
  indexOne(db, 'expense_tx', tx.id)
  return tx
}

export function updateExpenseTransaction(
  db: Database.Database,
  id: number,
  input: ExpenseTransactionInput
): ExpenseTransaction {
  getExpenseTransaction(db, id)
  assertPositiveCents(input.amount, 'Transaction amount')
  const currency = (input.currency || DEFAULT_CURRENCY).toUpperCase().trim()
  if (!currency) throw new Error('Currency cannot be empty')
  const date = input.date.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date format (must be YYYY-MM-DD)')
  const payee = input.payee ? input.payee.trim() : ''
  const note = input.note ? input.note.trim() : ''
  const type = input.type
  if (!['expense', 'income', 'transfer'].includes(type)) throw new Error(`Invalid transaction type: ${type}`)
  const tags = JSON.stringify(Array.isArray(input.tags) ? input.tags : [])
  const transferTarget = input.transferTarget ? input.transferTarget.trim() : null
  const recurringId = input.recurringId ?? null
  const categoryId = input.categoryId ?? null

  const now = nowIso()
  db.prepare(
    `UPDATE expense_transactions
     SET amount = ?, currency = ?, date = ?, category_id = ?, payee = ?, note = ?,
         type = ?, tags = ?, transfer_target = ?, recurring_id = ?, updated_at = ?
     WHERE id = ? AND ${LIVE()}`
  ).run(input.amount, currency, date, categoryId, payee, note, type, tags, transferTarget, recurringId, now, id)

  const updated = getExpenseTransaction(db, id)
  indexOne(db, 'expense_tx', updated.id)
  return updated
}

export function deleteExpenseTransaction(db: Database.Database, id: number): string {
  getExpenseTransaction(db, id)
  const batchId = newBatchId()
  const changes = trashByWhere(db, 'expense_transactions', `id = ? AND ${LIVE()}`, [id], batchId)
  if (changes === 0) throw new Error('Transaction not found')
  removeOne(db, 'expense_tx', id)
  return batchId
}

export interface ListExpenseTransactionsFilter {
  month?: string // YYYY-MM
  startDate?: string // YYYY-MM-DD
  endDate?: string // YYYY-MM-DD
  categoryId?: number | null
  type?: ExpenseTxType
}

export function listExpenseTransactions(
  db: Database.Database,
  filter: ListExpenseTransactionsFilter = {}
): ExpenseTransaction[] {
  const conditions = [LIVE()]
  const params: unknown[] = []

  if (filter.month) {
    conditions.push('substr(date, 1, 7) = ?')
    params.push(filter.month)
  }
  if (filter.startDate) {
    conditions.push('date >= ?')
    params.push(filter.startDate)
  }
  if (filter.endDate) {
    conditions.push('date <= ?')
    params.push(filter.endDate)
  }
  if (filter.categoryId !== undefined) {
    if (filter.categoryId === null) {
      conditions.push('category_id IS NULL')
    } else {
      conditions.push('category_id = ?')
      params.push(filter.categoryId)
    }
  }
  if (filter.type) {
    conditions.push('type = ?')
    params.push(filter.type)
  }

  const sql = `SELECT * FROM expense_transactions WHERE ${conditions.join(' AND ')} ORDER BY date DESC, id DESC`
  const rows = db.prepare(sql).all(...params) as TxRow[]
  return rows.map(toTx)
}

export function listExpenseTransactionsBetween(
  db: Database.Database,
  startDate: string,
  endDate: string
): ExpenseTransaction[] {
  return listExpenseTransactions(db, { startDate, endDate })
}

// Trash collection for expenses: soft-deleted transactions and bills
export function describeTrashedExpenses(db: Database.Database): import('../../../shared/trash').TrashEntry[] {
  const txs = (db.prepare(
    'SELECT id, amount, currency, date, payee, deleted_at, delete_batch_id FROM expense_transactions WHERE deleted_at IS NOT NULL'
  ).all() as {
    id: number; amount: number; currency: string; date: string; payee: string; deleted_at: string; delete_batch_id: string | null
  }[]).map((r) => ({
    type: 'expense_tx' as const,
    id: r.id,
    batchId: r.delete_batch_id,
    trashedAt: r.deleted_at,
    label: `${r.payee || 'Expense'} (${(r.amount / 100).toFixed(2)} ${r.currency})`,
    sublabel: `Expense on ${r.date}`
  }))

  const bills = (db.prepare(
    'SELECT id, name, amount, currency, deleted_at, delete_batch_id FROM recurring_bills WHERE deleted_at IS NOT NULL'
  ).all() as {
    id: number; name: string; amount: number; currency: string; deleted_at: string; delete_batch_id: string | null
  }[]).map((r) => ({
    type: 'recurring_bill' as const,
    id: r.id,
    batchId: r.delete_batch_id,
    trashedAt: r.deleted_at,
    label: `${r.name} (${(r.amount / 100).toFixed(2)} ${r.currency})`,
    sublabel: 'Recurring bill'
  }))

  return [...txs, ...bills]
}

export function getExpenseTransactionsByIds(db: Database.Database, ids: number[]): ExpenseTransaction[] {
  if (ids.length === 0) return []
  const marks = ids.map(() => '?').join(',')
  const rows = db.prepare(`SELECT * FROM expense_transactions WHERE id IN (${marks}) AND ${LIVE()}`).all(...ids) as TxRow[]
  return rows.map(toTx)
}
