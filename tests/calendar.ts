// Checks for the calendar (src/shared/calendar.ts). No database needed:
//   npm test
import assert from 'node:assert/strict'
import { buildCalendar, describeDay, dayName, gridRange, isMonth, monthLabel, monthRange, moodFromAverage, shiftMonth } from '../src/shared/calendar'
import { computeHabitStats } from '../src/shared/habits'
import { calcPnl, computeStats } from '../src/shared/trades'
import type { Habit, LogEntry, Mood, SavingsTxHit, Trade, TxKind } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

// ---- builders ----
const TODAY = '2026-10-27' // a Tuesday
const EVERY = [0, 1, 2, 3, 4, 5, 6]
let id = 1
const trade = (date: string, entry: number, exit: number | null, fees = 0): Trade => {
  const b = { date, asset: 'XAUUSD', direction: 'long' as const, entryPrice: entry, exitPrice: exit, quantity: 1, fees, notes: '', tags: [] as string[] }
  return { id: id++, ...b, pnl: calcPnl(b), createdAt: '', updatedAt: '' }
}
const tx = (date: string, kind: TxKind, amount: number, goalId = 1): SavingsTxHit =>
  ({ id: id++, goalId, date, kind, amount, note: '', createdAt: '', updatedAt: '', goalName: 'Laptop' })
const entry = (date: string, mood: Mood | null = null, title = 'A day'): LogEntry =>
  ({ id: id++, date, title, body: '', mood, tags: [], createdAt: '', updatedAt: '' })
const habit = (name: string, days: number[], checkins: string[], o: { start?: string; archived?: boolean } = {}): Habit => {
  const startDate = o.start ?? '2026-09-01'
  return { id: id++, name, notes: '', days, archived: o.archived ?? false, startDate, checkins,
    stats: computeHabitStats({ days, startDate }, checkins, TODAY), createdAt: '', updatedAt: '' }
}
const empty = { entries: [], trades: [], txs: [], habits: [] }
const cal = (over: Partial<Parameters<typeof buildCalendar>[0]> = {}) => buildCalendar({ month: '2026-10', today: TODAY, ...empty, ...over })
const day = (c: ReturnType<typeof cal>, date: string) => c.weeks.flat().find((d) => d.date === date)!

// ---- months ----
test('a month string is exactly YYYY-MM', () => {
  for (const ok of ['2026-10', '2026-01', '2026-12']) assert.equal(isMonth(ok), true)
  for (const bad of ['2026-13', '2026-00', '2026-1', '26-10', '2026-10-01', '', null, undefined, 202610]) assert.equal(isMonth(bad), false)
})
test('months step forward and back across the new year', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01')
  assert.equal(shiftMonth('2027-01', -1), '2026-12')
  assert.equal(shiftMonth('2026-03', -13), '2025-02')
  assert.equal(shiftMonth('2026-10', 0), '2026-10')
  assert.equal(shiftMonth('2026-01', 25), '2028-02')
})
test('a month runs from the 1st to its real last day, leap years included', () => {
  assert.deepEqual(monthRange('2026-10'), { first: '2026-10-01', last: '2026-10-31' })
  assert.deepEqual(monthRange('2026-11'), { first: '2026-11-01', last: '2026-11-30' })
  assert.deepEqual(monthRange('2027-02'), { first: '2027-02-01', last: '2027-02-28' })
  assert.deepEqual(monthRange('2028-02'), { first: '2028-02-01', last: '2028-02-29' })
  assert.deepEqual(monthRange('2026-12'), { first: '2026-12-01', last: '2026-12-31' })
})
test('the grid starts on the Monday on or before the 1st and ends on the Sunday on or after the last day', () => {
  assert.deepEqual(gridRange('2026-10'), { start: '2026-09-28', end: '2026-11-01' }) // 1 Oct 2026 is a Thursday
  assert.deepEqual(gridRange('2027-02'), { start: '2027-02-01', end: '2027-02-28' }) // starts on a Monday, ends on a Sunday: exactly 4 weeks
  assert.deepEqual(gridRange('2026-08'), { start: '2026-07-27', end: '2026-09-06' }) // a 6-row month
  assert.deepEqual(gridRange('2026-12'), { start: '2026-11-30', end: '2027-01-03' }) // reaches into the next year
})
test('labels are fixed text', () => {
  assert.equal(monthLabel('2026-10'), 'October 2026')
  assert.equal(dayName('2026-10-27'), 'Tue 27 Oct')
  assert.equal(dayName('2027-01-01'), 'Fri 1 Jan')
})
test('every month for 6 years makes whole Monday-to-Sunday rows of 4 to 6 weeks that contain the month (864 checks)', () => {
  for (let y = 2024; y <= 2029; y++) for (let m = 1; m <= 12; m++) {
    const month = `${y}-${String(m).padStart(2, '0')}`
    const c = cal({ month })
    const flat = c.weeks.flat()
    assert.ok(c.weeks.length >= 4 && c.weeks.length <= 6, month)
    assert.ok(c.weeks.every((w) => w.length === 7), month)
    assert.equal(flat.filter((d) => d.inMonth).length, Number(monthRange(month).last.slice(8)), month)
    assert.equal(new Date(flat[0].date + 'T00:00:00Z').getUTCDay(), 1, `${month} starts on a Monday`)
    assert.equal(new Date(flat[flat.length - 1].date + 'T00:00:00Z').getUTCDay(), 0, `${month} ends on a Sunday`)
    for (let k = 1; k < flat.length; k++) assert.ok(flat[k].date > flat[k - 1].date, `${month} in order`)
  }
})

