// Tests for the Phase 1 habit rules: the due-day check, the day status and
// the streak calculations. These are pure functions, so no database is needed.
//
//   tsx tests/habits-rules.ts
import assert from 'node:assert/strict'
import {
  addDays,
  calculateBestStreak,
  calculateCompletionRate,
  calculateCurrentStreak,
  getDayStatus,
  isHabitDue,
  weekdayOf
} from '../src/shared/habits'
import type { HabitCompletion } from '../src/shared/habits'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

// 2026-10-26 is a Monday. Every date below is a real calendar day around it.
const MON = '2026-10-26'
const TUE = '2026-10-27'
const SUN = '2026-11-01'

// The week before, used by the tests that start on Tuesday 20th October.
const T20 = '2026-10-20' // Tuesday
const W21 = '2026-10-21' // Wednesday
const T22 = '2026-10-22' // Thursday
const F23 = '2026-10-23' // Friday
const S24 = '2026-10-24' // Saturday
const S25 = '2026-10-25' // Sunday

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS = [0, 1, 2, 3, 4]
// "November training": rest days Mon, Wed, Fri -> active Tue, Thu, Sat, Sun
const NOV_TRAINING = [1, 3, 5, 6]
// "4 rules must obey": active Tue, Wed, Thu, Fri, Sat, Sun (rest on Monday)
const FOUR_RULES = [1, 2, 3, 4, 5, 6]

// Builds a completion list from plain dates (all "done").
const done = (...dates: string[]): HabitCompletion[] => dates.map((date) => ({ date, status: 'done' }))
// Builds a completion list where some days were skipped.
const mixed = (dates: string[], skipped: string[] = []): HabitCompletion[] => [
  ...dates.map((date) => ({ date, status: 'done' as const })),
  ...skipped.map((date) => ({ date, status: 'skipped' as const }))
]

// ---------- isHabitDue ----------

test('a habit is due only on the weekdays it is scheduled for', () => {
  assert.equal(isHabitDue({ days: WEEKDAYS }, MON), true)
  assert.equal(isHabitDue({ days: WEEKDAYS }, '2026-10-31'), false) // Saturday
  assert.equal(isHabitDue({ days: WEEKDAYS }, SUN), false) // Sunday
})

test('days before the habit existed are not due', () => {
  const habit = { days: EVERY_DAY, startDate: MON }
  assert.equal(isHabitDue(habit, MON), true)
  assert.equal(isHabitDue(habit, '2026-10-25'), false)
})

test('a habit with no start date is due on every scheduled day', () => {
  assert.equal(isHabitDue({ days: EVERY_DAY }, '2020-01-01'), true)
})

// ---------- getDayStatus ----------

test('getDayStatus knows all six states', () => {
  const habit = { days: WEEKDAYS, startDate: '2026-10-19' }
  const completions = done('2026-10-20', '2026-10-21')
  assert.equal(getDayStatus(habit, '2026-10-20', completions, MON), 'done')
  assert.equal(getDayStatus(habit, '2026-10-19', completions, MON), 'missed')
  // Saturday 24th is a rest day for a weekdays-only habit, and it is in the past.
  assert.equal(getDayStatus(habit, '2026-10-24', completions, MON), 'rest')
  assert.equal(getDayStatus(habit, '2026-11-05', completions, MON), 'future')
  assert.equal(getDayStatus(habit, MON, completions, MON), 'pending')
  assert.equal(getDayStatus(habit, '2026-10-22', mixed([], ['2026-10-22']), MON), 'skipped')
})

test('a skipped day is reported as skipped, not missed', () => {
  const habit = { days: EVERY_DAY, startDate: '2026-10-19' }
  const completions = mixed([], ['2026-10-22'])
  assert.equal(getDayStatus(habit, '2026-10-22', completions, MON), 'skipped')
})

