// Tests for habit organisation (Phase 5): the sort-order migration, manual
// reordering, and the time-of-day grouping.
// These need a real (in-memory) database, so they only run where
// better-sqlite3 loads.
//
//   tsx tests/habits-organisation.ts
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { openDatabase } from './sqlite'
import { MIGRATIONS, applyMigrations } from '../src/main/migrations'
import { createHabit, listHabits, reorderHabits, updateHabit } from '../src/main/habits'
import { cleanTimeOfDay, groupByTimeOfDay, TIME_OF_DAY_LABELS, TIME_OF_DAY_ORDER } from '../src/shared/habits'
import type { TimeOfDay } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

// A fresh database with every migration applied.
function freshDb(): Database.Database {
  const db = openDatabase()
  applyMigrations(db)
  return db
}

// ---------- the migration ----------

test('the organisation migration gives old habits a creation order and "anytime"', () => {
  const db = openDatabase()
  // Build the database as it was BEFORE the organisation columns existed.
  for (let i = 0; i < 11; i++) db.exec(MIGRATIONS[i])
  db.pragma('user_version = 11')
  db.prepare(
    `INSERT INTO habits (name, notes, days, archived, start_date, created_at, updated_at)
     VALUES ('Second habit', '', '[0,1,2,3,4,5,6]', 0, '2026-10-01', '2026-10-02T10:00:00.000Z', 'x')`
  ).run()
  db.prepare(
    `INSERT INTO habits (name, notes, days, archived, start_date, created_at, updated_at)
     VALUES ('First habit', '', '[0,1,2,3,4,5,6]', 0, '2026-10-01', '2026-10-01T09:00:00.000Z', 'x')`
  ).run()

  // Now run the new migration.
  applyMigrations(db)

  // The old order is kept (creation order), and both read as "anytime".
  const rows = db.prepare('SELECT name, sort_order, time_of_day FROM habits ORDER BY sort_order').all() as
    { name: string; sort_order: number; time_of_day: string }[]
  assert.deepEqual(rows, [
    { name: 'First habit', sort_order: 0, time_of_day: 'anytime' },
    { name: 'Second habit', sort_order: 1, time_of_day: 'anytime' }
  ])
  db.close()
})

test('the organisation migration can be run twice without trouble', () => {
  const db = freshDb()
  applyMigrations(db) // running it again must change nothing
  const rows = db.prepare('SELECT COUNT(*) AS n FROM habits').get() as { n: number }
  assert.equal(rows.n, 0)
  db.close()
})

// ---------- creating and reordering ----------

test('a new habit goes to the end of the list and defaults to "anytime"', () => {
  const db = freshDb()
  const first = createHabit(db, { name: 'First', notes: '', days: [0], archived: false })
  const second = createHabit(db, { name: 'Second', notes: '', days: [1], archived: false })
  const morning = createHabit(db, { name: 'Morning read', notes: '', days: [2], archived: false, timeOfDay: 'morning' })
  assert.ok((second.sortOrder ?? 0) > (first.sortOrder ?? 0))
  assert.equal(first.timeOfDay, 'anytime')
  assert.equal(morning.timeOfDay, 'morning')
  assert.deepEqual(listHabits(db).habits.map((h) => h.name), ['First', 'Second', 'Morning read'])
  db.close()
})

test('reorderHabits saves a manual order and listHabits follows it', () => {
  const db = freshDb()
  const a = createHabit(db, { name: 'A', notes: '', days: [0], archived: false })
  const b = createHabit(db, { name: 'B', notes: '', days: [1], archived: false })
  const c = createHabit(db, { name: 'C', notes: '', days: [2], archived: false })

  reorderHabits(db, [c.id, a.id, b.id])
  assert.deepEqual(listHabits(db).habits.map((h) => h.name), ['C', 'A', 'B'])

  // Bad input is refused, and changes nothing.
  assert.throws(() => reorderHabits(db, []))
  assert.throws(() => reorderHabits(db, [0]))
  assert.deepEqual(listHabits(db).habits.map((h) => h.name), ['C', 'A', 'B'])
  db.close()
})

// ---------- updating without losing fields ----------

test('updating without type/target/unit/time keeps them, and restoring archives to the end', () => {
  const db = freshDb()
  const h = createHabit(db, {
    name: 'Read', notes: '', days: [0], archived: false,
    type: 'duration', target: 10, unit: 'min', timeOfDay: 'evening'
  })

  // The small "restore" call only sends name/notes/days/archived. Everything
  // else must survive it unchanged.
  updateHabit(db, h.id, { name: 'Read', notes: '', days: [0, 1], archived: true })
  const archivedRow = listHabits(db).habits[0]
  assert.equal(archivedRow.archived, true)
  assert.equal(archivedRow.type, 'duration')
  assert.equal(archivedRow.target, 10)
  assert.equal(archivedRow.unit, 'min')
  assert.equal(archivedRow.timeOfDay, 'evening')

  // A habit created while the first one was archived takes the next position.
  createHabit(db, { name: 'Other', notes: '', days: [2], archived: false })

  // Restoring puts the habit at the END of the list, keeping its fields.
  updateHabit(db, h.id, { name: 'Read', notes: '', days: [0, 1], archived: false })
  const list = listHabits(db).habits
  assert.deepEqual(list.map((x) => x.name), ['Other', 'Read'])
  const restored = list[list.length - 1]
  assert.equal(restored.type, 'duration')
  assert.equal(restored.timeOfDay, 'evening')
  db.close()
})

// ---------- the shared time-of-day helpers ----------

test('cleanTimeOfDay falls back to "anytime" for anything unknown', () => {
  assert.equal(cleanTimeOfDay('morning'), 'morning')
  assert.equal(cleanTimeOfDay('afternoon'), 'afternoon')
  assert.equal(cleanTimeOfDay('evening'), 'evening')
  assert.equal(cleanTimeOfDay('anytime'), 'anytime')
  assert.equal(cleanTimeOfDay(undefined), 'anytime')
  assert.equal(cleanTimeOfDay(null), 'anytime')
  assert.equal(cleanTimeOfDay('nonsense'), 'anytime')
})

test('groupByTimeOfDay keeps the Morning..Anytime order and drops empty groups', () => {
  const groups = groupByTimeOfDay([
    { name: 'evening habit', timeOfDay: 'evening' as TimeOfDay },
    { name: 'no time habit' }, // no field at all: anytime
    { name: 'morning habit', timeOfDay: 'morning' as TimeOfDay },
    { name: 'nonsense habit', timeOfDay: 'nonsense' as TimeOfDay } // unknown: anytime
  ])
  assert.deepEqual(groups.map((g) => g.timeOfDay), ['morning', 'evening', 'anytime'])
  assert.deepEqual(groups.map((g) => g.label), ['Morning', 'Evening', 'Anytime'])
  assert.deepEqual(groups[0].habits.map((h) => h.name), ['morning habit'])
  assert.deepEqual(groups[2].habits.map((h) => h.name), ['no time habit', 'nonsense habit'])
  assert.equal(TIME_OF_DAY_ORDER[TIME_OF_DAY_ORDER.length - 1], 'anytime')
  assert.equal(TIME_OF_DAY_LABELS.anytime, 'Anytime')
})

console.log(`\n${n} organisation tests passed`)
