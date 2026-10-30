// Checks for the intelligence data layer (src/shared/insightsData.ts). No database needed:
//   npm test
import assert from 'node:assert/strict'
import {
  buildIntelligenceData, buildRange, type IntelligenceData,
  type TradeSummary, type SavingsSummary, type HabitsSummary, type TasksSummary, type MoodSummary
} from '../src/shared/insightsData'
import { computeHabitStats } from '../src/shared/habits'
import { calcPnl } from '../src/shared/trades'
import type { Habit, LogEntry, Mood, SavingsGoal, SavingsTx, Trade, Task, TxKind } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const WEEK_START = '2026-10-19' // Monday
const WEEK_END = '2026-10-25'   // Sunday
const DONE = '2026-10-27'       // a Tuesday after that week: the week is over
const MID = '2026-10-22'        // a Thursday inside it: the week is still going
const EVERY = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS = [0, 1, 2, 3, 4]

let id = 1
const trade = (date: string, entry: number, exit: number | null, o: { dir?: 'long' | 'short'; qty?: number; fees?: number } = {}): Trade => {
  const base = { date, asset: 'XAUUSD', direction: o.dir ?? 'long', entryPrice: entry, exitPrice: exit, quantity: o.qty ?? 1, fees: o.fees ?? 0, notes: '', tags: [] as string[] }
  return { id: id++, ...base, pnl: calcPnl(base), createdAt: '', updatedAt: '' }
}
const goal = (name: string, target: number | null = null): SavingsGoal => ({ id: id++, name, target, notes: '', balance: 0, txCount: 0, createdAt: '', updatedAt: '' })
const tx = (g: SavingsGoal, date: string, kind: TxKind, amount: number): SavingsTx => ({ id: id++, goalId: g.id, date, kind, amount, note: '', createdAt: '', updatedAt: '' })
const habit = (name: string, days: number[], checkins: string[], o: { start?: string; archived?: boolean; today?: string } = {}): Habit => {
  const startDate = o.start ?? '2026-09-01'
  return { id: id++, name, notes: '', days, archived: o.archived ?? false, startDate, checkins,
    stats: computeHabitStats({ days, startDate }, checkins, o.today ?? DONE), createdAt: '', updatedAt: '' }
}
const entry = (date: string, mood: Mood | null, o: { title?: string; tags?: string[] } = {}): LogEntry =>
  ({ id: id++, date, title: o.title ?? 'A day', body: '', mood, tags: o.tags ?? [], createdAt: '', updatedAt: '' })
const task = (id_: number, createdAt: string, completedAt: string | null, dueDate: string | null = null, status: 'todo' | 'in-progress' | 'done' = 'todo'): Task => ({
  id: id_, title: `Task ${id_}`, notes: '', status, priority: 'medium', dueDate,
  createdAt, completedAt, project: null, tags: [], sortOrder: id_, recurrence: null, parentTaskId: null, subtasks: []
})

const empty = { trades: [], goals: [], txs: [], habits: [], tasks: [], entries: [] }
const week = (over: Partial<Parameters<typeof buildIntelligenceData>[0]> = {}) =>
  buildIntelligenceData({ kind: 'week', anchor: '2026-10-21', today: DONE, ...empty, ...over })

// ---- ranges ----
test('a week runs Monday to Sunday whichever day inside it you start from', () => {
  assert.deepEqual(buildRange('week', '2026-10-21'), { start: WEEK_START, end: WEEK_END })
  assert.deepEqual(buildRange('week', '2026-10-26'), { start: '2026-10-26', end: '2026-11-01' })
})
test('a month runs from the 1st to its real last day, leap years included', () => {
  assert.deepEqual(buildRange('month', '2026-10-15'), { start: '2026-10-01', end: '2026-10-31' })
  assert.deepEqual(buildRange('month', '2026-11-30'), { start: '2026-11-01', end: '2026-11-30' })
  assert.deepEqual(buildRange('month', '2027-02-10'), { start: '2027-02-01', end: '2027-02-28' })
  assert.deepEqual(buildRange('month', '2028-02-10'), { start: '2028-02-01', end: '2028-02-29' })
})