test('a check-in on a rest day is a bonus: it stays a rest day', () => {
  // Sunday 25th is a rest day for a weekdays-only habit. Checking it off must
  // NOT make it a "done" day, because the habit was not due that day.
  const habit = { days: WEEKDAYS, startDate: '2026-10-19' }
  const completions = done('2026-10-25')
  assert.equal(getDayStatus(habit, '2026-10-25', completions, MON), 'rest')
  // ...and it must not count towards the streak.
  assert.equal(calculateCurrentStreak(habit, completions, MON), 0)
})

test('today is pending, never missed, even when it is due', () => {
  const habit = { days: EVERY_DAY, startDate: '2026-10-19' }
  assert.equal(getDayStatus(habit, MON, [], MON), 'pending')
  // A due day that was already checked off is done, not pending.
  assert.equal(getDayStatus(habit, W21, done(W21), MON), 'done')
  // A day after today has not happened yet, whatever was recorded for it.
  assert.equal(getDayStatus(habit, TUE, done(TUE), MON), 'future')
})

// ---------- calculateCurrentStreak ----------

test('a rest day in the middle of a streak does not break it', () => {
  // "November training" rests Mon/Wed/Fri, so Tue/Thu/Sat/Sun are the active
  // days. Tue 27th, Thu 29th and Sat 31st are all checked, with the rest days
  // (Wed 28th, Fri 30th) in between - those must not interrupt the run.
  const habit = { days: NOV_TRAINING, startDate: '2026-10-27' }
  const completions = done('2026-10-27', '2026-10-29', '2026-10-31')
  // Sunday 1st is today and still open, so the streak of 3 stands.
  assert.equal(calculateCurrentStreak(habit, completions, SUN), 3)
})

test('a rest day in the middle of a streak does not break it (today done too)', () => {
  // Same run, but Sunday is also checked: 4 active days in a row.
  const habit = { days: NOV_TRAINING, startDate: '2026-10-27' }
  const completions = done('2026-10-27', '2026-10-29', '2026-10-31', '2026-11-01')
  assert.equal(calculateCurrentStreak(habit, completions, SUN), 4)
})

test('November training: a missed due day breaks the streak', () => {
  // Saturday 31st is an active day and it was missed, so the run ends there.
  const habit = { days: NOV_TRAINING, startDate: '2026-10-27' }
  const completions = done('2026-10-27', '2026-10-29')
  assert.equal(calculateCurrentStreak(habit, completions, SUN), 0)
})

test('a missed day breaks a streak', () => {
  const habit = { days: EVERY_DAY, startDate: T20 }
  // Tuesday 20th and Thursday 22nd are done, Wednesday 21st was missed.
  const completions = done(T20, T22)
  // Today is Friday 23rd and is still open, so the run is just the 22nd.
  assert.equal(calculateCurrentStreak(habit, completions, F23), 1)
})

test('today not done yet does not break the streak', () => {
  const habit = { days: EVERY_DAY, startDate: F23 }
  const completions = done(F23, S24, S25)
  // Today (Monday the 26th) is still open, so the streak of 3 stands.
  assert.equal(calculateCurrentStreak(habit, completions, MON), 3)
})

test('a skipped day does not break the streak', () => {
  const habit = { days: EVERY_DAY, startDate: F23 }
  const completions = mixed([F23, S25], [S24])
  assert.equal(calculateCurrentStreak(habit, completions, MON), 2)
})

test('days before the habit existed are not counted as missed', () => {
  const habit = { days: EVERY_DAY, startDate: MON }
  const completions = done(MON)
  assert.equal(calculateCurrentStreak(habit, completions, MON), 1)
})

test('a brand new habit with nothing checked has no streak', () => {
  const habit = { days: EVERY_DAY, startDate: MON }
  assert.equal(calculateCurrentStreak(habit, [], MON), 0)
})

// ---------- calculateBestStreak ----------

test('the best streak remembers an earlier, longer run', () => {
  const habit = { days: EVERY_DAY, startDate: '2026-10-17' }
  const completions = done('2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', MON)
  assert.equal(calculateBestStreak(habit, completions, MON), 4)
})

test('the best streak ignores rest days', () => {
  // Tue, Thu, Sat, Sun due and done; Mon/Wed/Fri are rest days in between.
  const habit = { days: NOV_TRAINING, startDate: '2026-10-27' }
  const completions = done('2026-10-27', '2026-10-29', '2026-10-31', '2026-11-01')
  assert.equal(calculateBestStreak(habit, completions, SUN), 4)
})