// ---- empty ----
test('an empty month is a full grid with nothing on it, and today is marked', () => {
  const c = cal()
  assert.equal(c.weeks.length, 5)
  assert.equal(c.label, 'October 2026')
  assert.equal(c.prevMonth, '2026-09'); assert.equal(c.nextMonth, '2026-11')
  assert.deepEqual(c.summary, { entries: 0, daysWritten: 0, closed: 0, open: 0, pnl: 0, savingsNet: 0, habitRate: null, moodAverage: null })
  const t = day(c, TODAY)
  assert.equal(t.isToday, true); assert.equal(c.weeks.flat().filter((d) => d.isToday).length, 1)
  assert.equal(day(c, '2026-10-26').isFuture, false); assert.equal(day(c, '2026-10-28').isFuture, true)
  assert.equal(day(c, '2026-09-30').inMonth, false); assert.equal(day(c, '2026-11-01').inMonth, false); assert.equal(day(c, '2026-10-01').inMonth, true)
  assert.equal(describeDay(t), 'Tue 27 Oct (today): nothing logged')
})
test('today outside the shown month marks no day', () => {
  assert.equal(cal({ month: '2026-03' }).weeks.flat().some((d) => d.isToday), false)
})

// ---- entries and mood ----
test('entries sit on their own day, newest first, and the greyed days of the next month show theirs too', () => {
  const a = entry('2026-10-20', null, 'first'), b = entry('2026-10-20', null, 'second'), edge = entry('2026-11-01'), other = entry('2026-12-15')
  const c = cal({ entries: [a, b, edge, other] })
  assert.deepEqual(day(c, '2026-10-20').entries.map((e) => e.title), ['second', 'first'])
  assert.equal(day(c, '2026-11-01').entries.length, 1)
  assert.equal(c.weeks.flat().reduce((s, d) => s + d.entries.length, 0), 3, 'December is not on this grid')
  assert.equal(c.summary.entries, 2, 'the summary counts only the month itself')
  assert.equal(c.summary.daysWritten, 1)
})
test('the day mood is the average of its entries as the nearest word', () => {
  const c = cal({ entries: [entry('2026-10-20', 'great'), entry('2026-10-20', 'okay'), entry('2026-10-21', 'rough'), entry('2026-10-22', null)] })
  assert.equal(day(c, '2026-10-20').moodAverage, 4); assert.equal(day(c, '2026-10-20').mood, 'good')
  assert.equal(day(c, '2026-10-21').mood, 'rough')
  assert.equal(day(c, '2026-10-22').mood, null); assert.equal(day(c, '2026-10-22').moodAverage, null)
  assert.equal(c.summary.moodAverage, (5 + 3 + 1) / 3)
  assert.deepEqual([5, 4, 3, 2, 1, 4.4, 3.5, 1.2].map(moodFromAverage), ['great', 'good', 'okay', 'low', 'rough', 'good', 'good', 'rough'])
})
test('automation drafts remain visible but are excluded from written totals and moods', () => {
  const draft = { ...entry('2026-10-20', 'rough'), tags: ['automation'] }
  const c = cal({ entries: [draft, entry('2026-10-20', 'good')] })
  assert.equal(day(c, '2026-10-20').entries.length, 2)
  assert.equal(day(c, '2026-10-20').moodAverage, 4)
  assert.deepEqual([c.summary.entries, c.summary.daysWritten, c.summary.moodAverage], [1, 1, 4])
})

// ---- trades ----
test('trades sit on their entry date; open ones are counted but kept out of P&L', () => {
  const c = cal({ trades: [trade('2026-10-20', 100, 130, 1), trade('2026-10-20', 100, 90), trade('2026-10-20', 100, null), trade('2026-10-21', 50, 60)] })
  const d = day(c, '2026-10-20')
  assert.equal(d.trades.length, 3); assert.equal(d.closed, 2); assert.equal(d.open, 1)
  assert.equal(d.pnl, 29 - 10)
  assert.equal(day(c, '2026-10-21').pnl, 10)
  assert.deepEqual([c.summary.closed, c.summary.open, c.summary.pnl], [3, 1, 29])
})
test('the sum of every day P&L on the grid equals the trade statistics of the same trades (300 random cases)', () => {
  let seed = 3
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  for (let run = 0; run < 300; run++) {
    const trades: Trade[] = []
    for (let k = 0; k < Math.floor(rnd() * 12); k++) {
      const day = `2026-${rnd() < 0.5 ? '09' : '10'}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`
      trades.push(trade(day, 100, rnd() < 0.2 ? null : Math.round((50 + rnd() * 100) * 100) / 100, Math.round(rnd() * 300) / 100))
    }
    const c = cal({ trades })
    const onGrid = trades.filter((t) => t.date >= '2026-09-28' && t.date <= '2026-11-01')
    const total = c.weeks.flat().reduce((s, d) => s + d.pnl, 0)
    assert.ok(Math.abs(total - computeStats(onGrid).totalPnl) < 1e-6, `run ${run}`)
    assert.equal(c.weeks.flat().reduce((s, d) => s + d.trades.length, 0), onGrid.length, `run ${run}: count`)
  }
})

