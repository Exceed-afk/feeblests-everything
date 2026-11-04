import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './sqlite'
import { MIGRATIONS, applyMigrations } from '../src/main/migrations'
import { createGoal, addTransaction, deleteTransaction, deleteGoal, listTransactions, listAllTransactions, listGoals } from '../src/main/savings'
import { createTrade, deleteTrade, listTrades, tradeMeta } from '../src/main/trades'
import { createHabit, setCheckin, deleteHabit, listHabits } from '../src/main/habits'
import { localDate } from '../src/main/util'
import { addDays } from '../src/shared/habits'
import { createEntry, deleteEntry, listEntries } from '../src/main/logbook'
import { createTask, deleteTasks, listTasks } from '../src/main/tasks'
import { listTrash, restoreBatch, deleteBatchForever } from '../src/main/trash'
import { addLink, listLinksFor } from '../src/main/links'
import { normalizeTagName, normalizeTags, splitTagInput } from '../src/shared/tags'
import { ensureTags, setEntityTags, tagsOf, tagCounts } from '../src/main/tags'
import { runSearch } from '../src/main/search'
import { getDashboard } from '../src/main/dashboard'

let n = 0
const test = (name: string, fn: () => void | Promise<void>) => {
  const r = fn()
  if (r instanceof Promise) {
    return r.then(() => { n++; console.log('ok  ', name) })
  }
  n++
  console.log('ok  ', name)
}

const makeTaskInput = (title: string, overrides: Partial<import('../src/shared/types').TaskInput> = {}) => ({
  title, notes: '', status: 'todo' as const, priority: 'medium' as const,
  dueDate: null, dueTime: null, project: null, tags: [], subtasks: [],
  recurrenceRule: null, recurrenceNext: null,
  ...overrides
})

// ---------------------------------------------------------------------------
// 1. Totals ignoring trashed rows (savings, trades, habits)
// ---------------------------------------------------------------------------

function openLiveDb() {
  const db = openDatabase()
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

test('savings totals ignore trashed transactions', () => {
  const db = openLiveDb()
  const goal = createGoal(db, { name: 'Emergency Fund', target: 1000, notes: '' })
  addTransaction(db, { goalId: goal.id, date: '2026-11-01', kind: 'deposit', amount: 100, note: 'Seed' })
  const tx2 = addTransaction(db, { goalId: goal.id, date: '2026-11-02', kind: 'deposit', amount: 200, note: 'Bonus' })
  addTransaction(db, { goalId: goal.id, date: '2026-11-02', kind: 'withdrawal', amount: 50, note: 'Expense' })

  let currentGoal = listGoals(db).find((g) => g.id === goal.id)!
  assert.equal(currentGoal.balance, 250)
  assert.equal(currentGoal.txCount, 3)

  // Trash deposit tx2 (amount 200). Balance was 250, now should be 50.
  deleteTransaction(db, tx2.id)

  currentGoal = listGoals(db).find((g) => g.id === goal.id)!
  assert.equal(currentGoal.balance, 50, 'Goal balance must exclude trashed deposit')
  assert.equal(currentGoal.txCount, 2, 'Transaction count must exclude trashed rows')

  const txs = listTransactions(db, goal.id)
  assert.equal(txs.length, 2)
  assert.ok(!txs.some((t) => t.id === tx2.id), 'listTransactions must not return trashed transactions')

  const allTxs = listAllTransactions(db)
  assert.ok(!allTxs.some((t) => t.id === tx2.id), 'listAllTransactions must not return trashed transactions')

  db.close()
})

test('trade totals and P&L ignore trashed trades', () => {
  const db = openLiveDb()
  const t1 = createTrade(db, {
    date: '2026-11-01', asset: 'XAUUSD', direction: 'long',
    entryPrice: 2000, exitPrice: 2020, quantity: 1, fees: 0, notes: 'Win 1', tags: ['gold']
  })
  const t2 = createTrade(db, {
    date: '2026-11-02', asset: 'ETHUSDT', direction: 'long',
    entryPrice: 2500, exitPrice: 2550, quantity: 1, fees: 0, notes: 'Win 2', tags: ['crypto']
  })

  let trades = listTrades(db, {})
  assert.equal(trades.length, 2)
  assert.equal(trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0), 70)

  // Trash trade t2
  deleteTrade(db, t2.id)

  trades = listTrades(db, {})
  assert.equal(trades.length, 1)
  assert.equal(trades[0].id, t1.id)
  assert.equal(trades[0].pnl, 20, 'Trade P&L sum must exclude trashed trade')

  const meta = tradeMeta(db)
  assert.deepEqual(meta.assets, ['XAUUSD'], 'Trade assets meta must exclude trashed trades')
  assert.ok(!meta.tags.some((t) => t.tag === 'crypto'), 'Trade tags meta must exclude trashed trades')

  db.close()
})

