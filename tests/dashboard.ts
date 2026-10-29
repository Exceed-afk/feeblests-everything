// Checks for the dashboard's "Habits today" tile and the log streak. No database needed:
//   npm test
import assert from 'node:assert/strict'
import { habitsToday, logStreak, prevDay } from '../src/shared/dashboard'
import { computeHabitStats } from '../src/shared/habits'
import type { Habit } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const MON = '2026-10-26' // a Monday
const SUN = '2026-10-25'
let id = 1
const habit = (name: string, days: number[], checkins: string[], today = MON, archived = false): Habit => ({
  id: id++, name, notes: '', days, archived, startDate: '2026-09-01', checkins,
  stats: computeHabitStats({ days, startDate: '2026-09-01' }, checkins, today), createdAt: '', updatedAt: ''
})
const EVERY = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS = [0, 1, 2, 3, 4]

test('no habits gives an empty tile', () => {
  assert.deepEqual(habitsToday([], MON), { total: 0, due: 0, done: 0, longestStreak: 0, items: [] })
})
test('counts what is scheduled today and what is done', () => {
  const t = habitsToday([habit('Read', EVERY, [MON]), habit('Walk', EVERY, [])], MON)
  assert.equal(t.due, 2)
  assert.equal(t.done, 1)
  assert.equal(t.total, 2)
})
test('unfinished habits are listed first', () => {
  const t = habitsToday([habit('Done one', EVERY, [MON]), habit('Todo one', EVERY, [])], MON)
  assert.deepEqual(t.items.map((i) => [i.name, i.done]), [['Todo one', false], ['Done one', true]])
})
test('a habit not scheduled today is not listed or due, but still counts in total', () => {
  const t = habitsToday([habit('Gym', WEEKDAYS, [], SUN, false)], SUN)
  assert.equal(t.due, 0)
  assert.equal(t.items.length, 0)
  assert.equal(t.total, 1)
})
test('archived habits are ignored completely', () => {
  const t = habitsToday([habit('Old', EVERY, [MON], MON, true), habit('New', EVERY, [])], MON)
  assert.equal(t.total, 1)
  assert.equal(t.due, 1)
  assert.equal(t.done, 0)
  assert.deepEqual(t.items.map((i) => i.name), ['New'])
})
test('the longest streak is the best CURRENT streak among active habits', () => {
  const three = ['2026-10-24', SUN, MON]
  const t = habitsToday([habit('A', EVERY, three), habit('B', EVERY, [MON]), habit('Old', EVERY, ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', SUN, MON], MON, true)], MON)
  assert.equal(t.longestStreak, 3) // the archived habit's 7 does not count
})
test('a rest day does not break a streak shown on the tile', () => {
  // Weekdays only: Thu, Fri done, then the weekend rests. On Sunday the streak is still 2.
  const h = habit('Gym', WEEKDAYS, ['2026-10-22', '2026-10-23'], SUN)
  assert.equal(habitsToday([h], SUN).longestStreak, 2)
})
test('an unchecked habit today does not zero its streak (the day is not over)', () => {
  const h = habit('Read', EVERY, ['2026-10-24', SUN])
  const t = habitsToday([h], MON)
  assert.equal(t.longestStreak, 2)
  assert.equal(t.items[0].streak, 2)
  assert.equal(t.done, 0)
})

test('log streak counts back from yesterday when today is still empty', () => {
  assert.equal(logStreak(['2026-10-24', SUN], MON), 2)
  assert.equal(logStreak(['2026-10-24', SUN, MON], MON), 3)
  assert.equal(logStreak(['2026-10-20'], MON), 0)
})
test('prevDay crosses month and leap-year boundaries', () => {
  assert.equal(prevDay('2026-03-01'), '2026-02-28')
  assert.equal(prevDay('2028-03-01'), '2028-02-29')
  assert.equal(prevDay('2027-01-01'), '2026-12-31')
})

console.log(`\n${n} dashboard checks passed`)
