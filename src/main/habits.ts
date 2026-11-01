// Habit database queries (same pattern as the other modules).
import type Database from 'better-sqlite3'
import { computeHabitStatsFromCompletions, cleanTimeOfDay, cleanReminderTime, effectiveStart, isHabitDue, reachedTarget } from '../shared/habits'
import { emitAutomation } from './automations'
import { onLogbookEntryCreated } from './events'
import { isDate, localDate } from './util'
import type { AutoCompleteOn, Habit, HabitCompletion, HabitInput, HabitType, HabitsOverview, TimeOfDay } from '../shared/types'

interface Row {
  id: number; name: string; notes: string; days: string; archived: number
  start_date: string; created_at: string; updated_at: string
  type: HabitType; target: number | null; unit: string
  // Phase 5: manual order (drag-and-drop) and time of day.
  // Phase 6: reminder time ("HH:MM" or NULL) and the Logbook link.
  // Old rows (before these columns existed) read as NULL/'' when a backup is
  // imported.
  sort_order: number | null; time_of_day: string | null
  reminder_time: string | null; auto_complete_on: string | null
}

interface CheckinRow {
  habit_id: number
  date: string
  status: string
  value: number | null
}

// Reads every recorded day of the habits: the "done" days and the "skipped" ones.
// Old rows (from before the status column existed) read as "done".
function completionsOf(db: Database.Database): Map<number, HabitCompletion[]> {
  const byHabit = new Map<number, HabitCompletion[]>()
  const rows = db.prepare('SELECT habit_id, date, status, value FROM habit_checkins ORDER BY date').all() as CheckinRow[]
  for (const row of rows) {
    const list = byHabit.get(row.habit_id) ?? []
    // Anything that is not 'skipped' is a plain done day.
    const completion: HabitCompletion = { date: row.date, status: row.status === 'skipped' ? 'skipped' : 'done' }
    // The logged number, when there is one.
    if (row.value !== null && row.value !== undefined) completion.value = row.value
    list.push(completion)
    byHabit.set(row.habit_id, list)
  }
  return byHabit
}

const toHabit = (r: Row, completions: HabitCompletion[], today: string): Habit => {
  const days = JSON.parse(r.days) as number[]
  // "checkins" is the list of DONE days, which is what the old code used.
  const checkins = completions.filter((c) => c.status === 'done').map((c) => c.date)
  return {
    id: r.id, name: r.name, notes: r.notes, days, archived: r.archived === 1, startDate: r.start_date,
    checkins, completions,
    // The kind of habit. An old row has no type, so it is a plain check habit.
    type: r.type ?? 'check',
    target: r.target ?? null,
    unit: r.unit ?? '',
    // Phase 5 fields. A missing position reads as the creation order (the id),
    // so an imported old backup still lists its habits sensibly.
    sortOrder: r.sort_order ?? r.id,
    timeOfDay: cleanTimeOfDay(r.time_of_day),
    // Phase 6 fields. NULL/unknown values read as "no reminder" and "nothing
    // else completes this habit", which is what they meant before.
    reminderTime: cleanReminderTime(r.reminder_time),
    autoCompleteOn: (r.auto_complete_on === 'logbook-entry' ? 'logbook-entry' : '') as AutoCompleteOn,
    // The full list is used, so a skipped day is not mistaken for a missed one.
    stats: computeHabitStatsFromCompletions(
      { days, startDate: r.start_date, type: r.type ?? 'check', target: r.target ?? null, unit: r.unit ?? '' },
      completions,
      today
    ),
    createdAt: r.created_at, updatedAt: r.updated_at
  }
}

// Every recorded day of ONE habit (done or skipped), for code outside this
// module that needs the dates - the reminders module, for one.
export function habitCompletionsOf(db: Database.Database, habitId: number): HabitCompletion[] {
  return completionsOf(db).get(habitId) ?? []
}

