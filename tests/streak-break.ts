import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import { createHabit, setDayStatus, habitCompletionsOf } from '../src/main/habits'
import { runDailyChecksIfNeeded, readDailyCheckState } from '../src/main/dailyCheck'
import { CHECKS } from '../src/main/dailyCheck'
import { automationActivity } from '../src/main/automations'
import { streakBeforeMiss, addDays } from '../src/shared/habits'

let n = 0
const test = (name: string, fn: () => void) => { try { fn(); n++; console.log('ok  ', name) } catch (e) { console.error(e); throw e } }

const openDb = () => {
  const db = openDatabase()
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  // Turns the streak-reminder rule on for the test database.
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('automations', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify({ streakReminder: true }))
  return db
}

const TODAY = '2026-11-02' // Monday
const day = (offset: number): string => addDays(TODAY, offset) // negative = before today

// An every-day habit with `done` days recorded, created long before the window.
const habitWith = (db: ReturnType<typeof openDb>, done: string[], skipped: string[] = []): number => {
  const habit = createHabit(db, { name: 'Read', notes: '', days: [0, 1, 2, 3, 4, 5, 6], archived: false, autoCompleteOn: '' })
  for (const date of done) setDayStatus(db, habit.id, date, 'done')
  for (const date of skipped) setDayStatus(db, habit.id, date, 'skipped')
  return habit.id
}

const streakEvents = (db: ReturnType<typeof openDb>) =>
  automationActivity(db, 50).filter((a) => a.event === 'habit-streak-broken')

test('8-day streak then a missed yesterday fires exactly one event', () => {
  const db = openDb()
  // A 9-day run ending two days ago; yesterday missed.
  const done: string[] = []
  for (let i = -10; i <= -2; i++) done.push(day(i))
  const id = habitWith(db, done)
  try {
    runDailyChecksIfNeeded(db, TODAY)
    const events = streakEvents(db)
    assert.equal(events.length, 1)
    assert.match(events[0].label, /"Read"/)
    assert.match(events[0].eventKey, /miss:/)
  } finally { db.close(); void id }
})

test('running the check twice fires the event once (per-day dedupe key)', () => {
  const db = openDb()
  const done: string[] = []
  for (let i = -10; i <= -2; i++) done.push(day(i))
  habitWith(db, done)
  runDailyChecksIfNeeded(db, TODAY)
  runDailyChecksIfNeeded(db, TODAY) // same day: gate blocks it
  assert.equal(streakEvents(db).length, 1)
  // even on a new day, the same missed day M never re-fires (key contains M)
  runDailyChecksIfNeeded(db, addDays(TODAY, 1))
  assert.equal(streakEvents(db).length, 1)
  db.close()
})

test('un-ticking today fires nothing (today is never missed)', () => {
  const db = openDb()
  const done: string[] = []
  for (let i = -10; i <= -1; i++) done.push(day(i)) // streak up to yesterday
  habitWith(db, done)
  // A user edits today: no completion for today at all, but the day is not over.
  runDailyChecksIfNeeded(db, TODAY)
  assert.equal(streakEvents(db).length, 0)
  db.close()
})

test('a skipped day fires nothing', () => {
  const db = openDb()
  const done: string[] = []
  for (let i = -10; i <= -2; i++) done.push(day(i))
  habitWith(db, done, [day(-1)]) // deliberately skipped yesterday
  runDailyChecksIfNeeded(db, TODAY)
  assert.equal(streakEvents(db).length, 0)
  db.close()
})

test('a miss after a short streak (under 7) fires nothing', () => {
  const db = openDb()
  const done: string[] = [day(-3), day(-2)] // 2-day run, yesterday missed
  habitWith(db, done)
  runDailyChecksIfNeeded(db, TODAY)
  assert.equal(streakEvents(db).length, 0)
  db.close()
})

test('a miss outside the 2-day lookback fires nothing', () => {
  const db = openDb()
  const done: string[] = []
  for (let i = -12; i <= -4; i++) done.push(day(i)) // streak, missed 3 days ago
  habitWith(db, done)
  runDailyChecksIfNeeded(db, TODAY)
  assert.equal(streakEvents(db).length, 0)
  db.close()
})

test('streakBeforeMiss counts the run before a miss and honours rest and skipped days', () => {
  const db = openDb()
  const id = habitWith(db, [day(-4), day(-3), day(-2)], [day(-5)]) // skipped breaks nothing
  const completions = habitCompletionsOf(db, id)
  // Done days -4,-3,-2, skipped -5, then the miss on day(-1): streak = 3.
  assert.equal(streakBeforeMiss({ days: [0, 1, 2, 3, 4, 5, 6], startDate: '2026-01-01', type: 'check', target: null, unit: '' }, completions, day(-1)), 3)
  db.close()
})

test('the streak-broken check is registered in the daily check list', () => {
  assert.ok(CHECKS.some((c) => c.id === 'streak-broken'))
})

test('the daily-check state still advances when the streak check runs', () => {
  const db = openDb()
  const done: string[] = []
  for (let i = -10; i <= -2; i++) done.push(day(i))
  habitWith(db, done)
  runDailyChecksIfNeeded(db, TODAY)
  assert.equal(readDailyCheckState(db).lastRun, TODAY)
  db.close()
})

console.log(`${n} streak-break checks passed`)