test('the best streak of a habit with no check-ins is 0', () => {
  assert.equal(calculateBestStreak({ days: EVERY_DAY, startDate: MON }, [], MON), 0)
})

// ---------- calculateCompletionRate ----------

test('the completion rate counts only due days', () => {
  // The window holds 3 due days (Tue 27th, Thu 29th, Sat 31st) and 2 of them
  // are done, so the rate is 66.67%. The rest days are not counted at all.
  const habit = { days: NOV_TRAINING, startDate: '2026-10-27' }
  const completions = done('2026-10-27', '2026-10-29')
  assert.equal(calculateCompletionRate(habit, completions, 6, SUN), 66.66666667)
})

test('the completion rate ignores today when it is not done yet', () => {
  // Today is due but still open, so it is not counted as a miss.
  const habit = { days: EVERY_DAY, startDate: '2026-10-25' }
  const completions = done('2026-10-25')
  assert.equal(calculateCompletionRate(habit, completions, 30, MON), 100)
})

test('the completion rate is 0 when nothing was due', () => {
  const habit = { days: NOV_TRAINING, startDate: '2026-10-20' }
  // A 1-day window that contains only a rest day (Monday).
  assert.equal(calculateCompletionRate(habit, [], 1, MON), 0)
})

test('the completion rate counts a skipped day as a due day that was not done', () => {
  const habit = { days: EVERY_DAY, startDate: T20 }
  const completions = mixed([T20], [W21])
  // Today is Friday 23rd. A 4-day window covers the 20th (done), the 21st
  // (skipped) and the 22nd (missed). Today itself is still open, so it is not
  // counted. 1 of 3 -> 33.33%.
  assert.equal(calculateCompletionRate(habit, completions, 4, F23), 33.33333333)
})

// ---------- the "4 rules must obey" case ----------

test('"4 rules must obey": rest days show as rest, not as missed', () => {
  // Monday is the rest day for this habit. On Monday it must be a rest day
  // (never a red cross), and the active days must not be empty rest cells.
  // Today is Monday 26th; Tue 20th to Sun 25th are the six active days.
  const habit = { days: FOUR_RULES, startDate: T20 }
  const completions = done(T20, W21, T22, F23, S24, S25)
  assert.equal(getDayStatus(habit, MON, completions, MON), 'rest')
  assert.equal(getDayStatus(habit, T20, completions, MON), 'done')
  assert.equal(getDayStatus(habit, W21, completions, MON), 'done')
  assert.equal(getDayStatus(habit, T22, completions, MON), 'done')
  assert.equal(getDayStatus(habit, F23, completions, MON), 'done')
  assert.equal(getDayStatus(habit, S24, completions, MON), 'done')
  assert.equal(getDayStatus(habit, S25, completions, MON), 'done')
})

test('"4 rules must obey": the streak counts the six active days, not the rest day', () => {
  const habit = { days: FOUR_RULES, startDate: T20 }
  const completions = done(T20, W21, T22, F23, S24, S25)
  // Monday rests, so the run of six active days (Tue-Sun) is unbroken.
  assert.equal(calculateCurrentStreak(habit, completions, MON), 6)
  assert.equal(calculateBestStreak(habit, completions, MON), 6)
})

test('"4 rules must obey": a missed active day breaks the streak', () => {
  const habit = { days: FOUR_RULES, startDate: T20 }
  // Sunday (active) was missed, so the run ends there.
  const completions = done(T20, W21, T22, F23, S24)
  assert.equal(calculateCurrentStreak(habit, completions, MON), 0)
})

// ---------- date helpers used by the rules ----------

test('the weekday numbers line up with the calendar', () => {
  assert.equal(weekdayOf(MON), 0)
  assert.equal(weekdayOf(SUN), 6)
  assert.equal(addDays(SUN, 1), '2026-11-02')
})

console.log(`ALL ${n} PASSED`)