// Every habit with its check-ins, plus today's date as the main process sees it.
// Active habits come first, each list in the manual order (sort_order); ties
// fall back to the old creation order, so nothing jumps unexpectedly.
export function listHabits(db: Database.Database, today: string = localDate()): HabitsOverview {
  const rows = db.prepare('SELECT * FROM habits ORDER BY archived, COALESCE(sort_order, id), id').all() as Row[]
  const byHabit = completionsOf(db)
  return { today, habits: rows.map((r) => toHabit(r, byHabit.get(r.id) ?? [], today)) }
}

function getHabit(db: Database.Database, id: number): Habit {
  const row = db.prepare('SELECT * FROM habits WHERE id = ?').get(id) as Row | undefined
  if (!row) throw new Error('Habit not found')
  const completions = completionsOf(db).get(id) ?? []
  return toHabit(row, completions, localDate())
}

function prepare(i: HabitInput, previous?: Row) {
  const name = i.name.trim()
  if (!name) throw new Error('Give the habit a name')
  const valid = Array.isArray(i.days) && i.days.length > 0 && i.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  if (!valid) throw new Error('Pick at least one day of the week')
  const days = [...new Set(i.days)].sort((a, b) => a - b)

  // The kind of habit. A habit without one is a plain 'check' habit.
  // When the caller did not send a type at all (the small "restore" call
  // only sends name/notes/days/archived), the OLD value is kept, so
  // restoring a count/duration habit does not silently reset it to a check.
  const rawType = i.type === undefined ? (previous?.type ?? 'check') : i.type
  const type: HabitType = rawType === 'count' || rawType === 'duration' ? rawType : 'check'
  // A target only makes sense for a count or duration habit.
  // Like the type: not sent means keep what was there.
  const target = type === 'check'
    ? null
    : i.target === undefined
      ? previous?.target ?? null
      : (typeof i.target === 'number' && isFinite(i.target) ? i.target : null)
  // A plain check habit has no unit either.
  const unit = type === 'check' ? '' : (i.unit === undefined ? previous?.unit ?? '' : i.unit).trim()  // The time of day: not sent means keep the old one; anything unknown
  // (including 'anytime') is cleaned up by cleanTimeOfDay.
  const timeOfDay: TimeOfDay = cleanTimeOfDay(i.timeOfDay === undefined ? previous?.time_of_day : i.timeOfDay)
  // The reminder time: not sent means keep the old one; anything that does
  // not look like a time is treated as "no reminder".
  const reminderTime = i.reminderTime === undefined ? cleanReminderTime(previous?.reminder_time) : cleanReminderTime(i.reminderTime)
  // The Logbook link: not sent means keep the old one; only 'logbook-entry'
  // is allowed (empty string = off).
  const rawAuto = i.autoCompleteOn === undefined ? previous?.auto_complete_on : i.autoCompleteOn
  const autoCompleteOn: AutoCompleteOn = rawAuto === 'logbook-entry' ? 'logbook-entry' : ''
  return {
    name, notes: i.notes, days: JSON.stringify(days), archived: i.archived ? 1 : 0,
    type, target, unit, timeOfDay, reminderTime, autoCompleteOn
  }

}

export function createHabit(db: Database.Database, input: HabitInput): Habit {
  const h = prepare(input)
  const now = new Date().toISOString()
  // A new habit goes to the END of the list: one more than the current
  // biggest position.
  const info = db.prepare(
    `INSERT INTO habits (name, notes, days, archived, start_date, created_at, updated_at, type, target, unit, time_of_day, sort_order, reminder_time, auto_complete_on)
     VALUES (@name, @notes, @days, @archived, @start, @now, @now, @type, @target, @unit, @timeOfDay,
             (SELECT COALESCE(MAX(sort_order), MAX(id), 0) + 1 FROM habits), @reminderTime, @autoCompleteOn)`
  ).run({ ...h, start: localDate(), now })
  return getHabit(db, Number(info.lastInsertRowid))
}

