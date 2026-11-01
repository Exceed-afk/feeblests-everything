// Tests for the Phase 4 habit types: check, count and duration.
//
//   tsx tests/habits-types.ts
import assert from 'node:assert/strict'
import {
  addDays,
  calculateBestStreak,
  calculateCurrentStreak,
  calculateCompletionRate,
  defaultTarget,
  defaultUnit,
  getDayStatus,
  guessHabitTarget,
  guessHabitType,
  loggedValue,
  progressText,
  reachedTarget,
  stepSize
} from '../src/shared/habits'
import type { HabitCompletion } from '../src/shared/habits'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

// 2026-10-26 is a Monday.
const MON = '2026-10-26'
const TUE = '2026-10-27'
const WED = '2026-10-28'
const THU = '2026-10-29'
const SUN = '2026-11-01'

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]

// A completion with a number logged on it.
const logged = (date: string, value: number): HabitCompletion => ({ date, status: 'done', value })

// ---------- guessHabitType ----------

test('a name with a number of minutes is a duration habit', () => {
  assert.equal(guessHabitType('Read for 10mn'), 'duration')
  assert.equal(guessHabitType('Read for 30 minutes'), 'duration')
  assert.equal(guessHabitType('Meditate 15 min'), 'duration')
  assert.equal(guessHabitType('Walk for 1 hour'), 'duration')
})

test('a name with a number of times is a count habit', () => {
  assert.equal(guessHabitType('3 sessions of stretching'), 'count')
  assert.equal(guessHabitType('Drink 8 glasses of water'), 'count')
  assert.equal(guessHabitType('Read 20 pages'), 'count')
})

test('a name with no number is a plain check habit', () => {
  assert.equal(guessHabitType('November training'), 'check')
  assert.equal(guessHabitType('4 rules must obey'), 'check')
  assert.equal(guessHabitType(''), 'check')
})

// ---------- guessHabitTarget ----------

test('"Read for 10mn" becomes 10 minutes', () => {
  assert.deepEqual(guessHabitTarget('Read for 10mn'), { target: 10, unit: 'min' })
  assert.deepEqual(guessHabitTarget('Read for 30 minutes'), { target: 30, unit: 'min' })
})

test('hours are turned into minutes, so the unit is always the same', () => {
  assert.deepEqual(guessHabitTarget('Walk for 1 hour'), { target: 60, unit: 'min' })
  assert.deepEqual(guessHabitTarget('Walk for 2 hours'), { target: 120, unit: 'min' })
})

test('a count name keeps its own unit', () => {
  assert.deepEqual(guessHabitTarget('3 sessions of stretching'), { target: 3, unit: 'session' })
  assert.deepEqual(guessHabitTarget('8 glasses of water'), { target: 8, unit: 'glass' })
})

test('a name with no number has no target', () => {
  assert.deepEqual(guessHabitTarget('November training'), { target: null, unit: '' })
})

// ---------- the defaults ----------

test('each type has a sensible default target and unit', () => {
  assert.equal(defaultTarget('check'), null)
  assert.equal(defaultTarget('count'), 1)
  assert.equal(defaultTarget('duration'), 10)
  assert.equal(defaultUnit('duration'), 'min')
  assert.equal(defaultUnit('count'), 'times')
  assert.equal(defaultUnit('check'), '')
})

test('the quick buttons step by a sensible amount', () => {
  assert.equal(stepSize({ days: EVERY_DAY, type: 'duration' }), 5)
  assert.equal(stepSize({ days: EVERY_DAY, type: 'count' }), 1)
})

// ---------- reachedTarget ----------

test('a plain check habit is done as soon as it is ticked', () => {
  const habit = { days: EVERY_DAY, type: 'check' as const }
  assert.equal(reachedTarget(habit, { date: MON, status: 'done' }), true)
  assert.equal(reachedTarget(habit, undefined), false)
})

test('a duration habit is done when the target is reached', () => {
  const habit = { days: EVERY_DAY, type: 'duration' as const, target: 10 }
  assert.equal(reachedTarget(habit, logged(MON, 10)), true)
  assert.equal(reachedTarget(habit, logged(MON, 12)), true)
  assert.equal(reachedTarget(habit, logged(MON, 9)), false)
})

test('a count habit is done when the count is reached', () => {
  const habit = { days: EVERY_DAY, type: 'count' as const, target: 3 }
  assert.equal(reachedTarget(habit, logged(MON, 3)), true)
  assert.equal(reachedTarget(habit, logged(MON, 2)), false)
})

test('a skipped day is never a done day', () => {
  const habit = { days: EVERY_DAY, type: 'duration' as const, target: 10 }
  assert.equal(reachedTarget(habit, { date: MON, status: 'skipped', value: 10 }), false)
})

