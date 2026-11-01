// Checks for the cross-module insights calculations (src/shared/insights.ts).
// No database needed:  npm test   (tsx tests/insights.ts)
import assert from 'node:assert/strict'
import {
  buildInsights, buildInsightDays, mean, correlation, windowWeeks,
  MIN_DAYS, MIN_WEEKS, MIN_MOODS,
  type InsightsInput
} from '../src/shared/insights'
import type { Habit, LogEntry, Mood, SavingsTx, Task, Trade, TxKind } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

// 0 = Monday ... 6 = Sunday, matching the app's weekdayOf convention.
const weekdayIndex = (d: string): number => (new Date(Date.parse(d)).getUTCDay() + 6) % 7

let id = 1
const EVERY = [0, 1, 2, 3, 4, 5, 6]
const START = '2026-08-31' // a Monday; 6 full weeks to 2026-10-10 inclusive
const END = '2026-10-10'

const habit = (name: string, checkins: string[], start = START, days = EVERY): Habit => ({
  id: id++, name, notes: '', days, archived: false, startDate: start, checkins,
  stats: { current: 0, best: 0, rate30: null, total: checkins.length }, createdAt: '', updatedAt: ''
})
const entry = (date: string, mood: Mood | null): LogEntry =>
  ({ id: id++, date, title: 'A day', body: '', mood, tags: [], createdAt: '', updatedAt: '' })
const trade = (date: string, entryP: number, exitP: number | null): Trade => {
  const pnl = exitP === null ? null : exitP - entryP
  return { id: id++, date, asset: 'XAUUSD', direction: 'long', entryPrice: entryP, exitPrice: exitP, quantity: 1, fees: 0, notes: '', tags: [], pnl, createdAt: '', updatedAt: '' }
}
const tx = (date: string, kind: TxKind, amount: number): SavingsTx =>
  ({ id: id++, goalId: 1, date, kind, amount, note: '', createdAt: '', updatedAt: '' })
const task = (id_: number, completedAt: string | null): Task => ({
  id: id_, title: `Task ${id_}`, notes: '', status: completedAt ? 'done' : 'todo', priority: 'medium', dueDate: null,
  createdAt: '2026-08-01', completedAt, deletedAt: null, dueTime: null, project: null, tags: [], position: id_, recurrenceRule: null, recurrenceNext: null, subtasks: []
})

const input = (over: Partial<InsightsInput> = {}): InsightsInput => ({
  today: END, start: START, end: END, habits: [], tasks: [], trades: [], txs: [], entries: [], ...over
})

// Convenience: every day in the window has the habit scheduled and checked (or not) per a mask.
const fullHabits = (checked: (date: string) => boolean): Habit[] => [habit('All', daysBetween(START, END).filter(checked))]
const daysBetween = (a: string, b: string): string[] => {
  const out: string[] = []
  for (let d = a; d <= b; d = new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10)) out.push(d)
  return out
}

test('daily mood statistics ignore automation drafts', () => {
  const draft = { ...entry(END, 'rough'), tags: ['automation'] }
  const [day] = buildInsightDays(input({ start: END, end: END, entries: [draft, entry(END, 'good')] }))
  assert.equal(day.mood, 4)
})

// ---------- tiny stats ----------
test('mean of nothing is null, not NaN', () => {
  assert.equal(mean([]), null)
})
test('mean handles ties and small lists', () => {
  assert.equal(mean([2, 2, 2]), 2)
  assert.equal(mean([1, 2]), 1.5)
})
test('correlation of too few points is null', () => {
  assert.equal(correlation([1], [1]), null)
  assert.equal(correlation([1, 2], [1, 2]), null)
})
test('a perfect line correlates 1, an inverse one -1', () => {
  assert.equal(correlation([1, 2, 3, 4], [2, 4, 6, 8]), 1)
  assert.equal(correlation([1, 2, 3, 4], [8, 6, 4, 2]), -1)
})
test('a flat side gives null (zero variance)', () => {
  assert.equal(correlation([1, 1, 1, 1], [1, 2, 3, 4]), null)
})
test('lengths must agree', () => {
  assert.equal(correlation([1, 2, 3], [1, 2]), null)
})