// ---- savings ----
test('savings movement on a day is deposits minus withdrawals, with every transaction listed', () => {
  const c = cal({ txs: [tx('2026-10-15', 'deposit', 100), tx('2026-10-15', 'withdrawal', 30), tx('2026-10-16', 'withdrawal', 5), tx('2026-12-01', 'deposit', 999)] })
  assert.equal(day(c, '2026-10-15').savingsNet, 70); assert.equal(day(c, '2026-10-15').txs.length, 2)
  assert.equal(day(c, '2026-10-16').savingsNet, -5)
  assert.equal(c.summary.savingsNet, 65)
})

// ---- habits ----
test('habits show done, missed and (today only) pending, and nothing in the future', () => {
  const read = habit('Read', EVERY, ['2026-10-25', '2026-10-26'])
  const c = cal({ habits: [read] })
  assert.deepEqual(day(c, '2026-10-26').habits.items, [{ id: read.id, name: 'Read', status: 'done' }])
  assert.deepEqual(day(c, '2026-10-24').habits.items.map((i) => i.status), ['missed'])
  assert.deepEqual(day(c, TODAY).habits.items.map((i) => i.status), ['pending'])
  assert.deepEqual(day(c, '2026-10-28').habits.items, [])
  assert.deepEqual(day(c, TODAY).habits, { done: 0, missed: 0, pending: 1, bonus: 0, items: [{ id: read.id, name: 'Read', status: 'pending' }] })
})
test('today counts as done once it is checked, and the monthly rate leaves pending days out', () => {
  const read = habit('Read', EVERY, ['2026-10-26', TODAY], { start: '2026-10-25' })
  const c = cal({ habits: [read] })
  assert.equal(day(c, TODAY).habits.done, 1)
  // 25th missed, 26th done, 27th done -> 2 of 3
  assert.equal(c.summary.habitRate, (2 / 3) * 100)
})
test('a rest-day check-in is a bonus, a rest day itself shows nothing, and days before the habit existed are not missed', () => {
  const gym = habit('Gym', [0, 2, 4], ['2026-10-20', '2026-10-24'], { start: '2026-10-19' }) // Mon/Wed/Fri; 20th is a Tuesday, 24th a Saturday
  const c = cal({ habits: [gym] })
  assert.deepEqual(day(c, '2026-10-20').habits.items.map((i) => i.status), ['bonus'])
  assert.deepEqual(day(c, '2026-10-24').habits.items.map((i) => i.status), ['bonus'])
  assert.deepEqual(day(c, '2026-10-21').habits.items.map((i) => i.status), ['missed']) // Wednesday, not done
  assert.deepEqual(day(c, '2026-10-22').habits.items, []) // Thursday: a rest day
  assert.deepEqual(day(c, '2026-10-17').habits.items, [], 'before it started')
  assert.equal(day(c, '2026-10-20').habits.bonus, 1)
})
test('archived habits are ignored; habits are listed by name', () => {
  const c = cal({ habits: [habit('Zed', EVERY, ['2026-10-20']), habit('Old', EVERY, ['2026-10-20'], { archived: true }), habit('Alpha', EVERY, [])] })
  assert.deepEqual(day(c, '2026-10-20').habits.items.map((i) => [i.name, i.status]), [['Alpha', 'missed'], ['Zed', 'done']])
})
test('a habit checked off before its start date counts from its first check-in', () => {
  const c = cal({ habits: [habit('Early', EVERY, ['2026-10-10'], { start: '2026-10-15' })] })
  assert.equal(day(c, '2026-10-10').habits.items[0].status, 'done')
  assert.equal(day(c, '2026-10-11').habits.items[0].status, 'missed')
})

// ---- describing a day ----
test('a day is described in one line for screen readers and tooltips', () => {
  const read = habit('Read', EVERY, ['2026-10-20']), walk = habit('Walk', EVERY, [])
  const c = cal({
    entries: [entry('2026-10-20', 'good'), entry('2026-10-20')], trades: [trade('2026-10-20', 100, 139), trade('2026-10-20', 1, null)],
    txs: [tx('2026-10-20', 'deposit', 50)], habits: [read, walk]
  })
  assert.equal(describeDay(day(c, '2026-10-20')), 'Tue 20 Oct: 2 entries, 1 closed trade (+39.00), 1 open, savings +50.00, habits 1 of 2 done, mood good')
  assert.equal(describeDay(day(cal({ entries: [entry('2026-10-21')] }), '2026-10-21')), 'Wed 21 Oct: 1 entry')
})

console.log(`\n${n} calendar checks passed`)
