// Habit database queries (same pattern as the other modules).
import type Database from 'better-sqlite3'
import { computeHabitStats } from '../shared/habits'
import { isDate, localDate } from './util'
import type { Habit, HabitInput, HabitsOverview } from '../shared/types'

interface Row {
  id: number; name: string; notes: string; days: string; archived: number
  start_date: string; created_at: string; updated_at: string
}

const toHabit = (r: Row, checkins: string[], today: string): Habit => {
  const days = JSON.parse(r.days) as number[]
  return {
    id: r.id, name: r.name, notes: r.notes, days, archived: r.archived === 1, startDate: r.start_date,
    checkins, stats: computeHabitStats({ days, startDate: r.start_date }, checkins, today),
    createdAt: r.created_at, updatedAt: r.updated_at
  }
}

// Every habit with its check-ins, plus today's date as the main process sees it.
export function listHabits(db: Database.Database, today: string = localDate()): HabitsOverview {
  const rows = db.prepare('SELECT * FROM habits ORDER BY archived, created_at, id').all() as Row[]
  const byHabit = new Map<number, string[]>()
  for (const c of db.prepare('SELECT habit_id, date FROM habit_checkins ORDER BY date').all() as { habit_id: number; date: string }[]) {
    const list = byHabit.get(c.habit_id) ?? []
    list.push(c.date)
    byHabit.set(c.habit_id, list)
  }
  return { today, habits: rows.map((r) => toHabit(r, byHabit.get(r.id) ?? [], today)) }
}

function getHabit(db: Database.Database, id: number): Habit {
  const row = db.prepare('SELECT * FROM habits WHERE id = ?').get(id) as Row | undefined
  if (!row) throw new Error('Habit not found')
  const dates = (db.prepare('SELECT date FROM habit_checkins WHERE habit_id = ? ORDER BY date').all(id) as { date: string }[]).map((d) => d.date)
  return toHabit(row, dates, localDate())
}

function prepare(i: HabitInput) {
  const name = i.name.trim()
  if (!name) throw new Error('Give the habit a name')
  const valid = Array.isArray(i.days) && i.days.length > 0 && i.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  if (!valid) throw new Error('Pick at least one day of the week')
  const days = [...new Set(i.days)].sort((a, b) => a - b)
  return { name, notes: i.notes, days: JSON.stringify(days), archived: i.archived ? 1 : 0 }
}

export function createHabit(db: Database.Database, input: HabitInput): Habit {
  const h = prepare(input)
  const now = new Date().toISOString()
  const info = db.prepare(
    `INSERT INTO habits (name, notes, days, archived, start_date, created_at, updated_at)
     VALUES (@name, @notes, @days, @archived, @start, @now, @now)`
  ).run({ ...h, start: localDate(), now })
  return getHabit(db, Number(info.lastInsertRowid))
}

export function updateHabit(db: Database.Database, id: number, input: HabitInput): Habit {
  const h = prepare(input)
  db.prepare('UPDATE habits SET name=@name, notes=@notes, days=@days, archived=@archived, updated_at=@now WHERE id=@id')
    .run({ ...h, id, now: new Date().toISOString() })
  return getHabit(db, id)
}

// Check-ins are removed too (ON DELETE CASCADE in the table definition).
export function deleteHabit(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM habits WHERE id = ?').run(id)
}

export function setCheckin(db: Database.Database, habitId: number, date: string, done: boolean): void {
  if (!isDate(date)) throw new Error('Date must look like 2026-10-25')
  if (date > localDate()) throw new Error('That day has not happened yet.')
  getHabit(db, habitId) // throws if the habit does not exist
  if (done) db.prepare('INSERT OR IGNORE INTO habit_checkins (habit_id, date, created_at) VALUES (?, ?, ?)').run(habitId, date, new Date().toISOString())
  else db.prepare('DELETE FROM habit_checkins WHERE habit_id = ? AND date = ?').run(habitId, date)
}
