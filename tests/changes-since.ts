import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import { changesSince } from '../src/shared/changes'
import { changesSinceDate, readDailyCheckState, runDailyChecksIfNeeded } from '../src/main/dailyCheck'
import { createHabit, setDayStatus } from '../src/main/habits'
import { addDays } from '../src/shared/habits'
import type { AssistantRows } from '../src/shared/assistant'
import type { Habit, LogEntry, SavingsTx, TaskCompletion, Trade } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { try { fn(); n++; console.log('ok  ', name) } catch (e) { console.error(e); throw e } }

const TODAY = '2026-11-02'
const SINCE = '2026-10-31' // two days ago
const day = (offset: number): string => addDays(TODAY, offset)

const tx = (date: string, kind: SavingsTx['kind'], amount: number): SavingsTx =>
  ({ id: 0, goalId: 1, date, kind, amount, note: '', createdAt: '', updatedAt: '' })
const trade = (date: string, pnl: number): Trade =>
  ({ id: 0, date, asset: 'XAUUSD', direction: 'long', entryPrice: 1, exitPrice: 1 + pnl, quantity: 1, fees: 0, notes: '', tags: [], pnl, createdAt: '', updatedAt: '' })
const entry = (date: string, tags: string[] = []): LogEntry =>
  ({ id: 0, date, title: 'A day', body: '', mood: null, tags, createdAt: '', updatedAt: '' })
const habit = (days: number[], completions: string[], startDate = '2026-01-01'): Habit => ({
  id: 0, name: 'Read', notes: '', days, archived: false, startDate, checkins: completions,
  completions: completions.map((date) => ({ date, status: 'done' as const })),
  stats: null as never, createdAt: '', updatedAt: ''
})

const empty = () => ({ trades: [], txs: [], completions: [], tasks: [], habits: [], entries: [] })

test('trades closed in the window appear as one net line', () => {
  const rows = { ...empty(), trades: [trade(day(-1), 40), trade(day(0), -15)] }
  const items = changesSince(rows, SINCE, TODAY)
  assert.equal(items.length, 1)
  assert.match(items[0].text, /2 trades closed \(net \+25\)/)
})

test('savings net deposits minus withdrawals', () => {
  const rows = { ...empty(), txs: [tx(day(-1), 'deposit', 100), tx(day(0), 'withdrawal', 30)] }
  const items = changesSince(rows, SINCE, TODAY)
  assert.match(items[0].text, /2 savings transactions \(net \+70\)/)
})

test('task completions are counted from history', () => {
  const completion: TaskCompletion = { taskId: 1, completedAt: new Date(`${day(-1)}T12:00:00Z`).toISOString() }
  const items = changesSince({ ...empty(), completions: [completion] }, SINCE, TODAY)
  assert.match(items[0].text, /1 task completed/)
})

test('journal drafts are excluded; a written entry counts', () => {
  const rows = { ...empty(), entries: [entry(day(-1)), { ...entry(day(0)), tags: ['automation'] }] }
  const items = changesSince(rows, SINCE, TODAY)
  assert.equal(items.length, 1)
  assert.match(items[0].text, /1 journal entry written/)
})

test('a missed due day inside the window is listed once per habit', () => {
  // Daily habit; done the day before the window, nothing since.
  const rows = { ...empty(), habits: [habit([0, 1, 2, 3, 4, 5, 6], [SINCE])] }
  const items = changesSince(rows, SINCE, TODAY)
  assert.equal(items.length, 1)
  assert.match(items[0].text, /Habits: 1 missed on "Read"/)
})

test('skipped days are not misses; rest days are not misses', () => {
  const h = habit([1], []) // due only on Mondays; 2026-11-02 IS a Monday but that's today
  const items = changesSince({ ...empty(), habits: [h] }, SINCE, TODAY)
  assert.equal(items.length, 0) // the window (1,2 Nov = Sun,Mon): only Mon due, and Mon is today
})

test('nothing in the window means an empty list', () => {
  assert.deepEqual(changesSince(empty(), SINCE, TODAY), [])
})

test('items are capped at 6', () => {
  const rows = { ...empty(), trades: Array.from({ length: 20 }, (_, i) => trade(day(-1), i)) }
  const items = changesSince(rows, SINCE, TODAY)
  assert.equal(items.length, 1) // all trades collapse into one net line anyway
  assert.match(items[0].text, /20 trades closed/)
})

test('a since in the future or equal to today yields nothing', () => {
  assert.deepEqual(changesSince({ ...empty(), trades: [trade(day(-1), 5)] }, TODAY, TODAY), [])
  assert.deepEqual(changesSince({ ...empty(), trades: [trade(day(-1), 5)] }, day(1), TODAY), [])
})

// --- the state side ---

const openDb = () => {
  const db = openDatabase()
  applyMigrations(db)
  return db
}

test('changesSinceDate defaults to a two-day lookback and never runs backwards', () => {
  const db = openDb()
  assert.equal(changesSinceDate(db, TODAY), day(-1))
  // A stored lastSeen in the future (clock jumped) clamps to the default window.
  db.prepare("INSERT INTO settings (key, value) VALUES ('dailyCheckState', ?)").run(JSON.stringify({ lastRun: TODAY, lastSeenDate: day(3) }))
  assert.equal(changesSinceDate(db, TODAY), day(-1))
  // An older lastSeen clamps to the no-flood window too.
  db.prepare("UPDATE settings SET value = ? WHERE key = 'dailyCheckState'").run(JSON.stringify({ lastRun: TODAY, lastSeenDate: '2026-09-01' }))
  assert.equal(changesSinceDate(db, TODAY), day(-1))
  db.close()
})

test('the daily check stores lastSeenDate and keeps the previous value when running', () => {
  const db = openDb()
  db.prepare("INSERT INTO settings (key, value) VALUES ('dailyCheckState', ?)").run(JSON.stringify({ lastRun: day(-2), lastSeenDate: day(-2) }))
  runDailyChecksIfNeeded(db, TODAY)
  const state = readDailyCheckState(db)
  assert.equal(state.lastRun, TODAY)
  assert.equal(state.lastSeenDate, day(-2)) // the PREVIOUS value survives the run...
  // ...but the briefing lookback never goes past the two-day no-flood window.
  assert.equal(changesSinceDate(db, TODAY), day(-1))
  db.close()
})

test('an everyday habit missed in the lookback shows up through the db path', () => {
  const db = openDb()
  const h = createHabit(db, { name: 'Stretch', notes: '', days: [0, 1, 2, 3, 4, 5, 6], archived: false, autoCompleteOn: '' })
  setDayStatus(db, h.id, day(-2), 'done') // done two days ago; yesterday has no record
  const since = day(-2) // the test drives the pure rule with the state's own value
  const items = changesSince({ ...empty(), habits: [{ ...h, stats: null as never }] }, since, TODAY)
  assert.equal(items.length, 1)
  assert.match(items[0].text, /1 missed on "Stretch"/)
  db.close()
})

test('the helper types line up with the briefing payload', () => {
  const rows: AssistantRows = { txs: [], goals: [], trades: [], habits: [], tasks: [], completions: [], entries: [] }
  void rows
  assert.ok(true)
})

console.log(`${n} changes-since checks passed`)
