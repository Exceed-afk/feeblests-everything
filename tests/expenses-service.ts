import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import {
  calculateLeftToSpend,
  calculateSafeToSpendPerDay,
  daysRemainingInMonth,
  computeLeftToSpend,
  advanceRecurringDueDate,
  generateRecurringBills,
  markRecurringBillPaid,
  transferLeftoverToSavings,
  createCategory,
  listCategories,
  archiveCategory,
  deleteCategory,
  createExpenseTransaction,
  listExpenseTransactions,
  deleteExpenseTransaction,
  setBudget,
  listBudgets,
  copyBudgetsFromPreviousMonth,
  createRecurringBill,
  listRecurringBills,
  deleteRecurringBill,
  listDueBillsThisMonth
} from '../src/modules/expenses/service'
import { createGoal, listGoals, listTransactions } from '../src/main/savings'

let n = 0
const test = (name: string, fn: () => void | Promise<void>) => {
  const r = fn()
  if (r instanceof Promise) {
    return r.then(() => { n++; console.log('ok  ', name) })
  }
  n++
  console.log('ok  ', name)
}

function openDb() {
  const db = openDatabase()
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

// ---------------------------------------------------------------------------
// 1. Pure math: left-to-spend & safe-to-spend-per-day
// ---------------------------------------------------------------------------

test('calculateLeftToSpend subtracts spent so far and bills still due from budget', () => {
  // budget 1000.00 (100000 cents), spent 350.00 (35000 cents), bills due 150.00 (15000 cents)
  // left = 100000 - 35000 - 15000 = 50000 cents ($500.00)
  assert.equal(calculateLeftToSpend(100000, 35000, 15000), 50000)

  // over budget: budget 50000, spent 60000, bills due 10000 -> -20000
  assert.equal(calculateLeftToSpend(50000, 60000, 10000), -20000)

  // zero budget: budget 0, spent 2500, bills due 0 -> -2500
  assert.equal(calculateLeftToSpend(0, 2500, 0), -2500)

  // reject non-integers (float cents forbidden)
  assert.throws(() => calculateLeftToSpend(100.5, 50, 0), /integer/i)
  assert.throws(() => calculateLeftToSpend(100, 50.25, 0), /integer/i)
  assert.throws(() => calculateLeftToSpend(100, 50, 10.1), /integer/i)
})

test('daysRemainingInMonth handles mid-month, last day, leap years and past months', () => {
  // 30-day month: Nov 2 -> 29 days remaining (Nov 2 through Nov 30 inclusive)
  assert.equal(daysRemainingInMonth('2026-11-02', '2026-11'), 29)

  // Nov 1 -> 30 days remaining
  assert.equal(daysRemainingInMonth('2026-11-01', '2026-11'), 30)

  // Nov 30 (last day of month) -> 1 day remaining
  assert.equal(daysRemainingInMonth('2026-11-30', '2026-11'), 1)

  // 31-day month: Dec 31 -> 1 day remaining
  assert.equal(daysRemainingInMonth('2026-12-31', '2026-12'), 1)

  // Non-leap Feb (28 days): 2026-02-01 -> 28 days
  assert.equal(daysRemainingInMonth('2026-02-01', '2026-02'), 28)
  assert.equal(daysRemainingInMonth('2026-02-28', '2026-02'), 1)

  // Leap Feb (29 days): 2024-02-01 -> 29 days
  assert.equal(daysRemainingInMonth('2024-02-01', '2024-02'), 29)
  assert.equal(daysRemainingInMonth('2024-02-29', '2024-02'), 1)

  // Today is after month (past month) -> 0 days remaining
  assert.equal(daysRemainingInMonth('2026-11-02', '2026-10'), 0)
})

test('calculateSafeToSpendPerDay divides left-to-spend by days remaining and floors to zero when over budget', () => {
  // 45000 cents over 29 days -> Math.floor(45000 / 29) = 1551 cents ($15.51/day)
  assert.equal(calculateSafeToSpendPerDay(45000, 29), 1551)

  // Last day: 10000 cents with 1 day remaining -> 10000 cents
  assert.equal(calculateSafeToSpendPerDay(10000, 1), 10000)

  // Over budget (negative left to spend): safe to spend is 0 cents
  assert.equal(calculateSafeToSpendPerDay(-5000, 20), 0)

  // No days remaining: 0 cents
  assert.equal(calculateSafeToSpendPerDay(5000, 0), 0)

  // Reject non-integers
  assert.throws(() => calculateSafeToSpendPerDay(100.5, 10), /integer/i)
})

test('advanceRecurringDueDate advances weekly, monthly, yearly, custom with month-end clamping', () => {
  // Weekly: +7 days
  assert.equal(advanceRecurringDueDate('2026-11-02', 'weekly'), '2026-11-09')

  // Custom interval: +14 days
  assert.equal(advanceRecurringDueDate('2026-11-02', 'custom', 14), '2026-11-16')

  // Monthly standard
  assert.equal(advanceRecurringDueDate('2026-11-15', 'monthly'), '2026-12-15')

  // Monthly month-end clamping: Jan 31 -> Feb 28 (2026 is non-leap)
  assert.equal(advanceRecurringDueDate('2026-01-31', 'monthly'), '2026-02-28')

  // Monthly preserving anchor: from Feb 28 back to Mar 31 when anchor was Jan 31
  assert.equal(advanceRecurringDueDate('2026-02-28', 'monthly', null, '2026-01-31'), '2026-03-31')

  // Yearly leap day: 2024-02-29 -> 2025-02-28
  assert.equal(advanceRecurringDueDate('2024-02-29', 'yearly'), '2025-02-28')
})

// ---------------------------------------------------------------------------
// 2. Categories, Budgets & Transactions
// ---------------------------------------------------------------------------

test('categories are seeded and support CRUD with archive and soft-delete', () => {
  const db = openDb()
  const initial = listCategories(db)
  assert.ok(initial.length >= 8, 'Default categories must be seeded')
  assert.ok(initial.some((c) => c.name === 'Food & Dining'))

  const custom = createCategory(db, { name: 'Fitness', colour: '#10b981', icon: 'Dumbbell' })
  assert.equal(custom.name, 'Fitness')

  archiveCategory(db, custom.id, true)
  const active = listCategories(db)
  assert.ok(!active.some((c) => c.id === custom.id), 'Archived category not in default active list')

  const all = listCategories(db, true)
  assert.ok(all.some((c) => c.id === custom.id), 'Archived category in includeArchived list')

  deleteCategory(db, custom.id)
  const afterDelete = listCategories(db, true)
  assert.ok(!afterDelete.some((c) => c.id === custom.id), 'Deleted category excluded from all active reads')

  db.close()
})

test('expense transactions enforce integer cents, currency code and soft delete', () => {
  const db = openDb()
  const [cat] = listCategories(db)

  // Rejects floating point amounts
  assert.throws(() => createExpenseTransaction(db, {
    amount: 12.5, currency: 'USD', date: '2026-11-02', categoryId: cat.id,
    payee: 'Cafe', note: 'Coffee', type: 'expense'
  }), /integer/i)

  // Rejects non-positive amount
  assert.throws(() => createExpenseTransaction(db, {
    amount: 0, currency: 'USD', date: '2026-11-02', categoryId: cat.id,
    payee: 'Cafe', note: 'Coffee', type: 'expense'
  }), /greater than 0/i)

  // Valid expense transaction (1250 cents = $12.50)
  const tx = createExpenseTransaction(db, {
    amount: 1250, currency: 'USD', date: '2026-11-02', categoryId: cat.id,
    payee: 'Cafe', note: 'Coffee', type: 'expense', tags: ['coffee']
  })
  assert.equal(tx.amount, 1250)
  assert.equal(tx.currency, 'USD')

  let list = listExpenseTransactions(db, { month: '2026-11' })
  assert.equal(list.length, 1)

  // Soft delete
  deleteExpenseTransaction(db, tx.id)
  list = listExpenseTransactions(db, { month: '2026-11' })
  assert.equal(list.length, 0, 'Deleted transactions must be excluded from list')

  db.close()
})

test('budgets support setting, listing and copying from previous month', () => {
  const db = openDb()
  const cats = listCategories(db)
  const c1 = cats[0]
  const c2 = cats[1]

  setBudget(db, { categoryId: c1.id, month: '2026-11', amount: 50000, currency: 'USD' })
  setBudget(db, { categoryId: c2.id, month: '2026-11', amount: 30000, currency: 'USD' })

  const bNov = listBudgets(db, '2026-11')
  assert.equal(bNov.length, 2)
  assert.equal(bNov.reduce((acc, b) => acc + b.amount, 0), 80000)

  // Copy budgets to Dec
  const copied = copyBudgetsFromPreviousMonth(db, '2026-12')
  assert.equal(copied.length, 2)

  const bDec = listBudgets(db, '2026-12')
  assert.equal(bDec.length, 2)
  assert.equal(bDec.reduce((acc, b) => acc + b.amount, 0), 80000)

  db.close()
})

// ---------------------------------------------------------------------------
// 3. Database query: computeLeftToSpend
// ---------------------------------------------------------------------------

test('computeLeftToSpend computes left-to-spend and safe-to-spend-per-day excluding trashed rows, income and transfers', () => {
  const db = openDb()
  const cats = listCategories(db)
  const food = cats.find((c) => c.name === 'Food & Dining')!
  const transport = cats.find((c) => c.name === 'Transport')!

  // Budgets for November: Food 600.00 (60000 cents), Transport 400.00 (40000 cents) -> Total 1000.00 (100000 cents)
  setBudget(db, { categoryId: food.id, month: '2026-11', amount: 60000, currency: 'USD' })
  setBudget(db, { categoryId: transport.id, month: '2026-11', amount: 40000, currency: 'USD' })

  // Expenses in November up to Nov 2:
  // Food expense: 150.00 (15000 cents)
  createExpenseTransaction(db, { amount: 15000, currency: 'USD', date: '2026-11-01', categoryId: food.id, payee: 'Market', note: '', type: 'expense' })
  // Transport expense: 50.00 (5000 cents)
  createExpenseTransaction(db, { amount: 5000, currency: 'USD', date: '2026-11-02', categoryId: transport.id, payee: 'Train', note: '', type: 'expense' })

  // Income: 2000.00 (200000 cents) - income must NOT be added to spentSoFar
  createExpenseTransaction(db, { amount: 200000, currency: 'USD', date: '2026-11-01', categoryId: null, payee: 'Employer', note: 'Salary', type: 'income' })

  // Transfer: 100.00 (10000 cents) - transfers must NOT be counted as expenses
  createExpenseTransaction(db, { amount: 10000, currency: 'USD', date: '2026-11-02', categoryId: null, payee: '', note: 'Transfer to savings', type: 'transfer' })

  // Trashed expense: 80.00 (8000 cents) - must be EXCLUDED from spentSoFar
  const trashedTx = createExpenseTransaction(db, { amount: 8000, currency: 'USD', date: '2026-11-02', categoryId: food.id, payee: 'Snack', note: '', type: 'expense' })
  deleteExpenseTransaction(db, trashedTx.id)

  // Recurring bill due Nov 15: 100.00 (10000 cents)
  createRecurringBill(db, {
    name: 'Internet', amount: 10000, currency: 'USD', cadence: 'monthly',
    nextDueDate: '2026-11-15', categoryId: transport.id, autopay: false
  })

  // Recurring bill due in December (outside this month): 5000 cents - should NOT be included in November bills still due
  createRecurringBill(db, {
    name: 'Gym', amount: 5000, currency: 'USD', cadence: 'monthly',
    nextDueDate: '2026-12-01', categoryId: null, autopay: false
  })

  // Calculate as of Nov 2, 2026 (29 days remaining in 30-day November)
  const result = computeLeftToSpend(db, { month: '2026-11', today: '2026-11-02', currency: 'USD' })

  // Total budget = 100000 cents
  assert.equal(result.totalBudget, 100000)

  // Spent so far = 15000 + 5000 = 20000 cents (income, transfer, and trashed excluded)
  assert.equal(result.spentSoFar, 20000)

  // Bills still due = 10000 cents (Internet bill due Nov 15)
  assert.equal(result.billsStillDue, 10000)

  // Left to spend = 100000 - 20000 - 10000 = 70000 cents ($700.00)
  assert.equal(result.leftToSpend, 70000)

  // Days remaining = 29
  assert.equal(result.daysRemaining, 29)

  // Safe to spend per day = Math.floor(70000 / 29) = 2413 cents ($24.13/day)
  assert.equal(result.safeToSpendPerDay, 2413)

  // Category breakdown
  const foodBreakdown = result.categories.find((c) => c.categoryId === food.id)!
  assert.equal(foodBreakdown.budgetAmount, 60000)
  assert.equal(foodBreakdown.spentAmount, 15000)
  assert.equal(foodBreakdown.billsDueAmount, 0)
  assert.equal(foodBreakdown.leftToSpend, 45000)

  const transportBreakdown = result.categories.find((c) => c.categoryId === transport.id)!
  assert.equal(transportBreakdown.budgetAmount, 40000)
  assert.equal(transportBreakdown.spentAmount, 5000)
  assert.equal(transportBreakdown.billsDueAmount, 10000)
  assert.equal(transportBreakdown.leftToSpend, 25000)

  db.close()
})

// ---------------------------------------------------------------------------
// 4. Recurring bill generation: catch-up, launch & idempotency
// ---------------------------------------------------------------------------

test('generateRecurringBills catches up missed periods, generates autopay transactions and is idempotent', () => {
  const db = openDb()
  const cats = listCategories(db)
  const cat = cats[0]

  // Weekly autopay bill that started 2 weeks ago ('2026-10-19').
  // Today is '2026-11-02'.
  // Occurrences due: Oct 19, Oct 26, Nov 02 (3 occurrences).
  const bill = createRecurringBill(db, {
    name: 'Weekly Cloud Subscription',
    amount: 2500, // $25.00
    currency: 'USD',
    cadence: 'weekly',
    nextDueDate: '2026-10-19',
    categoryId: cat.id,
    autopay: true,
    payee: 'CloudCo'
  })

  // 1. Run generation on launch at 2026-11-02
  const run1 = generateRecurringBills(db, '2026-11-02')
  assert.equal(run1.generatedCount, 3, 'Must catch up all 3 missed occurrences up to today')
  assert.equal(run1.paidCount, 3, 'All 3 occurrences were autopaid')

  // Check generated transactions
  const txs = listExpenseTransactions(db, {})
  assert.equal(txs.length, 3)
  assert.deepEqual(txs.map((t) => t.date).sort(), ['2026-10-19', '2026-10-26', '2026-11-02'])

  // Check bill's next_due_date advanced past today to 2026-11-09
  const updatedBill = listRecurringBills(db).find((b) => b.id === bill.id)!
  assert.equal(updatedBill.nextDueDate, '2026-11-09')

  // 2. Idempotency test: Run generation again on the same day
  const run2 = generateRecurringBills(db, '2026-11-02')
  assert.equal(run2.generatedCount, 0, 'Must not duplicate any occurrence')
  assert.equal(run2.paidCount, 0)
  assert.equal(listExpenseTransactions(db, {}).length, 3, 'Transaction count must remain 3')

  // 3. Non-autopay bill: generates pending occurrences
  const manualBill = createRecurringBill(db, {
    name: 'Manual Electricity Bill',
    amount: 8000,
    currency: 'USD',
    cadence: 'monthly',
    nextDueDate: '2026-11-01',
    categoryId: cat.id,
    autopay: false
  })

  const run3 = generateRecurringBills(db, '2026-11-02')
  assert.equal(run3.generatedCount, 1)
  assert.equal(run3.paidCount, 0, 'Non-autopay bill is pending, not paid')

  // Marking manual bill as paid
  const paidResult = markRecurringBillPaid(db, {
    recurringId: manualBill.id,
    dueDate: '2026-11-01',
    paidDate: '2026-11-02'
  })
  assert.equal(paidResult.occurrence.status, 'paid')
  assert.equal(paidResult.transaction.amount, 8000)

  // Transaction was created
  const txsAfterManual = listExpenseTransactions(db, {})
  assert.equal(txsAfterManual.length, 4)

  // Trashed bill is ignored
  const trashedBill = createRecurringBill(db, {
    name: 'Old Service',
    amount: 1000,
    currency: 'USD',
    cadence: 'weekly',
    nextDueDate: '2026-10-01',
    autopay: true
  })
  deleteRecurringBill(db, trashedBill.id)

  const run4 = generateRecurringBills(db, '2026-11-02')
  assert.equal(run4.generatedCount, 0, 'Trashed recurring bill must not generate occurrences')

  db.close()
})

// ---------------------------------------------------------------------------
// 5. Savings deposit + transfer in one database transaction
// ---------------------------------------------------------------------------

test('transferLeftoverToSavings creates expense transfer and savings deposit in one database transaction', () => {
  const db = openDb()

  // Create a savings goal
  const goal = createGoal(db, { name: 'Emergency Stash', target: 1000, notes: '' })
  assert.equal(goal.balance, 0)

  // Transfer 150.00 (15000 cents) leftover budget to the savings goal
  const result = transferLeftoverToSavings(db, {
    amountCents: 15000,
    currency: 'USD',
    goalId: goal.id,
    date: '2026-11-02',
    note: 'November leftover'
  })

  assert.equal(result.amountCents, 15000)
  assert.equal(result.currency, 'USD')
  assert.equal(result.goalId, goal.id)
  assert.equal(result.newGoalBalance, 150) // $150.00 in savings goal

  // Verify expense transaction exists as transfer
  const expenseTxs = listExpenseTransactions(db, { type: 'transfer' })
  assert.equal(expenseTxs.length, 1)
  assert.equal(expenseTxs[0].amount, 15000)
  assert.equal(expenseTxs[0].type, 'transfer')
  assert.equal(expenseTxs[0].transferTarget, `savings:${goal.id}`)

  // Verify savings transaction exists as deposit
  const savingsTxs = listTransactions(db, goal.id)
  assert.equal(savingsTxs.length, 1)
  assert.equal(savingsTxs[0].amount, 150)
  assert.equal(savingsTxs[0].kind, 'deposit')

  // Verify savings goal updated balance
  const updatedGoal = listGoals(db).find((g) => g.id === goal.id)!
  assert.equal(updatedGoal.balance, 150)

  // Atomicity test: If goal does not exist, transaction rolls back completely
  assert.throws(() => transferLeftoverToSavings(db, {
    amountCents: 5000,
    currency: 'USD',
    goalId: 999999, // non-existent goal
    date: '2026-11-02'
  }), /Goal not found/i)

  // Verify no orphaned expense transaction was created
  assert.equal(listExpenseTransactions(db, { type: 'transfer' }).length, 1)

  // Rejects invalid non-integer or <= 0 cents
  assert.throws(() => transferLeftoverToSavings(db, {
    amountCents: 100.5,
    currency: 'USD',
    goalId: goal.id,
    date: '2026-11-02'
  }), /integer/i)

  assert.throws(() => transferLeftoverToSavings(db, {
    amountCents: 0,
    currency: 'USD',
    goalId: goal.id,
    date: '2026-11-02'
  }), /greater than 0/i)

  db.close()
})

console.log(`\n${n} Phase 1 expenses service tests passed`)
