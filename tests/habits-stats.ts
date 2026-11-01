// Tests for the Phase 3 helpers: the milestone badges and the perfect-week
// mark. These are pure functions, so no database is needed.
//
//   tsx tests/habits-stats.ts
import assert from 'node:assert/strict'
import {
  addDays,
  calculateBestStreak,
  calculateCurrentStreak,
  calculateCompletionRate,
  effectiveStart,
  isPerfectWeek,
  milestoneLabel,
  reachedMilestone,
  weekdayOf,
  weekProgress
} from '../src/shared/habits'
import type { HabitCompletion } from '../src/shared/habits'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

// 2026-10-26 is a Monday. The week below runs Mon 26 Oct to Sun 1 Nov.
const MON = '2026-10-26'
const TUE = '2026-10-27'
const WED = '2026-10-28'
const THU = '2026-10-29'
const FRI = '2026-10-30'
const SAT = '2026-10-31'
const SUN = '2026-11-01'

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
// "November training": rest days Mon, Wed, Fri -> active Tue, Thu, Sat, Sun
const NOV_TRAINING = [1, 3, 5, 6]

// Builds a completion list from plain dates (all "done").
const done = (...dates: string[]): HabitCompletion[] => dates.map((date) => ({ date, status: 'done' }))
// Builds a completion list where some days were skipped.
const mixed = (dates: string[], skipped: string[] = []): HabitCompletion[] => [
  ...dates.map((date) => ({ date, status: 'done' as const })),
  ...skipped.map((date) => ({ date, status: 'skipped' as const }))
]

// ---------- reachedMilestone ----------

test('no milestone before the first one', () => {
  assert.equal(reachedMilestone(0), null)
  assert.equal(reachedMilestone(1), null)
  assert.equal(reachedMilestone(6), null)
})

test('the 7-day milestone appears at exactly 7 days', () => {
  assert.equal(reachedMilestone(7), 7)
  assert.equal(reachedMilestone(9), 7)
})

test('the 30-day milestone replaces the 7-day one', () => {
  assert.equal(reachedMilestone(30), 30)
  assert.equal(reachedMilestone(45), 30)
})

test('the 100-day milestone replaces the 30-day one', () => {
  assert.equal(reachedMilestone(100), 100)
  assert.equal(reachedMilestone(250), 100)
})

test('the milestone labels read naturally', () => {
  assert.equal(milestoneLabel(7), '7-day streak')
  assert.equal(milestoneLabel(30), '30-day streak')
  assert.equal(milestoneLabel(100), '100-day streak')
})

// ---------- isPerfectWeek ----------

test('a week with every due day done is perfect', () => {
  const habit = { days: EVERY_DAY, startDate: MON }
  const completions = done(MON, TUE, WED, THU, FRI, SAT, SUN)
  // It is now Monday 2 Nov, so the whole week has closed and was done.
  assert.equal(isPerfectWeek(habit, completions, MON, '2026-11-02'), true)
})

test('a week with one missed due day is not perfect', () => {
  const habit = { days: EVERY_DAY, startDate: MON }
  const completions = done(MON, TUE, WED, THU, FRI, SAT) // Sunday missed
  // It is now Monday 2 Nov, so Sunday is a closed day that was missed.
  assert.equal(isPerfectWeek(habit, completions, MON, '2026-11-02'), false)
})

test('a week where every due day was done so far is perfect, even mid-week', () => {
  // It is Wednesday. Monday and Tuesday were due and both done. Wednesday
  // itself is still open, so it is not judged yet.
  const habit = { days: EVERY_DAY, startDate: MON }
  const completions = done(MON, TUE)
  assert.equal(isPerfectWeek(habit, completions, MON, WED), true)
})

test('a rest day does not spoil a perfect week', () => {
  // "November training" rests Mon, Wed, Fri. Only Tue, Thu, Sat, Sun are due,
  // so all four being done makes the week perfect.
  const habit = { days: NOV_TRAINING, startDate: '2026-10-01' }
  const completions = done(TUE, THU, SAT, SUN)
  assert.equal(isPerfectWeek(habit, completions, MON, '2026-11-02'), true)
})

test('a skipped day does not spoil a perfect week', () => {
  // A skipped day was due, so it was not done. The week is therefore not perfect.
  const habit = { days: EVERY_DAY, startDate: MON }
  const completions = mixed([MON, TUE, WED, THU, FRI, SAT], [SUN])
  assert.equal(isPerfectWeek(habit, completions, MON, '2026-11-02'), false)
})

test('a week with nothing due is not perfect', () => {
  // A habit that only runs on Monday: the week starting Monday 26 Oct is due,
  // but a week where nothing was due cannot be perfect.
  const habit = { days: [0], startDate: '2026-10-01' }
  const empty: HabitCompletion[] = []
  // A week that contains no Monday at all is impossible, so check a habit that
  // was not running yet during this week.
  const notStarted = { days: EVERY_DAY, startDate: '2026-11-02' }
  assert.equal(isPerfectWeek(notStarted, empty, MON, SUN), false)
  assert.equal(isPerfectWeek(habit, empty, MON, SUN), false)
})

