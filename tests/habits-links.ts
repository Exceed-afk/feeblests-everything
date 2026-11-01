// Tests for Phase 6: the Logbook link (auto-complete), the dashboard's
// top-streaks widget data, and reminder time helpers.
// The auto-complete tests need a real (in-memory) database; the pure helpers
// do not.
//
//   tsx tests/habits-links.ts
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import { createEntry } from '../src/main/logbook'
import { createHabit, listHabits } from '../src/main/habits'
// Importing main/habits is what connects the Logbook event to auto-complete:
// the subscription lives in the habits module (not in the test, and not in
// the Logbook), so loading both here is exactly how the app runs.
import '../src/main/habits'
import { cleanReminderTime, minutesOfDay, isReminderDue } from '../src/shared/habits'
import { habitsToday } from '../src/shared/dashboard'
import type { Habit } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

// Today, as the test (and localDate()) sees it: "YYYY-MM-DD" and its weekday
// (0 = Monday ... 6 = Sunday), so the tests work on any day of the week.
function todayInfo(): { date: string; weekday: number } {
  const d = new Date()
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { date, weekday: (d.getDay() + 6) % 7 }
}

function freshDb(): Database.Database {
  const db = openDatabase()
  applyMigrations(db)
  return db
}

// ---------- the migration ----------

test('old habits read with no reminder and no auto-complete', () => {
  const db = freshDb()
  const h = createHabit(db, { name: 'Old-style', notes: '', days: [0], archived: false })
  assert.equal(h.reminderTime, null)
  assert.equal(h.autoCompleteOn, '')
  db.close()
})

// ---------- the Logbook link ----------

const allWeek = [0, 1, 2, 3, 4, 5, 6]

test('a new Logbook entry marks a due habit with the link as done', () => {
  const db = freshDb()
  const { date } = todayInfo()
  const linked = createHabit(db, { name: 'Journal streak', notes: '', days: allWeek, archived: false, autoCompleteOn: 'logbook-entry' })
  const unlinked = createHabit(db, { name: 'Journal silent', notes: '', days: allWeek, archived: false })

  createEntry(db, { date, title: 'A good day', body: '', mood: null, tags: [] })

  const habits = listHabits(db, date).habits
  assert.equal(habits.find((h) => h.id === linked.id)?.checkins.includes(date), true, 'the linked habit is marked done')
  assert.equal(habits.find((h) => h.id === unlinked.id)?.checkins.includes(date), false, 'the unlinked habit is untouched')
  db.close()
})

test('the Logbook link never checks off a rest day', () => {
  const db = freshDb()
  const { date, weekday } = todayInfo()
  // Scheduled ONLY on a weekday that is NOT today, so today is a rest day.
  const otherDay = (weekday + 1) % 7
  const resting = createHabit(db, { name: 'Rests today', notes: '', days: [otherDay], archived: false, autoCompleteOn: 'logbook-entry' })

  createEntry(db, { date, title: 'Entry', body: '', mood: null, tags: [] })

  assert.equal(listHabits(db, date).habits[0].checkins.length, 0, 'a rest day is never checked off')
  void resting
  db.close()
})

test('the Logbook link never overwrites what you wrote yourself', () => {
  const db = freshDb()
  const { date } = todayInfo()
  const h = createHabit(db, { name: 'Skipped already', notes: '', days: allWeek, archived: false, autoCompleteOn: 'logbook-entry' })
  // The user (or an earlier save) marked the day as SKIPPED. An entry on the
  // same day must not turn that into "done".
  db.prepare('INSERT INTO habit_checkins (habit_id, date, created_at, status) VALUES (?, ?, ?, ?)')
    .run(h.id, date, 'now', 'skipped')

  createEntry(db, { date, title: 'Entry', body: '', mood: null, tags: [] })

  const row = db.prepare('SELECT status FROM habit_checkins WHERE habit_id = ? AND date = ?').get(h.id, date) as { status: string }
  assert.equal(row.status, 'skipped', 'the existing record is left alone')
  db.close()
})

test('a second entry on the same day adds no second check-in', () => {
  const db = freshDb()
  const { date } = todayInfo()
  const h = createHabit(db, { name: 'One per day', notes: '', days: allWeek, archived: false, autoCompleteOn: 'logbook-entry' })
  createEntry(db, { date, title: 'First', body: '', mood: null, tags: [] })
  createEntry(db, { date, title: 'Second', body: '', mood: null, tags: [] })
  const rows = db.prepare('SELECT COUNT(*) AS n FROM habit_checkins WHERE habit_id = ? AND date = ?').get(h.id, date) as { n: number }
  assert.equal(rows.n, 1)
  db.close()
})

