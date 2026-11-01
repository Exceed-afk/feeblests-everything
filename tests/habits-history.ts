// Tests for the Phase 2 rules: the week navigation helpers, the day choices
// the popover offers, and the migration that added the habit day status.
// These are pure functions, so no database is needed.
//
//   tsx tests/habits-history.ts
import assert from 'node:assert/strict'
import {
  addDays,
  canEditDay,
  effectiveStart,
  shiftWeek,
  storedStatusFor,
  weekDays,
  weekLabel,
  weekStart
} from '../src/shared/habits'
import { MIGRATIONS } from '../src/main/migrations'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

// 2026-10-26 is a Monday. Every date below is a real calendar day around it.
const MON = '2026-10-26'
const TUE = '2026-10-27'
const SUN = '2026-11-01'
const NEXT_MON = '2026-11-02'

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS = [0, 1, 2, 3, 4]

// ---------- week navigation ----------

test('a week always starts on Monday', () => {
  assert.equal(weekStart(MON), MON) // already a Monday
  assert.equal(weekStart(TUE), MON)
  assert.equal(weekStart(SUN), MON)
  assert.equal(weekStart(NEXT_MON), NEXT_MON)
})

test('a week is seven days, Monday first', () => {
  const days = weekDays(MON)
  assert.equal(days.length, 7)
  assert.equal(days[0], MON)
  assert.equal(days[6], SUN)
  assert.deepEqual(days, [
    '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'
  ])
})

test('weeks move forwards and backwards by seven days', () => {
  assert.equal(shiftWeek(MON, 1), NEXT_MON)
  assert.equal(shiftWeek(MON, -1), '2026-10-19')
  assert.equal(shiftWeek(MON, 2), '2026-11-09')
  // Going back and forth lands on the same Monday.
  assert.equal(shiftWeek(shiftWeek(MON, 3), -3), MON)
})

test('the week label reads naturally', () => {
  // The week of Monday 26th runs to Sunday 1st November.
  assert.equal(weekLabel(MON), '26 Oct - 1 Nov')
  // A week inside one month needs no month names on the end date.
  assert.equal(weekLabel('2026-10-19'), '19 Oct - 25 Oct')
  // A week that spans two years shows the year on both ends.
  assert.equal(weekLabel('2026-12-28'), '28 Dec 2026 - 3 Jan 2027')
})

// ---------- the day choices ----------

test('Done stores "done" and Skipped stores "skipped"', () => {
  assert.equal(storedStatusFor('done'), 'done')
  assert.equal(storedStatusFor('skipped'), 'skipped')
})

test('Missed and Clear both store nothing', () => {
  // A missed day is worked out from the schedule, so it is never stored.
  assert.equal(storedStatusFor('missed'), null)
  assert.equal(storedStatusFor('clear'), null)
})

// ---------- which days can be changed ----------

test('a future day cannot be changed', () => {
  const habit = { days: EVERY_DAY, startDate: '2026-10-20' }
  assert.equal(canEditDay(habit, [], TUE, MON), false)
})

test('today and the past can be changed', () => {
  const habit = { days: EVERY_DAY, startDate: '2026-10-20' }
  assert.equal(canEditDay(habit, [], MON, MON), true)
  assert.equal(canEditDay(habit, [], '2026-10-20', MON), true)
})

test('a rest day cannot be marked done or missed', () => {
  // The habit only runs on weekdays, so Saturday and Sunday are rest days.
  const habit = { days: WEEKDAYS, startDate: '2026-10-19' }
  assert.equal(canEditDay(habit, [], '2026-10-24', MON), false) // Saturday
  assert.equal(canEditDay(habit, [], '2026-10-25', MON), false) // Sunday
  assert.equal(canEditDay(habit, [], '2026-10-23', MON), true)  // Friday
})

test('a day before the habit existed cannot be changed', () => {
  const habit = { days: EVERY_DAY, startDate: MON }
  assert.equal(canEditDay(habit, [], '2026-10-25', MON), false)
})

test('the effective start moves back when a day was recorded earlier', () => {
  const habit = { days: EVERY_DAY, startDate: MON }
  const completions = [{ date: '2026-10-24', status: 'done' as const }]
  assert.equal(effectiveStart(habit, completions), '2026-10-24')
  // With nothing recorded, the habit's own start date is used.
  assert.equal(effectiveStart(habit, []), MON)
  // A habit with no start date at all has no effective start.
  assert.equal(effectiveStart({ days: EVERY_DAY }, []), undefined)
})

// ---------- the migration ----------

test('the habit day status migration adds a status column', () => {
  // The status migration is the one that adds the "done" or "skipped" column.
  // It is not necessarily the last one: later migrations add other columns.
  const statusMigration = MIGRATIONS.find((m) => /ADD COLUMN status/.test(m))
  assert.ok(statusMigration, 'there should be a migration that adds the status column')
  assert.match(statusMigration, /ALTER TABLE habit_checkins ADD COLUMN status/)
  assert.match(statusMigration, /DEFAULT 'done'/)
  // It must never wipe anything: no DROP, no DELETE.
  assert.doesNotMatch(statusMigration, /DROP TABLE|DELETE FROM/)
})

test('the habit type migration adds the type, target and unit columns', () => {
  const typeMigration = MIGRATIONS.find((m) => /ADD COLUMN type/.test(m))
  assert.ok(typeMigration, 'there should be a migration that adds the type column')
  assert.match(typeMigration, /ALTER TABLE habits ADD COLUMN type/)
  assert.match(typeMigration, /ALTER TABLE habits ADD COLUMN target/)
  assert.match(typeMigration, /ALTER TABLE habits ADD COLUMN unit/)
  // The logged number for a count or duration habit.
  assert.match(typeMigration, /ALTER TABLE habit_checkins ADD COLUMN value/)
  // Existing habits become plain "check" habits, so nothing changes meaning.
  assert.match(typeMigration, /DEFAULT 'check'/)
  // It must never wipe anything: no DROP, no DELETE.
  assert.doesNotMatch(typeMigration, /DROP TABLE|DELETE FROM/)
})

test('addDays still crosses months and years', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2026-10-26', 7), NEXT_MON)
})

console.log(`ALL ${n} PASSED`)