export function updateHabit(db: Database.Database, id: number, input: HabitInput): Habit {
  // The row as it is now, so fields the caller did not send keep their value
  // and a change from archived to active can be noticed.
  const previous = db.prepare('SELECT * FROM habits WHERE id = ?').get(id) as Row | undefined
  if (!previous) throw new Error('Habit not found')
  const h = prepare(input, previous)
  // sort_order is deliberately NOT in this statement: only reorderHabit moves
  // a habit's position, so saving the editor can never shuffle the list.
  db.prepare(
    `UPDATE habits SET name=@name, notes=@notes, days=@days, archived=@archived,
       updated_at=@now, type=@type, target=@target, unit=@unit, time_of_day=@timeOfDay,
       reminder_time=@reminderTime, auto_complete_on=@autoCompleteOn WHERE id=@id`
  ).run({ ...h, id, now: new Date().toISOString() })
  // Un-archiving puts the habit at the END of the list, so it does not jump
  // back into the middle of the order it had when it was archived.
  if (previous.archived === 1 && !input.archived) {
    db.prepare('UPDATE habits SET sort_order = (SELECT COALESCE(MAX(sort_order), MAX(id), 0) + 1 FROM habits) WHERE id = ?').run(id)
  }
  return getHabit(db, id)
}

// Saves a new manual order after drag-and-drop. `ids` are the ACTIVE habit
// ids in the order they should be listed (first = top). Each id gets its
// position in one transaction, so a failure changes nothing. Archived habits
// are not in the list; they keep their old position and are always shown
// after the active ones anyway.
export function reorderHabits(db: Database.Database, ids: number[]): void {
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error('Choose one or more habits')
  }
  const unique = [...new Set(ids)]
  const update = db.prepare('UPDATE habits SET sort_order = ? WHERE id = ?')
  db.transaction(() => unique.forEach((id, index) => update.run(index, id)))()
}

// Check-ins are removed too (ON DELETE CASCADE in the table definition).
export function deleteHabit(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM habits WHERE id = ?').run(id)
}

export function setCheckin(db: Database.Database, habitId: number, date: string, done: boolean): void {
  if (!isDate(date)) throw new Error('Date must look like 2026-10-25')
  if (date > localDate()) throw new Error('That day has not happened yet.')
  const habit = getHabit(db, habitId)
  // The streak BEFORE this change, so a break can be detected (automation event).
  const beforeStreak = habit.stats.current
  if (done) db.prepare('INSERT OR IGNORE INTO habit_checkins (habit_id, date, created_at) VALUES (?, ?, ?)').run(habitId, date, new Date().toISOString())
  else db.prepare('DELETE FROM habit_checkins WHERE habit_id = ? AND date = ?').run(habitId, date)
  const after = getHabit(db, habitId)
  if (beforeStreak >= 7 && after.stats.current < beforeStreak) {
    void emitAutomation(db, 'habit-streak-broken', `habit:${habitId}:break:${beforeStreak}:${after.stats.current}`,
      { habitId, habitName: habit.name, habitStreak: beforeStreak })
  }
}

// Sets what one day says: 'done', 'skipped', or null to clear the day.
// A cleared day is simply a day with no record, so it reads as "missed" if it
// was due and "rest" if it was not. Nothing about missed or rest is stored.
//
// `value` is the number logged on that day, for 'count' and 'duration' habits.
export function setDayStatus(
  db: Database.Database,
  habitId: number,
  date: string,
  status: 'done' | 'skipped' | null,
  value?: number | null
): void {
  if (!isDate(date)) throw new Error('Date must look like 2026-10-25')
  if (date > localDate()) throw new Error('That day has not happened yet.')
  const habit = getHabit(db, habitId)
  // The streak BEFORE this change, so a break can be detected (automation event).
  const beforeStreak = habit.stats.current

  if (status === null) {
    db.prepare('DELETE FROM habit_checkins WHERE habit_id = ? AND date = ?').run(habitId, date)
  } else {
    // The day is unique per habit, so this replaces whatever was there.
    db.prepare(
      `INSERT INTO habit_checkins (habit_id, date, created_at, status, value)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(habit_id, date) DO UPDATE SET status = excluded.status, value = excluded.value`
    ).run(habitId, date, new Date().toISOString(), status, value ?? null)
  }

  const after = getHabit(db, habitId)
  if (beforeStreak >= 7 && after.stats.current < beforeStreak) {
    void emitAutomation(db, 'habit-streak-broken', `habit:${habitId}:break:${beforeStreak}:${after.stats.current}`,
      { habitId, habitName: habit.name, habitStreak: beforeStreak })
  }
}

