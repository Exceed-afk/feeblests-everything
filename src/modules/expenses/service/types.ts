// Data models and shapes for the Expenses and Budget module service layer (Phase 1).
//
// Hard rules:
// - All money amounts are stored as integer minor units (cents). Floating point amounts are strictly rejected.
// - All currency codes are uppercase ISO codes (default: 'USD').
// - All tables carry created_at, updated_at, deleted_at, delete_batch_id for soft delete and undo.

export type CurrencyCode = string

export const DEFAULT_CURRENCY: CurrencyCode = 'USD'

export function assertIntegerCents(amount: unknown, fieldName = 'Amount'): asserts amount is number {
  if (typeof amount !== 'number' || !Number.isInteger(amount)) {
    throw new Error(`${fieldName} must be an integer number of cents, got ${String(amount)}`)
  }
}

export function assertPositiveCents(amount: unknown, fieldName = 'Amount'): asserts amount is number {
  assertIntegerCents(amount, fieldName)
  if (amount <= 0) {
    throw new Error(`${fieldName} must be greater than 0 cents, got ${amount}`)
  }
}

export function assertNonNegativeCents(amount: unknown, fieldName = 'Amount'): asserts amount is number {
  assertIntegerCents(amount, fieldName)
  if (amount < 0) {
    throw new Error(`${fieldName} cannot be negative, got ${amount}`)
  }
}

// ---------- Categories ----------

export interface ExpenseCategory {
  id: number
  name: string
  colour: string
  icon: string
  archived: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deleteBatchId: string | null
}

export interface ExpenseCategoryInput {
  name: string
  colour: string
  icon: string
}

// ---------- Transactions ----------

export type ExpenseTxType = 'expense' | 'income' | 'transfer'

export interface ExpenseTransaction {
  id: number
  amount: number // integer cents
  currency: CurrencyCode
  date: string // YYYY-MM-DD
  categoryId: number | null
  payee: string
  note: string
  type: ExpenseTxType
  tags: string[]
  transferTarget: string | null
  recurringId: number | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deleteBatchId: string | null
}

export interface ExpenseTransactionInput {
  amount: number // integer cents (> 0)
  currency?: CurrencyCode
  date: string // YYYY-MM-DD
  categoryId?: number | null
  payee?: string
  note?: string
  type: ExpenseTxType
  tags?: string[]
  transferTarget?: string | null
  recurringId?: number | null
}

// ---------- Budgets ----------

export interface ExpenseBudget {
  id: number
  categoryId: number
  month: string // YYYY-MM
  amount: number // integer cents
  currency: CurrencyCode
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deleteBatchId: string | null
}

export interface ExpenseBudgetInput {
  categoryId: number
  month: string // YYYY-MM
  amount: number // integer cents (>= 0)
  currency?: CurrencyCode
}

// ---------- Recurring Bills & Subscriptions ----------

export type RecurringCadence = 'weekly' | 'monthly' | 'yearly' | 'custom'

export interface RecurringBill {
  id: number
  name: string
  amount: number // integer cents
  currency: CurrencyCode
  cadence: RecurringCadence
  intervalDays: number | null
  nextDueDate: string // YYYY-MM-DD
  categoryId: number | null
  reminderLeadDays: number
  autopay: boolean
  trialEndDate: string | null
  payee: string
  note: string
  archived: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deleteBatchId: string | null
}

export interface RecurringBillInput {
  name: string
  amount: number // integer cents (> 0)
  currency?: CurrencyCode
  cadence: RecurringCadence
  intervalDays?: number | null
  nextDueDate: string // YYYY-MM-DD
  categoryId?: number | null
  reminderLeadDays?: number
  autopay?: boolean
  trialEndDate?: string | null
  payee?: string
  note?: string
}

export type RecurringOccurrenceStatus = 'pending' | 'paid' | 'skipped'

export interface RecurringOccurrence {
  id: number
  recurringId: number
  dueDate: string // YYYY-MM-DD
  status: RecurringOccurrenceStatus
  transactionId: number | null
  paidAt: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deleteBatchId: string | null
}

// ---------- Left-to-Spend & Daily Safe-to-Spend ----------

export interface CategoryLeftToSpend {
  categoryId: number
  categoryName: string
  budgetAmount: number // integer cents
  spentAmount: number // integer cents
  billsDueAmount: number // integer cents
  leftToSpend: number // integer cents
}

export interface LeftToSpendResult {
  month: string // YYYY-MM
  asOfDate: string // YYYY-MM-DD
  currency: CurrencyCode
  totalBudget: number // integer cents
  spentSoFar: number // integer cents
  billsStillDue: number // integer cents
  leftToSpend: number // integer cents (can be negative if over budget)
  daysRemaining: number
  safeToSpendPerDay: number // integer cents (0 if over budget or 0 days remaining)
  categories: CategoryLeftToSpend[]
}

// ---------- Savings Transfer ----------

export interface SavingsTransferInput {
  amountCents: number // integer cents (> 0)
  currency?: CurrencyCode
  goalId: number
  date: string // YYYY-MM-DD
  note?: string
}

export interface SavingsTransferResult {
  expenseTransaction: ExpenseTransaction
  savingsTransactionId: number
  goalId: number
  goalName: string
  amountCents: number
  currency: CurrencyCode
  date: string
  newGoalBalance: number
}