test('days before the habit existed do not count against a perfect week', () => {
  // The habit starts on Wednesday. Monday and Tuesday are not tracked at all.
  const habit = { days: EVERY_DAY, startDate: WED }
  const completions = done(WED, THU, FRI, SAT, SUN)
  assert.equal(isPerfectWeek(habit, completions, MON, SUN), true)
})

test('the perfect week follows the effective start date', () => {
  // The habit was created on the 26th but checked off on the 20th, so tracking
  // really began on the 20th - and the 20th was not done.
  const habit = { days: EVERY_DAY, startDate: MON }
  const completions = done('2026-10-20', MON, TUE, WED, THU, FRI, SAT, SUN)
  assert.equal(effectiveStart(habit, completions), '2026-10-20')
  // The week of the 19th contains the 20th, which was not done.
  assert.equal(isPerfectWeek(habit, completions, '2026-10-19', SUN), false)
  // The week of the 26th is complete.
  assert.equal(isPerfectWeek(habit, completions, MON, SUN), true)
})

// ---------- weekProgress ----------

test('week progress counts the due days and the done ones', () => {
  const habit = { days: EVERY_DAY, startDate: MON }
  const completions = done(MON, TUE, WED)
  assert.deepEqual(weekProgress(habit, completions, MON, WED), { due: 3, done: 3 })
})

test('week progress ignores rest days', () => {
  // "November training" rests Mon, Wed, Fri -> only 4 days are due in the week.
  const habit = { days: NOV_TRAINING, startDate: '2026-10-01' }
  const completions = done(TUE, THU, SAT, SUN)
  assert.deepEqual(weekProgress(habit, completions, MON, SUN), { due: 4, done: 4 })
})

test('week progress does not count days that have not happened yet', () => {
  // It is Tuesday: Monday has happened, Tuesday is still open, the rest is future.
  const habit = { days: EVERY_DAY, startDate: MON }
  const completions = done(MON)
  assert.deepEqual(weekProgress(habit, completions, MON, TUE), { due: 2, done: 1 })
})

test('week progress counts a skipped day as due but not done', () => {
  const habit = { days: EVERY_DAY, startDate: MON }
  const completions = mixed([MON], [TUE])
  assert.deepEqual(weekProgress(habit, completions, MON, TUE), { due: 2, done: 1 })
})

// ---------- the stats and the milestones together ----------

test('a long run earns the 30-day milestone and the best streak agrees', () => {
  // 30 days in a row, every day due.
  const habit = { days: EVERY_DAY, startDate: '2026-09-15' }
  const dates: string[] = []
  for (let i = 0; i < 30; i++) {
    dates.push(addDays('2026-09-15', i))
  }
  const completions = done(...dates)
  const streak = calculateCurrentStreak(habit, completions, '2026-10-14')
  assert.equal(streak, 30)
  assert.equal(reachedMilestone(streak), 30)
  assert.equal(calculateBestStreak(habit, completions, '2026-10-14'), 30)
})

test('a rest day inside a long run does not break the milestone', () => {
  // "November training" rests Mon, Wed, Fri. Four weeks of Tue/Thu/Sat/Sun
  // give a streak of 16 due days in a row.
  const habit = { days: NOV_TRAINING, startDate: '2026-10-01' }
  // Start from Monday 5 Oct and step a week at a time, so the due days always
  // land on the right weekdays.
  const dates: string[] = []
  for (let week = 0; week < 4; week++) {
    const monday = addDays('2026-10-05', week * 7)
    for (const offset of [1, 3, 5, 6]) { // Tue, Thu, Sat, Sun
      dates.push(addDays(monday, offset))
    }
  }
  const completions = done(...dates.sort())
  // Sunday 1 Nov is the last due day of the run, so the whole run counts.
  const streak = calculateCurrentStreak(habit, completions, '2026-11-01')
  assert.equal(streak, 16)
  assert.equal(reachedMilestone(streak), 7)
})

test('the 30-day rate counts only due days', () => {
  // Over the last 30 days, "November training" is due on about 17 days.
  // All of them are done except the last, so the rate is high but not perfect.
  const habit = { days: NOV_TRAINING, startDate: '2026-09-20' }
  const dates: string[] = []
  for (let i = 0; i < 30; i++) {
    const iso = addDays('2026-10-01', i)
    if (NOV_TRAINING.includes(weekdayOf(iso))) dates.push(iso)
  }
  const completions = done(...dates.slice(0, -1)) // the last due day is missed
  const rate = calculateCompletionRate(habit, completions, 30, '2026-10-30')
  assert.ok(rate > 90 && rate < 100, `expected a high but not perfect rate, got ${rate}`)
})

console.log(`ALL ${n} PASSED`)