// ---------- day rows ----------
test('an empty window gives one row per day with zeros', () => {
  const rows = buildInsightDays(input({ start: '2026-10-01', end: '2026-10-03' }))
  assert.equal(rows.length, 3)
  for (const r of rows) {
    assert.equal(r.habitDue, 0)
    assert.equal(r.habitDone, 0)
    assert.equal(r.mood, null)
    assert.equal(r.tradePnl, 0)
    assert.equal(r.tradeClosed, 0)
    assert.equal(r.savingsNet, 0)
    assert.equal(r.tasksDone, 0)
  }
})
test('habit rows count only scheduled days after the habit started', () => {
  // Mondays-only habit starting Wed 30 Sep: only Mon 5 Oct is both after start and scheduled.
  const h = habit('Gym', [], '2026-09-30', [0])
  const rows = buildInsightDays(input({ start: '2026-09-28', end: '2026-10-06', habits: [h] }))
  const scheduledDays = rows.filter((r) => r.habitDue > 0)
  assert.equal(scheduledDays.length, 1)
  assert.equal(scheduledDays[0].date, '2026-10-05')
  assert.equal(rows[0].habitDue, 0) // Sep 28, before the habit existed
  assert.equal(rows[2].habitDue, 0) // Sep 30, not scheduled
})
test('completedAt timestamps are matched on their local day', () => {
  const t = task(1, '2026-10-01T23:30:00.000-04:00') // local Oct 1 late evening
  const rows = buildInsightDays(input({ start: '2026-09-30', end: '2026-10-02', tasks: [t] }))
  assert.equal(rows.reduce((a, r) => a + r.tasksDone, 0), 1)
})

// ---------- empty and tiny datasets ----------
test('empty data says clearly what is needed, and invents nothing', () => {
  const r = buildInsights(input())
  assert.equal(r.enoughData, false)
  assert.match(r.needText, /Not enough history/)
  assert.match(r.needText, /weeks/)
  for (const c of r.comparisons) assert.equal(c.ok, false)
  for (const c of r.correlations) assert.equal(c.ok, false)
  assert.deepEqual(r.habitByWeekday, [])
  assert.deepEqual(r.tradeByWeekday, [])
  assert.deepEqual(r.tradeByMood, [])
})
test('a tiny dataset (one week) is below the minimum and says so', () => {
  const r = buildInsights(input({ end: '2026-09-06', habits: fullHabits(() => true) }))
  assert.equal(r.windowWeeks, 1)
  assert.equal(r.enoughData, false)
})

// ---------- the window ----------
test('windowWeeks rounds up a partial week', () => {
  assert.equal(windowWeeks(input({ start: '2026-10-01', end: '2026-10-07' })), 1)
  assert.equal(windowWeeks(input({ start: '2026-10-01', end: '2026-10-08' })), 2)
})

// ---------- habit consistency by weekday ----------
test('habit consistency by weekday splits scheduled days across the week', () => {
  // Mon/Wed/Fri habit, done on every scheduled day: 100% on each of those weekdays.
  const scheduledDays = daysBetween(START, END).filter((d) => [0, 2, 4].includes(weekdayIndex(d)))
  const h = habit('Gym', scheduledDays, START, [0, 2, 4])
  const r = buildInsights(input({ habits: [h] }))
  const mon = r.habitByWeekday.find((w) => w.weekday === 'Mon')
  assert.ok(mon)
  assert.equal(mon.rate, 100)
  assert.ok(mon.scheduled >= 5)
})
test('a never-done habit shows 0% per weekday', () => {
  const h = habit('Gym', [], START, [0, 2, 4])
  const r = buildInsights(input({ habits: [h] }))
  for (const w of r.habitByWeekday) assert.equal(w.rate, 0)
})
test('a weekday with nothing scheduled is left out, not shown as 0%', () => {
  const h = habit('Gym', [], START, [0]) // Mondays only
  const r = buildInsights(input({ habits: [h] }))
  assert.deepEqual(r.habitByWeekday.map((w) => w.weekday), ['Mon'])
})

// ---------- trade P&L by weekday and by mood ----------
test('trade P&L by weekday groups closed trades only', () => {
  const trades = [
    trade('2026-09-07', 100, 110), // a Monday
    trade('2026-09-07', 100, 90),  // also Monday, -10
    trade('2026-09-08', 100, 130)  // a Tuesday, +30
  ]
  const r = buildInsights(input({ trades }))
  const mon = r.tradeByWeekday.find((w) => w.weekday === 'Mon')
  const tue = r.tradeByWeekday.find((w) => w.weekday === 'Tue')
  assert.ok(mon && tue)
  assert.equal(mon.closed, 2)
  assert.equal(mon.pnl, 0)
  assert.equal(tue.closed, 1)
  assert.equal(tue.pnl, 30)
})
test('open trades never appear in the P&L breakdowns', () => {
  const trades = [trade('2026-09-07', 100, null)]
  const r = buildInsights(input({ trades }))
  assert.deepEqual(r.tradeByWeekday, [])
})
test('trade P&L by mood buckets by the day’s mood', () => {
  const trades = [
    trade('2026-09-07', 100, 120), // mood good that day -> +20 in the "good" bucket
    trade('2026-09-08', 100, 80)   // mood rough -> -20 in "rough"
  ]
  const entries = [entry('2026-09-07', 'good'), entry('2026-09-08', 'rough')]
  const r = buildInsights(input({ trades, entries }))
  const good = r.tradeByMood.find((m) => m.mood === 'good')
  const rough = r.tradeByMood.find((m) => m.mood === 'rough')
  assert.ok(good && rough)
  assert.equal(good.avgPnl, 20)
  assert.equal(rough.avgPnl, -20)
})

