// Integration tests for Notes (Phase 6):
// Insights (notes per week), Assistant (find_notes), Review (notes created).
import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import { createNote } from '../src/main/notes'
import { buildInsights, INSIGHT_IDS } from '../src/shared/insights'
import { ASSISTANT_FUNCTIONS } from '../src/shared/assistant'
import { buildReview } from '../src/shared/review'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const openDb = () => {
  const db = openDatabase()
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

test('Notes in Insights: notesPerWeek calculates weekly note counts', () => {
  const insights = buildInsights({
    today: '2026-11-04',
    start: '2026-10-01',
    end: '2026-11-04',
    habits: [],
    tasks: [],
    completions: [],
    trades: [],
    txs: [],
    entries: [],
    notes: [
      { id: 1, createdAt: '2026-10-12T10:00:00.000Z' },
      { id: 2, createdAt: '2026-10-14T12:00:00.000Z' },
      { id: 3, createdAt: '2026-10-26T15:00:00.000Z' }
    ]
  })

  assert.ok(insights.notesPerWeek)
  assert.equal(insights.notesPerWeek.length, 2)
  const week1 = insights.notesPerWeek.find((w) => w.week === '2026-10-12')
  assert.ok(week1)
  assert.equal(week1.count, 2)
})

test('Notes in Assistant: find_notes tool searches notes and summarizes', () => {
  const fn = ASSISTANT_FUNCTIONS.find((f) => f.name === 'find_notes')
  assert.ok(fn, 'find_notes assistant tool exists')

  const res = fn.run(
    {
      txs: [],
      goals: [],
      trades: [],
      habits: [],
      tasks: [],
      completions: [],
      entries: [],
      notes: [
        { id: 1, title: 'Roadmap Q4', body: 'Finish Phase 6 and deploy', tags: ['work', 'plan'], createdAt: '2026-11-01T00:00:00.000Z' },
        { id: 2, title: 'Grocery list', body: 'Milk, bread, eggs', tags: ['home'], createdAt: '2026-11-02T00:00:00.000Z' }
      ]
    },
    { from: '2026-11-01', to: '2026-11-05' },
    '2026-11-05',
    { tag: 'work' }
  )

  assert.equal(res.type, 'list')
  if (res.type === 'list') {
    assert.equal(res.rows.length, 1)
    assert.equal(res.rows[0].label, 'Roadmap Q4')
  }
})

test('Notes in Review: notesCreated count is reported', () => {
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
    notesCreated: 4
  })

  assert.equal(review.notesCreated, 4)
})

console.log(`\n${n} notes integration checks passed`)
