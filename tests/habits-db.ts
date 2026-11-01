// Tests for the habit day status migration and the habit day queries.
// These need a real (in-memory) database, so they only run where
// better-sqlite3 loads.
//
//   tsx tests/habits-db.ts
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { openDatabase } from './sqlite'
import { MIGRATIONS, applyMigrations } from '../src/main/migrations'
import { listHabits, setDayStatus, createHabit, logHabitValue } from '../src/main/habits'
import { localDate } from '../src/main/util'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

// A fresh database with every migration applied.
function freshDb(): Database.Database {
  const db = openDatabase()
  applyMigrations(db)
  return db
}

// A habit that runs every day. It starts on the 20th, so the days before it
// are not counted as missed.
const EVERY_DAY = '[0,1,2,3,4,5,6]'

function makeHabit(db: Database.Database, name: string, startDate = '2026-10-01'): number {
  const info = db.prepare(
    `INSERT INTO habits (name, notes, days, archived, start_date, created_at, updated_at)
     VALUES (?, '', ?, 0, ?, 'now', 'now')`
  ).run(name, EVERY_DAY, startDate)
  return Number(info.lastInsertRowid)
}

// ---------- the migration ----------

test('the habit status migration keeps the old check-in rows', () => {
  const db = openDatabase()
  // Build the database as it was BEFORE the status column existed.
  for (let i = 0; i < 9; i++) db.exec(MIGRATIONS[i])
  db.pragma('user_version = 9')
  const habit = makeHabit(db, 'Old habit')
  db.prepare('INSERT INTO habit_checkins (habit_id, date, created_at) VALUES (?, ?, ?)').run(habit, '2026-10-02', 'now')

  // Now run the new migration.
  applyMigrations(db)

  // The old row is still there, and it reads as a plain "done" day.
  const row = db.prepare('SELECT habit_id, date, status FROM habit_checkins').get() as { date: string; status: string }
  assert.equal(row.date, '2026-10-02')
  assert.equal(row.status, 'done')
  db.close()
})

test('the habit status migration can be run twice without trouble', () => {
  const db = openDatabase()
  for (let i = 0; i < 9; i++) db.exec(MIGRATIONS[i])
  db.pragma('user_version = 9')
  makeHabit(db, 'Old habit')
  applyMigrations(db)
  // Running it again must not change anything or lose rows.
  applyMigrations(db)
  const count = db.prepare('SELECT COUNT(*) AS n FROM habit_checkins').get() as { n: number }
  assert.equal(count.n, 0)
  assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length)
  db.close()
})

test('the habit status column only allows done or skipped', () => {
  const db = freshDb()
  const habit = makeHabit(db, 'Read')
  assert.throws(() => db.prepare(
    "INSERT INTO habit_checkins (habit_id, date, created_at, status) VALUES (?, '2026-10-02', 'now', 'maybe')"
  ).run(habit), /CHECK constraint failed/)
  db.close()
})

// ---------- storing and reading a day ----------

test('a day can be marked done, skipped and cleared', () => {
  const db = freshDb()
  const id = makeHabit(db, 'Read')

  setDayStatus(db, id, '2026-10-02', 'done')
  setDayStatus(db, id, '2026-10-03', 'skipped')

  const habit = listHabits(db, '2026-10-26').habits[0]
  assert.deepEqual(habit.completions!.map((c) => c.status).sort(), ['done', 'skipped'])
  // "checkins" stays the list of DONE days only, which is what the old code used.
  assert.deepEqual(habit.checkins, ['2026-10-02'])

  // Clearing a day removes the record entirely.
  setDayStatus(db, id, '2026-10-03', null)
  const after = listHabits(db, '2026-10-26').habits[0]
  assert.equal(after.completions!.length, 1)
  assert.deepEqual(after.checkins, ['2026-10-02'])
  db.close()
})

test('setting the same day twice keeps one row and the newest status', () => {
  const db = freshDb()
  const id = makeHabit(db, 'Read')
  setDayStatus(db, id, '2026-10-02', 'done')
  setDayStatus(db, id, '2026-10-02', 'skipped')
  setDayStatus(db, id, '2026-10-02', 'done')
  const habit = listHabits(db, '2026-10-26').habits[0]
  assert.equal(habit.completions!.length, 1)
  assert.equal(habit.completions![0].status, 'done')
  db.close()
})

test('a future day cannot be set', () => {
  const db = freshDb()
  const id = makeHabit(db, 'Read')
  // "today" for the main process is the real clock, so use a day far in the future.
  assert.throws(() => setDayStatus(db, id, '2099-01-01', 'done'), /has not happened yet/)
  db.close()
})

test('a bad date is rejected', () => {
  const db = freshDb()
  const id = makeHabit(db, 'Read')
  assert.throws(() => setDayStatus(db, id, 'yesterday', 'done'), /Date must look like/)
  db.close()
})