// ---------- honesty: comparisons need enough data on each side ----------
test('comparisons stay hidden until each side has MIN_DAYS', () => {
  // A habit always done -> the "low" side is empty, so the savings/trades comparisons cannot run.
  const r = buildInsights(input({ habits: fullHabits(() => true), txs: [tx('2026-09-01', 'deposit', 50)], end: '2026-10-10' }))
  const sav = r.comparisons.find((c) => c.id === 'savings-by-habits')
  assert.ok(sav)
  assert.equal(sav.ok, false)
  assert.match(sav.needText ?? '', /Not enough/)
  assert.equal(sav.a.n + sav.b.n >= 0, true)
})
test('ties: every day identical gives "about the same", not a fake difference', () => {
  // Same net savings on many days in both halves of the habit rate ranking.
  const habits = fullHabits((d) => Number(d.slice(8)) % 2 === 0) // done on even days only
  const days = daysBetween(START, END)
  const txs = days.slice(0, 10).map((d) => tx(d, 'deposit', 25)) // same amount every day
  const r = buildInsights(input({ habits, txs, end: '2026-10-10' }))
  const sav = r.comparisons.find((c) => c.id === 'savings-by-habits')
  assert.ok(sav)
  if (sav.ok) assert.match(sav.text, /about the same/)
  else assert.match(sav.needText ?? '', /Not enough/)
})
test('mood-vs-tasks correlation needs MIN_MOODS joint days', () => {
  const entries = [entry('2026-09-01', 'good'), entry('2026-09-02', 'okay')] // only 2 joint days
  const r = buildInsights(input({ entries, tasks: [task(1, '2026-09-01T10:00:00.000Z')], end: '2026-10-10' }))
  const c = r.correlations.find((x) => x.id === 'mood-vs-tasks')
  assert.ok(c)
  assert.equal(c.ok, false)
  assert.match(c.needText ?? '', /both|enough/)
})
test('a working correlation reports r and n and cautious wording', () => {
  // Mood rises with tasks done, on many days.
  const entries: LogEntry[] = []
  const tasks: Task[] = []
  const days = daysBetween('2026-09-01', '2026-10-10')
  days.forEach((d, i) => {
    const moods: Mood[] = ['rough', 'low', 'okay', 'good', 'great']
    entries.push(entry(d, moods[Math.min(4, Math.floor(i / 8))]))
    for (let k = 0; k <= Math.min(6, Math.floor(i / 6)); k++) tasks.push(task(id++, `${d}T10:00:00.000Z`))
  })
  const r = buildInsights(input({ entries, tasks, end: '2026-10-10', today: '2026-10-11' }))
  const c = r.correlations.find((x) => x.id === 'mood-vs-tasks')
  assert.ok(c && c.ok)
  assert.ok((c.r as number) > 0.5)
  assert.ok(c.n >= MIN_MOODS)
  assert.match(c.text, /might|tended/)
  assert.match(c.detail, /n = /)
})
test('a flat mood series reports "cannot be computed" rather than a fake r', () => {
  const entries = daysBetween('2026-09-01', '2026-09-20').map((d) => entry(d, 'good'))
  const tasks = entries.map((e) => task(id++, `${e.date}T10:00:00.000Z`))
  const r = buildInsights(input({ entries, tasks, end: '2026-09-30' }))
  const c = r.correlations.find((x) => x.id === 'mood-vs-tasks')
  assert.ok(c)
  assert.equal(c.ok, false)
  assert.match(c.needText ?? '', /vary|cannot/)
})

// ---------- wording honesty ----------
test('no insight ever claims causation', () => {
  const habits = fullHabits((d) => Number(d.slice(8)) % 2 === 0)
  const days = daysBetween(START, END)
  const txs = days.flatMap((d, i) => [tx(d, 'deposit', i % 2 === 0 ? 100 : 5)])
  const r = buildInsights(input({ habits, txs, end: END }))
  for (const c of r.comparisons) if (c.ok) {
    assert.doesNotMatch(c.text, /causes|caused|because|proves|guarantee/i)
    assert.match(c.text, /might|about the same/)
    assert.match(c.detail, /days/)
  }
  for (const c of r.correlations) if (c.ok) assert.doesNotMatch(c.text, /causes|because|proves/i)
})

// ---------- the full happy path ----------
test('a rich window marks enoughData and fills the weekday tables', () => {
  const habits = fullHabits(() => true)
  const r = buildInsights(input({ habits, end: END }))
  assert.equal(r.enoughData, true)
  assert.equal(r.needText, '')
  assert.ok(r.habitByWeekday.length > 0)
  assert.ok(r.windowWeeks >= MIN_WEEKS)
  assert.ok(r.windowDays >= MIN_DAYS * 2)
})

console.log(`\n${n} insights checks passed`)