test('habit lists and streaks ignore trashed habits', () => {
  const db = openLiveDb()
  const today = localDate()
  const habit = createHabit(db, {
    name: 'Morning stretch', notes: '', days: [0, 1, 2, 3, 4, 5, 6], archived: false,
    type: 'check', target: null, unit: '', timeOfDay: 'morning'
  })
  setCheckin(db, habit.id, addDays(today, -1), true)
  setCheckin(db, habit.id, today, true)

  let overview = listHabits(db)
  assert.equal(overview.habits.length, 1)
  assert.equal(overview.habits[0].stats.current, 2)

  // Trash habit
  deleteHabit(db, habit.id)

  overview = listHabits(db)
  assert.equal(overview.habits.length, 0, 'listHabits must not return trashed habits')

  db.close()
})

// ---------------------------------------------------------------------------
// 2. Restore bringing totals back
// ---------------------------------------------------------------------------

test('restoring trashed rows brings totals back', () => {
  const db = openLiveDb()

  // Savings
  const goal = createGoal(db, { name: 'Trip', target: 500, notes: '' })
  addTransaction(db, { goalId: goal.id, date: '2026-11-01', kind: 'deposit', amount: 100, note: '' })
  const tx = addTransaction(db, { goalId: goal.id, date: '2026-11-02', kind: 'deposit', amount: 200, note: '' })
  const txBatch = deleteTransaction(db, tx.id)
  assert.equal(listGoals(db)[0].balance, 100)

  restoreBatch(db, txBatch)
  assert.equal(listGoals(db)[0].balance, 300, 'Restoring transaction brings balance back')

  // Trades
  const trade = createTrade(db, {
    date: '2026-11-01', asset: 'BTC', direction: 'long',
    entryPrice: 60000, exitPrice: 61000, quantity: 1, fees: 0, notes: '', tags: []
  })
  const tradeBatch = deleteTrade(db, trade.id)
  assert.equal(listTrades(db, {}).length, 0)

  restoreBatch(db, tradeBatch)
  const restoredTrades = listTrades(db, {})
  assert.equal(restoredTrades.length, 1)
  assert.equal(restoredTrades[0].pnl, 1000, 'Restoring trade brings trade and P&L back')

  // Habits
  const habit = createHabit(db, {
    name: 'Drink water', notes: '', days: [0, 1, 2, 3, 4, 5, 6], archived: false,
    type: 'check', target: null, unit: '', timeOfDay: 'morning'
  })
  setCheckin(db, habit.id, localDate(), true)
  const habitBatch = deleteHabit(db, habit.id)
  assert.equal(listHabits(db).habits.length, 0)

  restoreBatch(db, habitBatch)
  const restoredHabits = listHabits(db).habits
  assert.equal(restoredHabits.length, 1)
  assert.equal(restoredHabits[0].name, 'Drink water')
  assert.equal(restoredHabits[0].stats.current >= 1, true)

  db.close()
})