// Logs how much of a habit was done on a day, for 'count' and 'duration' habits.
//
// Logging a number that reaches the target marks the day done. Logging less
// leaves the day open (or missed, if the day has already passed), so a habit
// like "read for 10 minutes" only counts when you actually read for ten.
export function logHabitValue(
  db: Database.Database,
  habitId: number,
  date: string,
  value: number
): void {
  if (!isDate(date)) throw new Error('Date must look like 2026-10-25')
  if (date > localDate()) throw new Error('That day has not happened yet.')
  if (!isFinite(value) || value < 0) throw new Error('The value must be zero or more.')

  const habit = getHabit(db, habitId)
  // The streak BEFORE this change, so a break can be detected (automation event).
  const beforeStreak = habit.stats.current

  // The day is always recorded as 'done'; whether it really counts as done is
  // worked out from the value and the target (see reachedTarget).
  db.prepare(
    `INSERT INTO habit_checkins (habit_id, date, created_at, status, value)
      VALUES (?, ?, ?, 'done', ?)
     ON CONFLICT(habit_id, date) DO UPDATE SET value = excluded.value`
  ).run(habitId, date, new Date().toISOString(), value)

  const after = getHabit(db, habitId)
  if (beforeStreak >= 7 && after.stats.current < beforeStreak) {
    void emitAutomation(db, 'habit-streak-broken', `habit:${habitId}:break:${beforeStreak}:${after.stats.current}`,
      { habitId, habitName: habit.name, habitStreak: beforeStreak })
  }
}

// ---------- Phase 6: the Logbook link (auto-complete) ----------

// Marks habits with autoCompleteOn = 'logbook-entry' as done for the day of
// a new Logbook entry. The Logbook module NEVER calls this: it just announces
// new entries on the event bus (see events.ts), and the subscription below
// is what reacts. Each module stays importable and testable on its own.
//
// The rules:
//   - the habit must be DUE that day (rest days are never checked off)
//   - the day must have no record yet: what you logged yourself (or skipped,
//     or cleared) is never overwritten
// the entry must not be in the future (creating an entry for tomorrow
//                      would otherwise tick off a day that has not happened)
export function autoCompleteOnDay(db: Database.Database, date: string): void {
  if (!isDate(date)) throw new Error('Date must look like 2026-10-25')
  const today = localDate()
  if (date > today) return // a future entry cannot complete a future day

  const habits = listHabits(db, today).habits.filter((h) => !h.archived && h.autoCompleteOn === 'logbook-entry')
  for (const h of habits) {
    // The effective start (habit's start date or its first record) decides
    // when tracking began, exactly like everywhere else in the app.
    const firstRow = db.prepare('SELECT MIN(date) AS d FROM habit_checkins WHERE habit_id = ?').get(h.id) as { d: string | null }
    const completions: HabitCompletion[] = firstRow.d ? [{ date: firstRow.d, status: 'done' }] : []
    if (!isHabitDue(h, date, effectiveStart({ days: h.days, startDate: h.startDate }, completions))) continue

    const existing = db.prepare('SELECT habit_id FROM habit_checkins WHERE habit_id = ? AND date = ?').get(h.id, date)
    if (existing) continue // there is already a record; what you wrote stays

    db.prepare(
      `INSERT INTO habit_checkins (habit_id, date, created_at, status) VALUES (?, ?, ?, 'done')
       ON CONFLICT(habit_id, date) DO NOTHING`
    ).run(h.id, date, new Date().toISOString())
  }
}

// The subscription itself. Loading this module (as the app does at startup,
// and any test that imports these queries does) connects the two features.
onLogbookEntryCreated((db, event) => autoCompleteOnDay(db, event.date))
