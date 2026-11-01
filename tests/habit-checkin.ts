import assert from 'node:assert/strict'
import { applyMigrations } from '../src/main/migrations'
import { setCheckin, setDayStatus } from '../src/main/habits'
import { localDate } from '../src/main/util'
import { openDatabase } from './sqlite'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

function freshDb() {
  const db = openDatabase()
  applyMigrations(db)
  return db
}

test('checking a skipped day marks it done, and unchecking clears its record', () => {
  const db = freshDb()
  try {
    const date = localDate()
    const habitId = Number(db.prepare(
      `INSERT INTO habits (name, notes, days, archived, start_date, created_at, updated_at)
       VALUES ('Read', '', '[0,1,2,3,4,5,6]', 0, ?, 'now', 'now')`
    ).run(date).lastInsertRowid)

    setDayStatus(db, habitId, date, 'skipped')
    setCheckin(db, habitId, date, true)
    assert.equal(
      (db.prepare('SELECT status FROM habit_checkins WHERE habit_id = ? AND date = ?').get(habitId, date) as { status: string }).status,
      'done'
    )

    setDayStatus(db, habitId, date, 'skipped')
    setCheckin(db, habitId, date, false)
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM habit_checkins WHERE habit_id = ? AND date = ?').get(habitId, date) as { n: number }).n,
      0
    )
  } finally {
    db.close()
  }
})

console.log(`\n${n} habit check-in checks passed`)