// ---- nothing at all ----
test('with no data nothing breaks and nothing is invented', () => {
  const r = week()
  assert.equal(r.trades.stats.closed, 0)
  assert.equal(r.trades.carriedOverOpen, 0)
  assert.equal(r.savings.net, 0)
  assert.deepEqual(r.savings.goals, [])
  assert.equal(r.habits.rate, null)
  assert.equal(r.mood.average, null)
  assert.equal(r.mood.trend, null)
  assert.deepEqual(r.trades.byDay, [])
  assert.equal(r.habits.byDay.length, 7)
  assert.equal(r.mood.byDay.length, 7)
  assert.deepEqual(r.tasks, { created: 0, completed: 0, dueToday: 0, overdue: 0, completedThisWeek: 0 })
})

// ---- trades ----
test('trades count on their entry date, both edges of the range included', () => {
  const t = [
    trade('2026-10-18', 100, 150), // the day before: not in this week
    trade(WEEK_START, 100, 110),   // Monday: in (+10)
    trade(WEEK_END, 100, 90),      // Sunday: in (-10)
    trade('2026-10-26', 100, 200) // the day after: not in this week
  ]
  const r = week({ trades: t })
  assert.equal(r.trades.stats.total, 2)
  assert.equal(r.trades.stats.totalPnl, 0)
  assert.equal(r.trades.stats.wins, 1)
  assert.equal(r.trades.stats.losses, 1)
})
test('open trades are counted in carriedOverOpen', () => {
  const r = week({ trades: [trade('2026-10-20', 100, null), trade('2026-10-20', 100, 120)] })
  assert.equal(r.trades.carriedOverOpen, 1)
})
test('open trades are kept out of the by-day P&L', () => {
  const r = week({ trades: [trade(WEEK_START, 100, null), trade(WEEK_START, 100, 120)] })
  assert.equal(r.trades.stats.closed, 1)
  assert.equal(r.trades.stats.totalPnl, 20)
  assert.deepEqual(r.trades.byDay, [{ date: WEEK_START, pnl: 20, closed: 1 }])
})
test('daily P&L adds up the closed trades of each day', () => {
  const r = week({ trades: [
    trade('2026-10-21', 100, 110, { fees: 1 }),
    trade('2026-10-21', 100, 90, { dir: 'short', qty: 2, fees: 0.5 }),
    trade('2026-10-23', 50, 40)
  ] })
  assert.deepEqual(r.trades.byDay, [
    { date: '2026-10-21', pnl: 9 + 19.5, closed: 2 },
    { date: '2026-10-23', pnl: -10, closed: 1 }
  ])
})
test('an open trade entered before the range and still open counts as carried over', () => {
  const r = week({ trades: [
    trade('2026-10-15', 100, null), // entered before, still open
    trade(WEEK_START, 100, 110)     // entered inside, closed
  ] })
  assert.equal(r.trades.carriedOverOpen, 1)
})