test('a habit with no target is done as soon as it is ticked', () => {
  const habit = { days: EVERY_DAY, type: 'duration' as const, target: null }
  assert.equal(reachedTarget(habit, logged(MON, 1)), true)
})

// ---------- loggedValue ----------

test('a day with no record has a value of zero', () => {
  assert.equal(loggedValue(undefined), 0)
  assert.equal(loggedValue({ date: MON, status: 'done' }), 0)
  assert.equal(loggedValue(logged(MON, 7)), 7)
})

// ---------- getDayStatus with a target ----------

test('a value below the target is not a done day', () => {
  const habit = { days: EVERY_DAY, startDate: MON, type: 'duration' as const, target: 10 }
  // The 27th has passed and only 6 minutes were logged, so it was missed.
  assert.equal(getDayStatus(habit, TUE, [logged(TUE, 6)], WED), 'missed')
})

test('a value that reaches the target is a done day', () => {
  const habit = { days: EVERY_DAY, startDate: MON, type: 'duration' as const, target: 10 }
  assert.equal(getDayStatus(habit, TUE, [logged(TUE, 10)], WED), 'done')
  assert.equal(getDayStatus(habit, TUE, [logged(TUE, 25)], WED), 'done')
})

test('today is still pending when the value is below the target', () => {
  const habit = { days: EVERY_DAY, startDate: MON, type: 'duration' as const, target: 10 }
  assert.equal(getDayStatus(habit, WED, [logged(WED, 4)], WED), 'pending')
})

test('a plain check habit is not affected by any of this', () => {
  const habit = { days: EVERY_DAY, startDate: MON, type: 'check' as const }
  assert.equal(getDayStatus(habit, TUE, [{ date: TUE, status: 'done' }], WED), 'done')
})

// ---------- streaks with a target ----------

test('a day below the target breaks the streak', () => {
  const habit = { days: EVERY_DAY, startDate: MON, type: 'duration' as const, target: 10 }
  const completions = [logged(MON, 10), logged(TUE, 10), logged(WED, 5), logged(THU, 10)]
  // Wednesday only got 5 of the 10 minutes, so the run ends there.
  assert.equal(calculateCurrentStreak(habit, completions, THU), 1)
})

test('reaching the target keeps the streak going', () => {
  const habit = { days: EVERY_DAY, startDate: MON, type: 'duration' as const, target: 10 }
  const completions = [logged(MON, 10), logged(TUE, 12), logged(WED, 10)]
  assert.equal(calculateCurrentStreak(habit, completions, THU), 3)
  assert.equal(calculateBestStreak(habit, completions, THU), 3)
})

test('the completion rate counts a day below the target as a miss', () => {
  const habit = { days: EVERY_DAY, startDate: MON, type: 'duration' as const, target: 10 }
  const completions = [logged(MON, 10), logged(TUE, 4)]
  // Two days have passed: Monday reached the target, Tuesday did not.
  // Two due days, only one reached the target: 50%.
  assert.equal(calculateCompletionRate(habit, completions, 30, WED), 50)
})

// ---------- progressText ----------

test('the progress text shows the value and the target', () => {
  const habit = { days: EVERY_DAY, type: 'duration' as const, target: 10, unit: 'min' }
  assert.equal(progressText(habit, logged(MON, 6)), '6 / 10 min')
  assert.equal(progressText(habit, logged(MON, 10)), '10 / 10 min')
})

test('a count habit shows its own unit', () => {
  const habit = { days: EVERY_DAY, type: 'count' as const, target: 3, unit: 'sessions' }
  assert.equal(progressText(habit, logged(MON, 2)), '2 / 3 sessions')
})

test('a plain check habit has no progress text', () => {
  const habit = { days: EVERY_DAY, type: 'check' as const }
  assert.equal(progressText(habit, { date: MON, status: 'done' }), null)
})

test('a habit with no target just shows what was logged', () => {
  const habit = { days: EVERY_DAY, type: 'duration' as const, target: null, unit: 'min' }
  assert.equal(progressText(habit, logged(MON, 7)), '7 min')
  assert.equal(progressText(habit, undefined), '0 min')
})

// ---------- a longer run with a target ----------

test('a run of days that all reach the target builds a streak', () => {
  const habit = { days: EVERY_DAY, startDate: '2026-10-26', type: 'duration' as const, target: 10 }
  const completions = []
  for (let i = 0; i < 7; i++) completions.push(logged(addDays(MON, i), 10))
  // Seven days in a row, each one reaching the 10 minute target.
  assert.equal(calculateCurrentStreak(habit, completions, SUN), 7)
  assert.equal(calculateBestStreak(habit, completions, SUN), 7)
})

console.log(`ALL ${n} PASSED`)
