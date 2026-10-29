// Checks for the habit rules. Needs no database, so it runs anywhere:
//   npm test
import assert from 'node:assert/strict'
import { addDays, computeHabitStats, isScheduled, scheduleLabel, weekdayOf } from '../src/shared/habits'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

// 2026-10-26 is a Monday. All dates below are real calendar days around it.
const MON = '2026-10-26'
const everyDay = [0, 1, 2, 3, 4, 5, 6]
const weekdays = [0, 1, 2, 3, 4]
const stats = (days: number[], start: string, checkins: string[], today = MON) =>
  computeHabitStats({ days, startDate: start }, checkins, today)

test('weekdays are numbered Monday = 0 ... Sunday = 6', () => {
  assert.equal(weekdayOf('2026-10-26'), 0)
  assert.equal(weekdayOf('2026-10-25'), 6)
  assert.equal(weekdayOf('2026-10-31'), 5)
})
test('date arithmetic crosses months, years and leap days', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2027-01-01', -1), '2026-12-31')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
  assert.equal(addDays('2026-10-26', -30), '2026-09-26')
})
test('isScheduled follows the chosen weekdays', () => {
  assert.equal(isScheduled(weekdays, '2026-10-26'), true) // Monday
  assert.equal(isScheduled(weekdays, '2026-10-25'), false) // Sunday
})
test('schedule labels read naturally', () => {
  assert.equal(scheduleLabel(everyDay), 'Every day')
  assert.equal(scheduleLabel(weekdays), 'Weekdays')
  assert.equal(scheduleLabel([6, 5]), 'Weekends')
  assert.equal(scheduleLabel([4, 0, 2]), 'Mon, Wed, Fri')
})

test('a brand new habit has no streak and no rate yet', () => {
  assert.deepEqual(stats(everyDay, MON, []), { current: 0, best: 0, rate30: null, total: 0 })
})
test('consecutive days ending today build the streak', () => {
  const s = stats(everyDay, '2026-10-24', ['2026-10-24', '2026-10-25', MON])
  assert.equal(s.current, 3)
  assert.equal(s.best, 3)
})
test("today not checked yet does NOT break the streak (the day isn't over)", () => {
  const s = stats(everyDay, '2026-10-24', ['2026-10-24', '2026-10-25'])
  assert.equal(s.current, 2)
})
test('a missed day before today breaks it', () => {
  const s = stats(everyDay, '2026-10-23', ['2026-10-23', MON]) // missed the 24th and 25th
  assert.equal(s.current, 1)
  assert.equal(s.best, 1)
})
test('best streak remembers an earlier, longer run', () => {
  const s = stats(everyDay, '2026-10-17', ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', MON])
  assert.equal(s.best, 4)
  assert.equal(s.current, 1)
})
test('rest days never break a streak: Mon-Fri habit, done Fri then Mon', () => {
  // Start Tue 20th. Tue-Thu missed, so the run restarts on Fri 23rd. Sat/Sun are rest days. Mon is today.
  const s = stats(weekdays, '2026-10-20', ['2026-10-23', MON])
  assert.equal(s.current, 2)
  assert.equal(s.best, 2)
})
test('a check-in on a rest day is a bonus: it counts in the total only', () => {
  const s = stats(weekdays, '2026-10-23', ['2026-10-23', '2026-10-25', MON]) // Sunday 25th is a rest day
  assert.equal(s.current, 2)
  assert.equal(s.total, 3)
})
test('days before the habit existed are not counted as missed', () => {
  const s = stats(everyDay, MON, [MON])
  assert.equal(s.current, 1)
  assert.equal(s.rate30, 100)
})
test('checking a day before the start date moves the start back', () => {
  const s = stats(everyDay, MON, ['2026-10-24'])
  assert.equal(s.best, 1)
  assert.equal(s.total, 1)
})
test('30-day rate: 15 of the last 30 days done is 50%', () => {
  const done = Array.from({ length: 15 }, (_, i) => addDays(MON, -i)) // Oct 12 to Oct 26
  assert.equal(stats(everyDay, '2026-09-01', done).rate30, 50)
})
test('30-day rate ignores a pending today, but counts a done one', () => {
  const yesterdayOnly = stats(everyDay, '2026-10-25', ['2026-10-25']) // today unchecked: 1 due, 1 done
  assert.equal(yesterdayOnly.rate30, 100)
})
test('a very old habit is handled without trouble', () => {
  const s = stats(everyDay, '2000-01-01', [MON])
  assert.equal(s.current, 1)
})

console.log(`ALL ${n} PASSED`)