// ---- savings ----
test('savings movement is split into deposits, withdrawals and a net, only for the range', () => {
  const a = goal('Trip'), b = goal('Car')
  const txs = [
    tx(a, '2026-10-10', 'deposit', 500),   // before the week
    tx(a, WEEK_START, 'deposit', 100),
    tx(a, '2026-10-22', 'withdrawal', 30),
    tx(b, WEEK_END, 'deposit', 40),
    tx(b, '2026-10-26', 'deposit', 999)   // after the week
  ]
  const r = week({ goals: [a, b], txs })
  assert.equal(r.savings.deposits, 140)
  assert.equal(r.savings.withdrawals, 30)
  assert.equal(r.savings.net, 110)
  assert.equal(r.savings.txCount, 3)
  assert.equal(r.savings.startBalance, 500)
  assert.equal(r.savings.endBalance, 610)
})
test('each goal shows its own balance before and at the end of the range, biggest change first', () => {
  const a = goal('Trip', 1000), b = goal('Car')
  const r = week({ goals: [a, b], txs: [
    tx(a, '2026-10-01', 'deposit', 200),
    tx(a, '2026-10-20', 'deposit', 50),
    tx(b, '2026-10-21', 'deposit', 300)
  ] })
  assert.deepEqual(r.savings.goals.map((g) => [g.name, g.net, g.startBalance, g.endBalance]),
    [['Car', 300, 0, 300], ['Trip', 50, 200, 250]])
})
test('a goal with no movement in the range is left out, and the totals still include its balance', () => {
  const idle = goal('Idle'), busy = goal('Busy')
  const r = week({ goals: [idle, busy], txs: [
    tx(idle, '2026-09-01', 'deposit', 70),
    tx(busy, '2026-10-20', 'deposit', 5)
  ] })
  assert.deepEqual(r.savings.goals.map((g) => g.name), ['Busy'])
  assert.equal(r.savings.startBalance, 70)
  assert.equal(r.savings.endBalance, 75)
})
test('a goal is "reached" when this range carried it across its target', () => {
  const g = goal('Laptop', 1000)
  const crossing = week({ goals: [g], txs: [
    tx(g, '2026-10-01', 'deposit', 900),
    tx(g, '2026-10-21', 'deposit', 150)
  ] })
  assert.equal(crossing.savings.goals[0].reached, true)
  const already = week({ goals: [g], txs: [
    tx(g, '2026-10-01', 'deposit', 1000),
    tx(g, '2026-10-21', 'deposit', 5)
  ] })
  assert.equal(already.savings.goals[0].reached, false)
})
test('daysToTarget is estimated from the range net rate when moving toward the target', () => {
  const g = goal('Car', 10000)
  const r = week({ goals: [g], txs: [
    tx(g, '2026-10-01', 'deposit', 8000),
    tx(g, '2026-10-20', 'deposit', 100),
    tx(g, '2026-10-22', 'deposit', 100)
  ] })
  // end = 8200, net = 200/week, target = 10000, gap = 1800, days = 9
  assert.equal(r.savings.goals[0].daysToTarget, 9)
})
test('daysToTarget is null when the net is zero or negative', () => {
  const g = goal('Car', 1000)
  const r = week({ goals: [g], txs: [
    tx(g, '2026-10-20', 'deposit', 500),
    tx(g, '2026-10-22', 'withdrawal', 500)
  ] })
  assert.equal(r.savings.goals[0].daysToTarget, null)
})
test('daysToTarget is null when the goal has no target', () => {
  const g = goal('Pocket')
  const r = week({ goals: [g], txs: [tx(g, '2026-10-20', 'deposit', 500)] })
  assert.equal(r.savings.goals[0].daysToTarget, null)
})

