// Left-to-spend and safe-to-spend-per-day math and query service (Phase 1).
import type Database from 'better-sqlite3'
import { LIVE } from '../../../main/repo'
import {
  assertIntegerCents,
  DEFAULT_CURRENCY,
  type CategoryLeftToSpend,
  type LeftToSpendResult
} from './types'
import { listCategories } from './categories'
import { listBudgets } from './budgets'

// ---------- Pure Math Rules ----------

/**
 * Explicit formula from the extension plan:
 * left to spend = total monthly budget - spent so far - bills still due this month
 *
 * All inputs and outputs are integer cents.
 */
export function calculateLeftToSpend(
  budgetCents: number,
  spentCents: number,
  billsDueCents: number
): number {
  assertIntegerCents(budgetCents, 'Budget')
  assertIntegerCents(spentCents, 'Spent so far')
  assertIntegerCents(billsDueCents, 'Bills still due')
  return budgetCents - spentCents - billsDueCents
}

/**
 * Returns the number of days remaining in the month, inclusive of `today`.
 * If today is Nov 2 in a 30-day month, days remaining is 29 (Nov 2 through Nov 30).
 * On the last day of the month, days remaining is 1.
 * If today is after the target month, returns 0.
 */
export function daysRemainingInMonth(today: string, month: string): number {
  const [targetYear, targetMonth] = month.split('-').map(Number)
  const [todayYear, todayMonth, todayDay] = today.split('-').map(Number)

  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate()

  if (todayYear < targetYear || (todayYear === targetYear && todayMonth < targetMonth)) {
    // Today is before target month: all days in month remain
    return daysInTargetMonth
  }

  if (todayYear > targetYear || (todayYear === targetYear && todayMonth > targetMonth)) {
    // Today is after target month: 0 days remain
    return 0
  }

  // Today is within target month: inclusive of today
  return Math.max(0, daysInTargetMonth - todayDay + 1)
}

/**
 * Safe to spend per day = left to spend / days remaining.
 * Returns integer cents.
 * If left to spend is <= 0 or days remaining is <= 0, returns 0 cents.
 */
export function calculateSafeToSpendPerDay(leftToSpendCents: number, daysRemaining: number): number {
  assertIntegerCents(leftToSpendCents, 'Left to spend')
  if (daysRemaining <= 0 || leftToSpendCents <= 0) return 0
  return Math.floor(leftToSpendCents / daysRemaining)
}

// ---------- Database Query Service ----------

export interface ComputeLeftToSpendOptions {
  month: string // YYYY-MM
  today: string // YYYY-MM-DD
  currency?: string
}

export function computeLeftToSpend(
  db: Database.Database,
  options: ComputeLeftToSpendOptions
): LeftToSpendResult {
  const { month, today } = options
  const currency = (options.currency || DEFAULT_CURRENCY).toUpperCase().trim()

  // 1. All categories
  const categories = listCategories(db, true)
  const categoryMap = new Map<number, string>()
  for (const c of categories) categoryMap.set(c.id, c.name)

  // 2. Budgets for this month
  const budgets = listBudgets(db, month).filter((b) => b.currency === currency)
  const budgetByCategory = new Map<number, number>()
  let totalBudget = 0
  for (const b of budgets) {
    budgetByCategory.set(b.categoryId, b.amount)
    totalBudget += b.amount
  }

  // 3. Spent so far in this month (type = 'expense', live rows only)
  // Transfers to savings and simple income entries are strictly excluded.
  const spentRows = db.prepare(
    `SELECT category_id, SUM(amount) AS spent
     FROM expense_transactions
     WHERE substr(date, 1, 7) = ? AND type = 'expense' AND currency = ? AND ${LIVE()}
     GROUP BY category_id`
  ).all(month, currency) as { category_id: number | null; spent: number }[]

  const spentByCategory = new Map<number, number>()
  let spentSoFar = 0
  for (const r of spentRows) {
    const amount = Number(r.spent) || 0
    spentSoFar += amount
    if (r.category_id !== null) {
      spentByCategory.set(r.category_id, (spentByCategory.get(r.category_id) ?? 0) + amount)
    }
  }

  // 4. Bills still due this month
  // A recurring bill is still due this month if it is active, not trashed, due in this month (from today onwards),
  // and has not yet been paid for that due date.
  const [yearStr, monthStr] = month.split('-')
  const lastDay = new Date(Date.UTC(Number(yearStr), Number(monthStr), 0)).getUTCDate()
  const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`

  // A bill still due has a next_due_date within [today, monthEnd] (or in this month and unpaid).
  const dueBillsRows = db.prepare(
    `SELECT b.id, b.category_id, b.amount, b.next_due_date
     FROM recurring_bills b
     WHERE b.archived = 0 AND ${LIVE('b')} AND b.currency = ?
       AND b.next_due_date >= ? AND b.next_due_date <= ?
       AND NOT EXISTS (
         SELECT 1 FROM recurring_bill_occurrences o
         WHERE o.recurring_id = b.id AND o.due_date = b.next_due_date AND o.status = 'paid'
       )`
  ).all(currency, today, monthEnd) as {
    id: number
    category_id: number | null
    amount: number
    next_due_date: string
  }[]

  const billsDueByCategory = new Map<number, number>()
  let billsStillDue = 0
  for (const b of dueBillsRows) {
    const amount = b.amount
    billsStillDue += amount
    if (b.category_id !== null) {
      billsDueByCategory.set(b.category_id, (billsDueByCategory.get(b.category_id) ?? 0) + amount)
    }
  }

  // 5. Left to spend & daily safe figure
  const leftToSpend = calculateLeftToSpend(totalBudget, spentSoFar, billsStillDue)
  const daysRemaining = daysRemainingInMonth(today, month)
  const safeToSpendPerDay = calculateSafeToSpendPerDay(leftToSpend, daysRemaining)

  // 6. Category breakdown
  const allCategoryIds = new Set<number>([
    ...budgetByCategory.keys(),
    ...spentByCategory.keys(),
    ...billsDueByCategory.keys()
  ])

  const categoryBreakdowns: CategoryLeftToSpend[] = []
  for (const catId of allCategoryIds) {
    const catName = categoryMap.get(catId) || 'Uncategorized'
    const bAmt = budgetByCategory.get(catId) ?? 0
    const sAmt = spentByCategory.get(catId) ?? 0
    const dAmt = billsDueByCategory.get(catId) ?? 0
    categoryBreakdowns.push({
      categoryId: catId,
      categoryName: catName,
      budgetAmount: bAmt,
      spentAmount: sAmt,
      billsDueAmount: dAmt,
      leftToSpend: bAmt - sAmt - dAmt
    })
  }

  categoryBreakdowns.sort((a, b) => a.categoryName.localeCompare(b.categoryName))

  return {
    month,
    asOfDate: today,
    currency,
    totalBudget,
    spentSoFar,
    billsStillDue,
    leftToSpend,
    daysRemaining,
    safeToSpendPerDay,
    categories: categoryBreakdowns
  }
}