// ---------------------------------------------------------------------------
// 3. Batch delete and restore
// ---------------------------------------------------------------------------

test('parent and sub-items delete and restore under one delete_batch_id', () => {
  const db = openLiveDb()

  // Savings goal + transactions batch
  const goal = createGoal(db, { name: 'Car fund', target: 5000, notes: '' })
  addTransaction(db, { goalId: goal.id, date: '2026-11-01', kind: 'deposit', amount: 500, note: 'Deposit 1' })
  addTransaction(db, { goalId: goal.id, date: '2026-11-02', kind: 'deposit', amount: 300, note: 'Deposit 2' })

  const batchId = deleteGoal(db, goal.id)
  assert.ok(batchId, 'deleteGoal must return a batch id')

  // Verify goal and transactions share the batch id
  const trashedGoal = db.prepare('SELECT delete_batch_id, deleted_at FROM savings_goals WHERE id = ?').get(goal.id) as { delete_batch_id: string; deleted_at: string }
  const trashedTxs = db.prepare('SELECT delete_batch_id, deleted_at FROM savings_transactions WHERE goal_id = ?').all(goal.id) as { delete_batch_id: string; deleted_at: string }[]

  assert.equal(trashedGoal.delete_batch_id, batchId)
  assert.equal(trashedTxs.length, 2)
  for (const tx of trashedTxs) {
    assert.equal(tx.delete_batch_id, batchId, 'Transactions must share the goal delete_batch_id')
    assert.ok(tx.deleted_at)
  }

  // Trash page lists it as ONE batch with 3 items
  const batches = listTrash(db)
  const goalBatch = batches.find((b) => b.batchId === batchId)
  assert.ok(goalBatch, 'listTrash must find the batch')
  assert.equal(goalBatch.count, 3, 'Batch should contain goal + 2 transactions')

  // Live listings are empty
  assert.equal(listGoals(db).length, 0)
  assert.equal(listAllTransactions(db).length, 0)

  // Restore the whole batch together
  const restoredCount = restoreBatch(db, batchId)
  assert.equal(restoredCount, 3)

  const liveGoals = listGoals(db)
  assert.equal(liveGoals.length, 1)
  assert.equal(liveGoals[0].balance, 800)
  assert.equal(listAllTransactions(db).length, 2)

  // Task multi-select bulk delete and restore
  const t1 = createTask(db, makeTaskInput('Task 1'))
  const t2 = createTask(db, makeTaskInput('Task 2'))
  const t3 = createTask(db, makeTaskInput('Task 3'))

  const taskBatch = deleteTasks(db, [t1.id, t2.id])
  assert.ok(taskBatch)

  const remaining = listTasks(db)
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].id, t3.id)

  restoreBatch(db, taskBatch)
  assert.equal(listTasks(db).length, 3, 'Restoring task batch restores all tasks in that batch')

  db.close()
})

// ---------------------------------------------------------------------------
// 4. Link visibility with trashed items
// ---------------------------------------------------------------------------