// ---- habits ----
test('habit consistency counts scheduled days that have passed and were done', () => {
  const h = habit('Read', EVERY, ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-24'])
  const r = week({ habits: [h] })
  assert.equal(r.habits.due, 7)
  assert.equal(r.habits.done, 4)
  assert.equal(r.habits.rate, (4 / 7) * 100)
  assert.deepEqual(r.habits.habits[0].missed, ['2026-10-22', '2026-10-23', '2026-10-25'])
})
test('today is not missed while the range is still going', () => {
  const open = week({ today: MID, habits: [habit('Read', EVERY, ['2026-10-19', '2026-10-20', '2026-10-21'], { today: MID })] })
  assert.equal(open.habits.due, 3) // Mon-Wed; Thursday (today) is not over, Fri-Sun have not happened
  assert.equal(open.habits.done, 3)
})
test('rest days never count against you, and a check-in on one is a bonus', () => {
  const h = habit('Gym', WEEKDAYS, ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'])
  const r = week({ habits: [h] })
  assert.equal(r.habits.due, 5)
  assert.equal(r.habits.done, 5)
  assert.equal(r.habits.rate, 100)
  assert.equal(r.habits.bonus, 1)
})
test('archived habits are ignored', () => {
  const r = week({ habits: [
    habit('Old', EVERY, [], { archived: true }),
    habit('Now', EVERY, ['2026-10-19'])
  ] })
  assert.deepEqual(r.habits.habits.map((h) => h.name), ['Now'])
  assert.equal(r.habits.due, 7)
})
test('the weakest habit is listed first', () => {
  const strong = habit('Strong', EVERY, ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
  const weak = habit('Weak', EVERY, ['2026-10-19'])
  assert.deepEqual(week({ habits: [strong, weak] }).habits.habits.map((h) => h.name), ['Weak', 'Strong'])
})
test('the by-day strip adds up what was due and done on each day across habits', () => {
  const a = habit('A', EVERY, ['2026-10-19', '2026-10-20'])
  const b = habit('B', EVERY, ['2026-10-19'])
  const r = week({ habits: [a, b] })
  assert.deepEqual(r.habits.byDay[0], { date: WEEK_START, due: 2, done: 2 })
  assert.deepEqual(r.habits.byDay[1], { date: '2026-10-20', due: 2, done: 1 })
})

// ---- tasks ----
test('tasks created and completed in the range are counted', () => {
  const r = week({ tasks: [
    task(1, '2026-10-20T23:00:00-07:00', null),
    task(2, '2026-10-21T00:30:00+02:00', '2026-10-22T23:00:00-07:00', null, 'done'),
    task(3, '2026-10-26T00:00:00Z', null)
  ] })
  // week() uses today: DONE = '2026-10-27', so the week is Oct 26 - Nov 1.
  // The completed task (local date Oct 23) is NOT in that week.
  assert.deepEqual(r.tasks, { created: 2, completed: 1, dueToday: 0, overdue: 0, completedThisWeek: 0 })
})
test('due today and overdue counts use active tasks only', () => {
  const r = buildIntelligenceData({ kind: 'week', anchor: '2026-10-21', today: '2026-10-23',
    trades: [], goals: [], txs: [], habits: [], entries: [],
    tasks: [
      task(10, '2026-01-01T00:00:00Z', null, '2026-10-23', 'todo'),     // due today
      task(11, '2026-01-01T00:00:00Z', null, '2026-10-20', 'todo'),     // overdue
      task(12, '2026-01-01T00:00:00Z', '2026-10-22T00:00:00Z', '2026-10-20', 'done') // done, not active
    ]
  })
  assert.equal(r.tasks.dueToday, 1)
  assert.equal(r.tasks.overdue, 1)
})

// ---- mood ----
test('mood is averaged on a 1 to 5 scale and counted per mood', () => {
  const r = week({ entries: [
    entry('2026-10-19', 'great'),
    entry('2026-10-20', 'good'),
    entry('2026-10-21', 'okay'),
    entry('2026-10-22', 'okay'),
    entry('2026-10-23', null)
  ] })
  assert.equal(r.mood.logged, 4)
  assert.equal(r.mood.average, (5 + 4 + 3 + 3) / 4)
  assert.deepEqual(r.mood.counts, { great: 1, good: 1, okay: 2, low: 0, rough: 0 })
})
test('two entries on one day give that day one average', () => {
  const r = week({ entries: [
    entry('2026-10-20', 'great'),
    entry('2026-10-20', 'okay')
  ] })
  assert.equal(r.mood.byDay[1].average, 4)
  assert.equal(r.mood.byDay[0].average, null)
})
test('entries outside the range do not count', () => {
  const r = week({ entries: [
    entry('2026-10-18', 'rough'),
    entry('2026-10-12', 'low'),
    entry('2026-10-26', 'rough'),
    entry('2026-10-20', 'good')
  ] })
  assert.equal(r.mood.average, 4)
})
test('the trend compares the second half of the range with the first, and needs four days', () => {
  const up = week({ entries: [
    entry('2026-10-19', 'low'),
    entry('2026-10-20', 'low'),
    entry('2026-10-23', 'good'),
    entry('2026-10-24', 'great')
  ] })
  assert.equal(up.mood.trend, 'up')
  const thin = week({ entries: [
    entry('2026-10-19', 'low'),
    entry('2026-10-20', 'low'),
    entry('2026-10-23', 'great')
  ] })
  assert.equal(thin.mood.trend, null)
})
test('a lowest day is named only when it was low or rough', () => {
  assert.deepEqual(week({ entries: [
    entry('2026-10-21', 'low'),
    entry('2026-10-22', 'rough'),
    entry('2026-10-23', 'good')
  ] }).mood.lowest, { date: '2026-10-22', mood: 'rough' })
  assert.equal(week({ entries: [
    entry('2026-10-21', 'okay'),
    entry('2026-10-22', 'good')
  ] }).mood.lowest, null)
})

// ---- the whole snapshot ----
test('buildIntelligenceData returns a properly shaped snapshot', () => {
  const r = week({
    trades: [trade(WEEK_START, 100, 110)],
    goals: [goal('Trip')],
    txs: [tx(goal('Trip', 1000), '2026-10-20', 'deposit', 100)],
    habits: [habit('Read', EVERY, ['2026-10-19'])],
    tasks: [task(20, '2026-10-20T00:00:00Z', null)],
    entries: [entry('2026-10-19', 'good')]
  })
  assert.equal(r.kind, 'week')
  assert.equal(r.start, WEEK_START)
  assert.equal(r.end, WEEK_END)
  assert.ok('trades' in r && 'savings' in r && 'habits' in r && 'tasks' in r && 'mood' in r)
})

console.log(`\n${n} insightsData checks passed`)
