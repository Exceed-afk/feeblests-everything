// Integration tests for Focus (Phase 6):
// Calendar (focus sessions), Search (time sessions), Insights (focus vs mood), Review (focus hours).
import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import { logManualSession } from '../src/main/focus'
import { getCalendar } from '../src/main/calendar'
import { runSearch } from '../src/main/search'
import { buildInsights, INSIGHT_IDS } from '../src/shared/insights'
import { buildReview } from '../src/shared/review'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const openDb = () => {
  const db = openDatabase()
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

test('Focus in Calendar: sessions show on the calendar day', () => {
  const db = openDb()
  logManualSession(db, {
    projectName: 'Client Work',
    startedAt: '2026-11-03T10:00:00.000Z',
    endedAt: '2026-11-03T10:45:00.000Z',
    type: 'focus'
  })

  const cal = getCalendar(db, '2026-11', '2026-11-03')
  const day = cal.weeks.flat().find((d) => d.date === '2026-11-03')
  assert.ok(day, 'Day 2026-11-03 exists on calendar')
  assert.ok(day.focusSessions)
  assert.equal(day.focusSessions.length, 1)
  assert.equal(day.focusSessions[0].projectName, 'Client Work')
  assert.equal(day.focusSessions[0].seconds, 45 * 60)
  db.close()
})

test('Focus in Search: sessions are indexed and searchable via FTS5', () => {
  const db = openDb()
  logManualSession(db, {
    projectName: 'Architecture Design',
    note: 'Designing the module integration contract',
    startedAt: '2026-11-03T14:00:00.000Z',
    endedAt: '2026-11-03T15:00:00.000Z',
    type: 'focus'
  })

  const res = runSearch(db, 'Architecture')
  assert.ok(res.focus.items.length >= 1)
  assert.equal(res.focus.items[0].projectName, 'Architecture Design')
  db.close()
})

test('Focus in Insights: focus-vs-mood correlation exists', () => {
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
      { id: 1, date: '2026-11-01', mood: 'great', title: '', body: '', tags: [], createdAt: '', updatedAt: '' },
      { id: 2, date: '2026-11-02', mood: 'good', title: '', body: '', tags: [], createdAt: '', updatedAt: '' },
      { id: 3, date: '2026-11-03', mood: 'okay', title: '', body: '', tags: [], createdAt: '', updatedAt: '' },
      { id: 4, date: '2026-11-04', mood: 'low', title: '', body: '', tags: [], createdAt: '', updatedAt: '' }
    ],
    focusSessions: [
      { startedAt: '2026-11-01T10:00:00.000Z', endedAt: '2026-11-01T12:00:00.000Z', type: 'focus' },
      { startedAt: '2026-11-02T10:00:00.000Z', endedAt: '2026-11-02T11:30:00.000Z', type: 'focus' },
      { startedAt: '2026-11-03T10:00:00.000Z', endedAt: '2026-11-03T11:00:00.000Z', type: 'focus' },
      { startedAt: '2026-11-04T10:00:00.000Z', endedAt: '2026-11-04T10:30:00.000Z', type: 'focus' }
    ]
  })

  const focusInsight = insights.correlations.find((c) => c.id === INSIGHT_IDS.focusVsMood)
  assert.ok(focusInsight)
  assert.ok(focusInsight.text.includes('focus time'))
})

test('Focus in Review: focusSeconds are aggregated', () => {
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
    focusSeconds: 7200
  })

  assert.equal(review.focusSeconds, 7200)
})

console.log(`\n${n} focus integration checks passed`)