test('links to trashed items are hidden and reappear on restore, pruned on delete-forever', () => {
  const db = openLiveDb()

  const entry = createEntry(db, { date: '2026-11-02', title: 'Daily journal', body: 'Productive day', mood: 'good', tags: [] })
  const task = createTask(db, makeTaskInput('Complete review', { priority: 'high', dueDate: '2026-11-02' }))

  // Link task and journal entry
  const linkId = addLink(db, { type: 'task', id: task.id }, { type: 'logbook', id: entry.id })
  assert.ok(linkId > 0)

  // Check visible from both sides
  const taskLinks = listLinksFor(db, 'task', task.id)
  assert.equal(taskLinks.length, 1)
  assert.equal(taskLinks[0].type, 'logbook')
  assert.equal(taskLinks[0].id, entry.id)
  assert.equal(taskLinks[0].label, 'Daily journal')

  const entryLinks = listLinksFor(db, 'logbook', entry.id)
  assert.equal(entryLinks.length, 1)
  assert.equal(entryLinks[0].type, 'task')
  assert.equal(entryLinks[0].id, task.id)
  assert.equal(entryLinks[0].label, 'Complete review')

  // Trash the journal entry
  const entryBatch = deleteEntry(db, entry.id)

  // Link should be hidden from task side
  assert.equal(listLinksFor(db, 'task', task.id).length, 0, 'Link must be hidden when target is trashed')

  // Restore the journal entry
  restoreBatch(db, entryBatch)

  // Link reappears on both sides
  assert.equal(listLinksFor(db, 'task', task.id).length, 1, 'Link must reappear when item is restored')
  assert.equal(listLinksFor(db, 'logbook', entry.id).length, 1)

  // Trash again and delete forever
  const entryBatch2 = deleteEntry(db, entry.id)
  deleteBatchForever(db, entryBatch2)

  // Link row should be pruned from links table entirely
  const rawLink = db.prepare('SELECT id FROM links WHERE id = ?').get(linkId)
  assert.equal(rawLink, undefined, 'Links pointing to permanently deleted items must be pruned')

  db.close()
})

// ---------------------------------------------------------------------------
// 5. Migration on a copy of existing data
// ---------------------------------------------------------------------------