test('a skipped day does not break the streak', () => {
  const db = freshDb()
  const id = makeHabit(db, 'Read', '2026-10-20')
  // Tue 20th, Wed 21st (skipped), Thu 22nd, Fri 23rd - today is Saturday 24th.
  setDayStatus(db, id, '2026-10-20', 'done')
  setDayStatus(db, id, '2026-10-21', 'skipped')
  setDayStatus(db, id, '2026-10-22', 'done')
  setDayStatus(db, id, '2026-10-23', 'done')
  const habit = listHabits(db, '2026-10-24').habits[0]
  assert.equal(habit.stats.current, 3)
  db.close()
})

// ---------- Phase 4: habit types ----------

test('the habit type migration keeps the old habits as plain check habits', () => {
  const db = openDatabase()
  // Build the database as it was BEFORE the habit type columns existed.
  for (let i = 0; i < 10; i++) db.exec(MIGRATIONS[i])
  db.pragma('user_version = 10')
  const habit = makeHabit(db, 'Old habit')
  db.prepare('INSERT INTO habit_checkins (habit_id, date, created_at) VALUES (?, ?, ?)').run(habit, '2026-10-02', 'now')

  // Now run the new migration.
  applyMigrations(db)

  // The old habit is still there and reads as a plain "check" habit.
  const row = db.prepare('SELECT type, target, unit FROM habits WHERE id = ?').get(habit) as {
    type: string; target: number | null; unit: string
  }
  assert.equal(row.type, 'check')
  assert.equal(row.target, null)
  assert.equal(row.unit, '')
  // The old check-in is untouched.
  const checkin = db.prepare('SELECT date, status, value FROM habit_checkins').get() as {
    date: string; status: string; value: number | null
  }
  assert.equal(checkin.date, '2026-10-02')
  assert.equal(checkin.status, 'done')
  assert.equal(checkin.value, null)
  db.close()
})

test('the habit type column only allows the three known types', () => {
  const db = freshDb()
  const habit = makeHabit(db, 'Read')
  assert.throws(() => db.prepare(
    "UPDATE habits SET type = 'maybe' WHERE id = ?"
  ).run(habit), /CHECK constraint failed/)
  db.close()
})

test('a habit can be created as a duration habit with a target', () => {
  const db = freshDb()
  const habit = createHabit(db, {
    name: 'Read for 10mn', notes: '', days: [0, 1, 2, 3, 4, 5, 6], archived: false,
    type: 'duration', target: 10, unit: 'min'
  })
  assert.equal(habit.type, 'duration')
  assert.equal(habit.target, 10)
  assert.equal(habit.unit, 'min')
  db.close()
})

test('a check habit is stored with no target', () => {
  const db = freshDb()
  const habit = createHabit(db, {
    name: 'November training', notes: '', days: [1, 3, 5, 6], archived: false,
    type: 'check', target: 10, unit: 'min'
  })
  // A check habit has no target, even if one was passed in.
  assert.equal(habit.type, 'check')
  assert.equal(habit.target, null)
  assert.equal(habit.unit, '')
  db.close()
})

test('logging a value stores it and reads it back', () => {
  const db = freshDb()
  const id = makeHabit(db, 'Read', '2026-10-20')
  db.prepare("UPDATE habits SET type = 'duration', target = 10, unit = 'min' WHERE id = ?").run(id)

  logHabitValue(db, id, '2026-10-20', 6)

  const habit = listHabits(db, '2026-10-26').habits[0]
  assert.equal(habit.completions![0].value, 6)
  assert.equal(habit.completions![0].status, 'done')
  // 6 of the 10 minutes is not enough, so the day does not count as done.
  assert.equal(habit.stats.current, 0)
  db.close()
})

test('logging a value that reaches the target counts the day as done', () => {
  const db = freshDb()
  // The habit starts today, so there are no missed days in front of it.
  const today = localDate()
  const id = makeHabit(db, 'Read', today)
  db.prepare("UPDATE habits SET type = 'duration', target = 10, unit = 'min' WHERE id = ?").run(id)

  logHabitValue(db, id, today, 10)

  const habit = listHabits(db, today).habits[0]
  assert.equal(habit.stats.current, 1)
  db.close()
})

test('logging a value again replaces the old number', () => {
  const db = freshDb()
  const today = localDate()
  const id = makeHabit(db, 'Read', today)
  db.prepare("UPDATE habits SET type = 'duration', target = 10, unit = 'min' WHERE id = ?").run(id)

  logHabitValue(db, id, today, 4)
  logHabitValue(db, id, today, 10)

  const habit = listHabits(db, today).habits[0]
  assert.equal(habit.completions!.length, 1)
  assert.equal(habit.completions![0].value, 10)
  assert.equal(habit.stats.current, 1)
  db.close()
})

test('a negative value is rejected', () => {
  const db = freshDb()
  const id = makeHabit(db, 'Read')
  assert.throws(() => logHabitValue(db, id, '2026-10-20', -1), /zero or more/)
  db.close()
})

console.log(`ALL ${n} PASSED`)
