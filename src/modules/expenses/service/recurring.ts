// Recurring bills and subscriptions service for Expenses (Phase 1).
//
// Rules from the plan:
// - Runs on launch, catches up on missed periods, and is idempotent (unique on recurring_id + due_date).
// - Autopay bills automatically create expense transactions; non-autopay bills record pending occurrences.
// - Marking a bill as paid creates the transaction.
// - Month boundaries and variable month lengths clamp correctly (e.g. Jan 31 -> Feb 28 -> Mar 31).
import type Database from 'better-sqlite3'
import { LIVE, newBatchId, nowIso, trashByWhere } from '../../../main/repo'
import {
  assertPositiveCents,
  DEFAULT_CURRENCY,
  type RecurringBill,
  type RecurringBillInput,
  type RecurringCadence,
  type RecurringOccurrence,
  type RecurringOccurrenceStatus
} from './types'
import { createExpenseTransaction, getExpenseTransaction } from './transactions'

interface BillRow {
  id: number
  name: string
  amount: number
  currency: string
  cadence: RecurringCadence
  interval_days: number | null
  next_due_date: string
  category_id: number | null
  reminder_lead_days: number
  autopay: number
  trial_end_date: string | null
  payee: string
  note: string
  archived: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  delete_batch_id: string | null
}

const toBill = (r: BillRow): RecurringBill => ({
  id: r.id,
  name: r.name,
  amount: r.amount,
  currency: r.currency,
  cadence: r.cadence,
  intervalDays: r.interval_days,
  nextDueDate: r.next_due_date,
  categoryId: r.category_id,
  reminderLeadDays: r.reminder_lead_days,
  autopay: r.autopay === 1,
  trialEndDate: r.trial_end_date,
  payee: r.payee,
  note: r.note,
  archived: r.archived === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
  deleteBatchId: r.delete_batch_id
})

interface OccRow {
  id: number
  recurring_id: number
  due_date: string
  status: RecurringOccurrenceStatus
  transaction_id: number | null
  paid_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  delete_batch_id: string | null
}

const toOccurrence = (r: OccRow): RecurringOccurrence => ({
  id: r.id,
  recurringId: r.recurring_id,
  dueDate: r.due_date,
  status: r.status,
  transactionId: r.transaction_id,
  paidAt: r.paid_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
  deleteBatchId: r.delete_batch_id
})

// ---------- Recurrence Date Math ----------

function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

function addMonthsIso(date: string, months: number, anchorDay?: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const day = anchorDay ?? d
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(day, last))
  return first.toISOString().slice(0, 10)
}

function addYearsIso(date: string, years: number, anchorDay?: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const day = anchorDay ?? d
  const targetYear = y + years
  // Handle leap year clamp (Feb 29 -> Feb 28)
  const isLeap = (targetYear % 4 === 0 && targetYear % 100 !== 0) || targetYear % 400 === 0
  const maxDayInFeb = isLeap ? 29 : 28
  const clampedDay = m === 2 ? Math.min(day, maxDayInFeb) : day
  return `${targetYear}-${String(m).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`
}

/**
 * Calculates the next due date based on cadence and anchor day.
 * Respects variable month lengths (e.g. Jan 31 -> Feb 28 -> Mar 31).
 */
export function advanceRecurringDueDate(
  currentDueDate: string,
  cadence: RecurringCadence,
  intervalDays?: number | null,
  anchorDate = currentDueDate
): string {
  const [, , anchorDayStr] = anchorDate.split('-')
  const anchorDay = Number(anchorDayStr)

  if (cadence === 'weekly') return addDaysIso(currentDueDate, 7)
  if (cadence === 'custom') {
    const days = Math.max(1, Math.floor(Number(intervalDays) || 1))
    return addDaysIso(currentDueDate, days)
  }
  if (cadence === 'monthly') return addMonthsIso(currentDueDate, 1, anchorDay)
  if (cadence === 'yearly') return addYearsIso(currentDueDate, 1, anchorDay)
  throw new Error(`Unsupported cadence: ${String(cadence)}`)
}

// ---------- Recurring Bills CRUD ----------