test('a future entry cannot complete a future day', () => {
  const db = freshDb()
  const { date } = todayInfo()
  const h = createHabit(db, { name: 'No time travel', notes: '', days: allWeek, archived: false, autoCompleteOn: 'logbook-entry' })
  createEntry(db, { date: '2099-01-01', title: 'Tomorrow is not today', body: '', mood: null, tags: [] })
  const rows = db.prepare('SELECT COUNT(*) AS n FROM habit_checkins WHERE habit_id = ?').get(h.id) as { n: number }
  assert.equal(rows.n, 0)
  db.close()
})

// ---------- reminders (pure helpers) ----------

test('cleanReminderTime keeps a valid HH:MM and rejects anything else', () => {
  assert.equal(cleanReminderTime('08:30'), '08:30')
  assert.equal(cleanReminderTime('9:05'), '09:05')
  assert.equal(cleanReminderTime('23:59'), '23:59')
  assert.equal(cleanReminderTime('00:00'), '00:00')
  assert.equal(cleanReminderTime('24:00'), null, 'hour 24 does not exist')
  assert.equal(cleanReminderTime('9:60'), null)
  assert.equal(cleanReminderTime('eight'), null)
  assert.equal(cleanReminderTime(''), null)
  assert.equal(cleanReminderTime(undefined), null)
})

test('a reminder fires inside a small catch-up window after its time', () => {
  assert.equal(isReminderDue('08:30', '08:30'), true, 'exactly on time')
  assert.equal(isReminderDue('08:30', '08:39'), true, 'a little late still fires')
  assert.equal(isReminderDue('08:30', '08:41'), false, 'long past: too late')
  assert.equal(isReminderDue('08:30', '06:00'), false, 'too early')
  assert.equal(isReminderDue('23:59', '00:01'), false, 'the next day is not a catch-up')
  assert.equal(minutesOfDay('09:05'), 9 * 60 + 5)
})

// ---------- the dashboard's top streaks ----------

test('habitsToday lists the top 3 current streaks, biggest first', () => {
  const today = '2026-10-31'
  const mk = (id: number, name: string, current: number, over: Partial<Habit> = {}): Habit => ({
    id, name, notes: '', days: allWeek, archived: false, startDate: '2026-09-01',
    checkins: [], stats: { current, best: current, rate30: null, total: current }, createdAt: '', updatedAt: '', ...over
  })
  const r = habitsToday([
    mk(1, 'Small streak', 1),
    mk(2, 'Big streak', 21),
    mk(3, 'Resting today', 9, { days: [1, 2, 3, 4] }),
    mk(4, 'Tie, later name', 5),
    mk(5, 'Tie, earlier name', 5),
    mk(6, 'Gone', 40, { archived: true })
  ], today)
  assert.deepEqual(r.topStreaks.map((s) => s.name), ['Big streak', 'Resting today', 'Tie, earlier name'])
  assert.equal(r.longestStreak, 21)
  // Archived habits never win, and ties fall back to the name.
  assert.equal(r.topStreaks.some((s) => s.name === 'Gone'), false)
})

test('habitsToday counts a duration habit as done only when the target is met', () => {
  const today = '2026-10-31'
  const mk = (id: number, name: string, completions: { date: string; status: 'done'; value: number }[]): Habit => ({
    id, name, notes: '', days: allWeek, archived: false, startDate: '2026-09-01',
    checkins: completions.map((c) => c.date), completions, type: 'duration', target: 10,
    stats: { current: 0, best: 0, rate30: null, total: completions.length }, createdAt: '', updatedAt: ''
  })
  // Two habits due today: one logged 10 of 10 minutes, one logged 6 of 10.
  const r = habitsToday([
    mk(1, 'Read enough', [{ date: today, status: 'done', value: 10 }]),
    mk(2, 'Read too little', [{ date: today, status: 'done', value: 6 }])
  ], today)
  assert.equal(r.done, 1)
  assert.equal(r.due, 2)
  assert.deepEqual(r.items.map((i) => i.done), [false, true])
})

console.log(`\n${n} link tests passed`)
