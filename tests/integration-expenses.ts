// Integration tests for Expenses (Phase 6):
// Calendar (bills due), Search (expense transactions), Trash/Purge, Review, Insights, Assistant.
import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import { createCategory } from '../src/modules/expenses/service/categories'
import { createExpenseTransaction } from '../src/modules/expenses/service/transactions'
import { createRecurringBill } from '../src/modules/expenses/service/recurring'
import { listDueBillsBetween } from '../src/modules/expenses/service/recurring'
import { getCalendar } from '../src/main/calendar'
import { runSearch } from '../src/main/search'
import { listTrash, restoreBatch, deleteBatchForever } from '../src/main/trash'
import { buildReview } from '../src/shared/review'
import { buildInsights, INSIGHT_IDS } from '../src/shared/insights'
import { ASSISTANT_FUNCTIONS } from '../src/shared/assistant'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const openDb = () => {
  const db = openDatabase()
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

test('Expenses on Calendar: upcoming due bills show up on their due date', () => {
  const db = openDb()
  const cat = createCategory(db, { name: 'Internet', colour: '#3b82f6', icon: 'Wifi' })
  createRecurringBill(db, {
    name: 'Fiber Internet',
    amount: 6000,
    cadence: 'monthly',
    nextDueDate: '2026-11-15',
    categoryId: cat.id
  })

  const cal = getCalendar(db, '2026-11', '2026-11-03')
  const day15 = cal.weeks.flat().find((d) => d.date === '2026-11-15')
  assert.ok(day15, 'Day 2026-11-15 exists on calendar grid')
  assert.equal(day15.bills.length, 1)
  assert.equal(day15.bills[0].name, 'Fiber Internet')
  assert.equal(day15.bills[0].amount, 6000)
  db.close()
})

test('Expenses on Search: transactions are indexed and searchable via FTS5', () => {
  const db = openDb()
  const tx = createExpenseTransaction(db, {
    amount: 1450,
    currency: 'USD',
    date: '2026-11-03',
    payee: 'Blue Bottle Coffee',
    note: 'Espresso with friend',
    type: 'expense',
    tags: ['social']
  })

  const res = runSearch(db, 'Bottle')
  assert.ok(res.expenses.items.length >= 1)
  assert.equal(res.expenses.items[0].payee, 'Blue Bottle Coffee')
  assert.equal(res.expenses.items[0].amount, 1450)
  db.close()
})

test('Expenses Trash support: soft delete, list in trash, restore and delete forever', () => {
  const db = openDb()
  const tx = createExpenseTransaction(db, {
    amount: 4500,
    currency: 'USD',
    date: '2026-11-03',
    payee: 'Grocery Store',
    type: 'expense'
  })

  // Trashing the transaction
  db.prepare("UPDATE expense_transactions SET deleted_at = '2026-11-03T12:00:00.000Z', delete_batch_id = 'batch-exp-1' WHERE id = ?").run(tx.id)

  const trashList = listTrash(db)
  const batch = trashList.find((b) => b.batchId === 'batch-exp-1')
  assert.ok(batch, 'Expense transaction found in trash')
  assert.equal(batch.items[0].type, 'expense_tx')

  // Restore
  restoreBatch(db, 'batch-exp-1')
  const live = db.prepare('SELECT id, deleted_at FROM expense_transactions WHERE id = ?').get(tx.id) as { id: number; deleted_at: string | null }
  assert.equal(live.deleted_at, null)

  // Trash again and delete forever
  db.prepare("UPDATE expense_transactions SET deleted_at = '2026-11-03T12:00:00.000Z', delete_batch_id = 'batch-exp-2' WHERE id = ?").run(tx.id)
  deleteBatchForever(db, 'batch-exp-2')
  const gone = db.prepare('SELECT id FROM expense_transactions WHERE id = ?').get(tx.id)
  assert.equal(gone, undefined)
  db.close()
})

test('Expenses in Review: spending totals and top categories are summarized', () => {
  const review = buildReview({
    kind: 'week',
    anchor: '2026-11-03',
    today: '2026-11-04',
    trades: [],
    goals: [],
    txs: [],
    habits: [],
    tasks: [],
    entries: [],
    expenses: [
      { id: 1, amount: 2500, date: '2026-11-03', type: 'expense', categoryId: 1 },
      { id: 2, amount: 1500, date: '2026-11-02', type: 'expense', categoryId: 1 }
    ],
    categories: [{ id: 1, name: 'Food' }]
  })

  assert.ok(review.spending)
  assert.equal(review.spending.totalSpent, 4000)
  assert.equal(review.spending.txCount, 2)
  assert.equal(review.spending.topCategories[0].name, 'Food')
  assert.equal(review.spending.topCategories[0].amount, 4000)
})

test('Expenses in Insights: spend-vs-mood correlation exists', () => {
  const insights = buildInsights({
    today: '2026-11-04',
    start: '2026-10-01',
    end: '2026-11-04',
    habits: [],
    tasks: [],
    completions: [],
    trades: [],
    txs: [],
    entries: [
      { id: 1, date: '2026-11-01', mood: 'great', title: 'Happy', body: '', tags: [], createdAt: '', updatedAt: '' },
      { id: 2, date: '2026-11-02', mood: 'good', title: 'Good', body: '', tags: [], createdAt: '', updatedAt: '' },
      { id: 3, date: '2026-11-03', mood: 'okay', title: 'Normal', body: '', tags: [], createdAt: '', updatedAt: '' },
      { id: 4, date: '2026-11-04', mood: 'low', title: 'Tired', body: '', tags: [], createdAt: '', updatedAt: '' }
    ],
    expenses: [
      { date: '2026-11-01', amount: 8000, type: 'expense' },
      { date: '2026-11-02', amount: 5000, type: 'expense' },
      { date: '2026-11-03', amount: 3000, type: 'expense' },
      { date: '2026-11-04', amount: 1000, type: 'expense' }
    ]
  })

  const spendInsight = insights.correlations.find((c) => c.id === INSIGHT_IDS.spendVsMood)
  assert.ok(spendInsight)
  assert.ok(spendInsight.text.includes('spending'))
})

test('Expenses in Assistant: spending_total function answers category and date range queries', () => {
  const fn = ASSISTANT_FUNCTIONS.find((f) => f.name === 'spending_total')
  assert.ok(fn, 'spending_total exists in assistant functions')

  const res = fn.run(
    {
      txs: [],
      goals: [],
      trades: [],
      habits: [],
      tasks: [],
      completions: [],
      entries: [],
      expenses: [
        { id: 1, amount: 2500, currency: 'USD', date: '2026-11-02', categoryName: 'Food', type: 'expense', payee: 'Cafe' },
        { id: 2, amount: 7500, currency: 'USD', date: '2026-11-03', categoryName: 'Tech', type: 'expense', payee: 'Store' }
      ]
    },
    { from: '2026-11-01', to: '2026-11-05' },
    '2026-11-05',
    { category: 'food' }
  )

  assert.equal(res.type, 'number')
  assert.equal(res.value, 25) // 2500 cents = $25
})

console.log(`\n${n} expenses integration checks passed`)