test('migration upgrades a copy of existing data, preserves rows, and builds search index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feeblest-phase0-migration-'))
  const originalPath = join(dir, 'original.db')
  const copyPath = join(dir, 'migrated.db')

  try {
    // 1. Create a database at version 16 (the pre-Phase-0 schema)
    const oldDb = openDatabase(originalPath)
    oldDb.pragma('foreign_keys = ON')
    for (let i = 0; i < 16; i++) oldDb.exec(MIGRATIONS[i])
    oldDb.pragma('user_version = 16')

    // Seed data into pre-Phase-0 tables
    oldDb.prepare("INSERT INTO settings (key, value) VALUES ('theme', '\"dark\"')").run()
    oldDb.prepare("INSERT INTO logbook_entries (date, title, body, mood, tags, created_at, updated_at) VALUES ('2026-10-30', 'Old Entry', 'Old body text', 'good', '[\"journal\"]', '2026-10-30T10:00:00.000Z', '2026-10-30T10:00:00.000Z')").run()
    oldDb.prepare("INSERT INTO trades (date, asset, direction, entry_price, exit_price, quantity, fees, notes, tags, created_at, updated_at, closed_at) VALUES ('2026-10-30', 'XAUUSD', 'long', 1950, 1980, 1, 0, 'Gold breakout', '[\"precious\"]', 'now', 'now', 'now')").run()
    oldDb.prepare("INSERT INTO savings_goals (name, target, notes, created_at, updated_at) VALUES ('Vacation', 2000, 'Summer trip', 'now', 'now')").run()
    oldDb.prepare("INSERT INTO savings_transactions (goal_id, date, kind, amount, note, created_at, updated_at) VALUES (1, '2026-10-30', 'deposit', 500, 'Initial deposit', 'now', 'now')").run()
    oldDb.prepare("INSERT INTO habits (name, notes, days, archived, start_date, created_at, updated_at, type, target, unit, sort_order, time_of_day, reminder_time, auto_complete_on) VALUES ('Reading', '', '[0,1,2,3,4,5,6]', 0, '2026-10-01', 'now', 'now', 'check', null, '', 0, 'anytime', null, '')").run()
    oldDb.prepare("INSERT INTO tasks (title, notes, status, priority, due_date, due_time, created_at, completed_at, deleted_at, project, tags, position, recurrence_rule, recurrence_next) VALUES ('Fix roof', 'Call contractor', 'todo', 'high', '2026-11-05', null, '2026-10-30T10:00:00.000Z', null, null, 'Home', '[\"repair\"]', 1, null, null)").run()
    oldDb.close()

    // 2. Make a copy of the database file
    copyFileSync(originalPath, copyPath)

    // 3. Migrate the copy
    const migratedDb = openDatabase(copyPath)
    migratedDb.pragma('foreign_keys = ON')
    applyMigrations(migratedDb)

    // 4. Verify version and column integrity
    assert.equal(migratedDb.pragma('user_version', { simple: true }), MIGRATIONS.length)

    const entry = migratedDb.prepare('SELECT id, title, deleted_at, delete_batch_id FROM logbook_entries WHERE id = 1').get() as { id: number; title: string; deleted_at: string | null; delete_batch_id: string | null }
    assert.equal(entry.title, 'Old Entry')
    assert.equal(entry.deleted_at, null)

    const trade = migratedDb.prepare('SELECT id, asset, deleted_at FROM trades WHERE id = 1').get() as { id: number; asset: string; deleted_at: string | null }
    assert.equal(trade.asset, 'XAUUSD')
    assert.equal(trade.deleted_at, null)

    const task = migratedDb.prepare('SELECT id, title, updated_at, deleted_at FROM tasks WHERE id = 1').get() as { id: number; title: string; updated_at: string; deleted_at: string | null }
    assert.equal(task.title, 'Fix roof')
    assert.equal(task.updated_at, '2026-10-30T10:00:00.000Z', 'Tasks updated_at must be backfilled from created_at')

    // 5. Verify the FTS5 search_index was created and seeded with existing data
    const searchLog = runSearch(migratedDb, 'Old Entry')
    assert.equal(searchLog.logbook.items.length, 1)
    assert.equal(searchLog.logbook.items[0].title, 'Old Entry')

    const searchTrade = runSearch(migratedDb, 'Gold breakout')
    assert.equal(searchTrade.trades.items.length, 1)

    const searchTask = runSearch(migratedDb, 'contractor')
    assert.equal(searchTask.tasks.items.length, 1)

    migratedDb.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 6. Tag normalization
// ---------------------------------------------------------------------------

test('tag normalization trims, lowercases, strips hashes, collapses whitespace, preserves parent/child', () => {
  assert.equal(normalizeTagName('  #Work  '), 'work')
  assert.equal(normalizeTagName('###Design   System '), 'design system')
  assert.equal(normalizeTagName('  Project / Sub-feature  '), 'project/sub-feature')
  assert.equal(normalizeTagName('   '), '')
  assert.equal(normalizeTagName('###'), '')

  // splitTagInput splits on comma and semicolon
  assert.deepEqual(splitTagInput('  #work, project/design; urgent  '), ['work', 'project/design', 'urgent'])

  // normalizeTags deduplicates and keeps order
  assert.deepEqual(normalizeTags(['#Alpha', 'alpha', 'Beta/Sub', '  beta/sub  ']), ['alpha', 'beta/sub'])

  // Database tag service
  const db = openLiveDb()
  const [w1, p1] = ensureTags(db, ['#Work', 'Personal'])
  const [w2] = ensureTags(db, ['work'])
  assert.equal(w1, w2, 'Normalized tag name must reuse existing tag row')

  setEntityTags(db, 'task', 10, ['#Work', 'Project/A'])
  const tags = tagsOf(db, 'task', 10)
  assert.deepEqual(tags.map((t) => t.name), ['project/a', 'work'])

  const counts = tagCounts(db)
  const workCount = counts.find((c) => c.tag.name === 'work')
  assert.ok(workCount)
  // entity 10 doesn't exist in tasks table, so join with tasks table yields 0 live count
  assert.equal(workCount.counts.task, 0)

  // With a real task:
  const task = createTask(db, makeTaskInput('Tagged task'))
  setEntityTags(db, 'task', task.id, ['work'])
  const countsWithReal = tagCounts(db)
  const workCountReal = countsWithReal.find((c) => c.tag.name === 'work')!
  assert.equal(workCountReal.counts.task, 1)

  db.close()
})

console.log(`\n${n} Phase 0 checks passed`)