export function getRecurringBill(db: Database.Database, id: number): RecurringBill {
  const row = db.prepare(
    `SELECT * FROM recurring_bills WHERE id = ? AND ${LIVE()}`
  ).get(id) as BillRow | undefined
  if (!row) throw new Error('Recurring bill not found')
  return toBill(row)
}

export function listRecurringBills(db: Database.Database, includeArchived = false): RecurringBill[] {
  const archiveFilter = includeArchived ? '' : 'AND archived = 0'
  const rows = db.prepare(
    `SELECT * FROM recurring_bills WHERE ${LIVE()} ${archiveFilter} ORDER BY next_due_date ASC, name ASC`
  ).all() as BillRow[]
  return rows.map(toBill)
}

export function createRecurringBill(db: Database.Database, input: RecurringBillInput): RecurringBill {
  assertPositiveCents(input.amount, 'Bill amount')
  const name = input.name.trim()
  if (!name) throw new Error('Bill name cannot be empty')
  const currency = (input.currency || DEFAULT_CURRENCY).toUpperCase().trim()
  const cadence = input.cadence
  if (!['weekly', 'monthly', 'yearly', 'custom'].includes(cadence)) {
    throw new Error(`Invalid cadence: ${cadence}`)
  }
  if (cadence === 'custom' && (!input.intervalDays || input.intervalDays <= 0)) {
    throw new Error('Custom cadence requires intervalDays greater than 0')
  }
  const nextDueDate = input.nextDueDate.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDueDate)) throw new Error('Invalid date format for nextDueDate')

  const now = nowIso()
  const info = db.prepare(
    `INSERT INTO recurring_bills
     (name, amount, currency, cadence, interval_days, next_due_date, category_id,
      reminder_lead_days, autopay, trial_end_date, payee, note, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    name, input.amount, currency, cadence, input.intervalDays ?? null, nextDueDate,
    input.categoryId ?? null, input.reminderLeadDays ?? 0, input.autopay ? 1 : 0,
    input.trialEndDate ? input.trialEndDate.trim() : null, input.payee ? input.payee.trim() : '',
    input.note ? input.note.trim() : '', now, now
  )

  return getRecurringBill(db, Number(info.lastInsertRowid))
}

export function updateRecurringBill(
  db: Database.Database,
  id: number,
  input: RecurringBillInput
): RecurringBill {
  getRecurringBill(db, id)
  assertPositiveCents(input.amount, 'Bill amount')
  const name = input.name.trim()
  if (!name) throw new Error('Bill name cannot be empty')
  const currency = (input.currency || DEFAULT_CURRENCY).toUpperCase().trim()
  const cadence = input.cadence
  if (!['weekly', 'monthly', 'yearly', 'custom'].includes(cadence)) {
    throw new Error(`Invalid cadence: ${cadence}`)
  }
  if (cadence === 'custom' && (!input.intervalDays || input.intervalDays <= 0)) {
    throw new Error('Custom cadence requires intervalDays greater than 0')
  }
  const nextDueDate = input.nextDueDate.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDueDate)) throw new Error('Invalid date format for nextDueDate')

  const now = nowIso()
  db.prepare(
    `UPDATE recurring_bills
     SET name = ?, amount = ?, currency = ?, cadence = ?, interval_days = ?, next_due_date = ?,
         category_id = ?, reminder_lead_days = ?, autopay = ?, trial_end_date = ?, payee = ?,
         note = ?, updated_at = ?
     WHERE id = ? AND ${LIVE()}`
  ).run(
    name, input.amount, currency, cadence, input.intervalDays ?? null, nextDueDate,
    input.categoryId ?? null, input.reminderLeadDays ?? 0, input.autopay ? 1 : 0,
    input.trialEndDate ? input.trialEndDate.trim() : null, input.payee ? input.payee.trim() : '',
    input.note ? input.note.trim() : '', now, id
  )

  return getRecurringBill(db, id)
}

export function deleteRecurringBill(db: Database.Database, id: number): string {
  getRecurringBill(db, id)
  const batchId = newBatchId()
  const changes = trashByWhere(db, 'recurring_bills', `id = ? AND ${LIVE()}`, [id], batchId)
  if (changes === 0) throw new Error('Recurring bill not found')
  return batchId
}

// ---------- Launch & Catch-up Generation ----------

export interface GenerateRecurringResult {
  generatedCount: number
  paidCount: number
  occurrences: RecurringOccurrence[]
}

/**
 * Runs on app launch (or scheduled check) to catch up on all active recurring bills up to `today`.
 * Completely idempotent: uses UNIQUE(recurring_id, due_date) on recurring_bill_occurrences.
 *
 * - For autopay bills: creates an expense transaction and records occurrence as 'paid'.
 * - For non-autopay bills: records occurrence as 'pending'.
 * - Advances next_due_date past `today` to the next upcoming due date.
 */
export function generateRecurringBills(db: Database.Database, today: string): GenerateRecurringResult {
  const activeBills = db.prepare(
    `SELECT * FROM recurring_bills WHERE archived = 0 AND ${LIVE()} AND next_due_date <= ? ORDER BY next_due_date ASC`
  ).all(today) as BillRow[]

  let generatedCount = 0
  let paidCount = 0
  const generatedOccurrences: RecurringOccurrence[] = []

  db.transaction(() => {
    for (const b of activeBills) {
      let currentDue = b.next_due_date
      const anchorDate = b.next_due_date

      while (currentDue <= today) {
        // Check if occurrence already exists for (recurring_id, due_date)
        const existingOcc = db.prepare(
          `SELECT * FROM recurring_bill_occurrences WHERE recurring_id = ? AND due_date = ?`
        ).get(b.id, currentDue) as OccRow | undefined

        if (!existingOcc) {
          const now = nowIso()

          if (b.autopay === 1) {
            // Create expense transaction for autopay bill
            const tx = createExpenseTransaction(db, {
              amount: b.amount,
              currency: b.currency,
              date: currentDue,
              categoryId: b.category_id,
              payee: b.payee || b.name,
              note: `Recurring: ${b.name}`,
              type: 'expense',
              recurringId: b.id
            })

            const info = db.prepare(
              `INSERT INTO recurring_bill_occurrences
               (recurring_id, due_date, status, transaction_id, paid_at, created_at, updated_at)
               VALUES (?, ?, 'paid', ?, ?, ?, ?)`
            ).run(b.id, currentDue, tx.id, now, now, now)

            const occ = db.prepare('SELECT * FROM recurring_bill_occurrences WHERE id = ?').get(info.lastInsertRowid) as OccRow
            generatedOccurrences.push(toOccurrence(occ))
            paidCount++
          } else {
            // Record pending occurrence for manual payment
            const info = db.prepare(
              `INSERT INTO recurring_bill_occurrences
               (recurring_id, due_date, status, transaction_id, paid_at, created_at, updated_at)
               VALUES (?, ?, 'pending', NULL, NULL, ?, ?)`
            ).run(b.id, currentDue, now, now)

            const occ = db.prepare('SELECT * FROM recurring_bill_occurrences WHERE id = ?').get(info.lastInsertRowid) as OccRow
            generatedOccurrences.push(toOccurrence(occ))
          }

          generatedCount++
        }

        currentDue = advanceRecurringDueDate(currentDue, b.cadence, b.interval_days, anchorDate)
      }

      // Advance bill's next_due_date past today
      db.prepare(
        `UPDATE recurring_bills SET next_due_date = ?, updated_at = ? WHERE id = ?`
      ).run(currentDue, nowIso(), b.id)
    }
  })()

  return { generatedCount, paidCount, occurrences: generatedOccurrences }
}

// ---------- Manual Bill Payment ----------

export interface MarkBillPaidOptions {
  recurringId: number
  dueDate: string // YYYY-MM-DD
  paidDate?: string // YYYY-MM-DD, defaults to dueDate
  amount?: number
  currency?: string
}

export function markRecurringBillPaid(
  db: Database.Database,
  options: MarkBillPaidOptions
): { occurrence: RecurringOccurrence; transaction: ReturnType<typeof getExpenseTransaction> } {
  const bill = getRecurringBill(db, options.recurringId)
  const dueDate = options.dueDate.trim()
  const paidDate = options.paidDate ? options.paidDate.trim() : dueDate
  const amount = options.amount ?? bill.amount
  const currency = options.currency ?? bill.currency

  return db.transaction(() => {
    // Check if occurrence exists
    let occRow = db.prepare(
      `SELECT * FROM recurring_bill_occurrences WHERE recurring_id = ? AND due_date = ?`
    ).get(bill.id, dueDate) as OccRow | undefined

    if (occRow && occRow.status === 'paid' && occRow.transaction_id) {
      return {
        occurrence: toOccurrence(occRow),
        transaction: getExpenseTransaction(db, occRow.transaction_id)
      }
    }

    const tx = createExpenseTransaction(db, {
      amount,
      currency,
      date: paidDate,
      categoryId: bill.categoryId,
      payee: bill.payee || bill.name,
      note: `Recurring: ${bill.name}`,
      type: 'expense',
      recurringId: bill.id
    })

    const now = nowIso()

    if (occRow) {
      db.prepare(
        `UPDATE recurring_bill_occurrences SET status = 'paid', transaction_id = ?, paid_at = ?, updated_at = ? WHERE id = ?`
      ).run(tx.id, now, now, occRow.id)
      occRow = db.prepare('SELECT * FROM recurring_bill_occurrences WHERE id = ?').get(occRow.id) as OccRow
    } else {
      const info = db.prepare(
        `INSERT INTO recurring_bill_occurrences (recurring_id, due_date, status, transaction_id, paid_at, created_at, updated_at)
         VALUES (?, ?, 'paid', ?, ?, ?, ?)`
      ).run(bill.id, dueDate, tx.id, now, now, now)
      occRow = db.prepare('SELECT * FROM recurring_bill_occurrences WHERE id = ?').get(info.lastInsertRowid) as OccRow
    }

    // Advance bill's next_due_date if it was pointing at this due date
    if (bill.nextDueDate <= dueDate) {
      const nextDue = advanceRecurringDueDate(dueDate, bill.cadence, bill.intervalDays, bill.nextDueDate)
      db.prepare('UPDATE recurring_bills SET next_due_date = ?, updated_at = ? WHERE id = ?').run(nextDue, now, bill.id)
    }

    return {
      occurrence: toOccurrence(occRow),
      transaction: tx
    }
  })()
}

// ---------- Due Bills Query Helper ----------

// One unpaid bill occurrence the month still expects: the bill, the day it is
// due and its amount in integer cents.
export interface DueBill { bill: RecurringBill; dueDate: string; amount: number }

export function listDueBillsThisMonth(
  db: Database.Database,
  month: string,
  asOfDate: string
): DueBill[] {
  const [yearStr, monthStr] = month.split('-')
  const lastDay = new Date(Date.UTC(Number(yearStr), Number(monthStr), 0)).getUTCDate()
  const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`

  const rows = db.prepare(
    `SELECT b.*
     FROM recurring_bills b
     WHERE b.archived = 0 AND ${LIVE('b')}
       AND b.next_due_date >= ? AND b.next_due_date <= ?
       AND NOT EXISTS (
         SELECT 1 FROM recurring_bill_occurrences o
         WHERE o.recurring_id = b.id AND o.due_date = b.next_due_date AND o.status = 'paid'
       )
     ORDER BY b.next_due_date ASC`
  ).all(asOfDate, monthEnd) as BillRow[]

  return rows.map((r) => ({
    bill: toBill(r),
    dueDate: r.next_due_date,
    amount: r.amount
  }))
}

export function listDueBillsBetween(
  db: Database.Database,
  startDate: string,
  endDate: string
): DueBill[] {
  const rows = db.prepare(
    `SELECT b.*
     FROM recurring_bills b
     WHERE b.archived = 0 AND ${LIVE('b')}
       AND b.next_due_date >= ? AND b.next_due_date <= ?
       AND NOT EXISTS (
         SELECT 1 FROM recurring_bill_occurrences o
         WHERE o.recurring_id = b.id AND o.due_date = b.next_due_date AND o.status = 'paid'
       )
     ORDER BY b.next_due_date ASC`
  ).all(startDate, endDate) as BillRow[]

  return rows.map((r) => ({
    bill: toBill(r),
    dueDate: r.next_due_date,
    amount: r.amount
  }))
}
