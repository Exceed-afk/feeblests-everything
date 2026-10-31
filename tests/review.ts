// Checks for the weekly / monthly review (src/shared/review.ts). No database needed:
//   npm test
import assert from 'node:assert/strict'
import { buildReview, periodDays, periodLabel, reviewRange, reviewTitle, shiftRange, summaryText, MOOD_SCORE, REVIEW_TAG } from '../src/shared/review'
import type { Task } from '../src/shared/types'
import { computeHabitStats } from '../src/shared/habits'
import { calcPnl } from '../src/shared/trades'
import type { Habit, LogEntry, Mood, SavingsGoal, SavingsTx, Trade, TxKind } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

// ---- builders ----
const WEEK_START = '2026-10-19' // Monday
const WEEK_END = '2026-10-25' // Sunday
const DONE = '2026-10-27' // a Tuesday after that week: the week is over
const MID = '2026-10-22' // a Thursday inside it: the week is still going
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

const empty = { trades: [], goals: [], txs: [], habits: [], tasks: [], entries: [] }
const week = (over: Partial<Parameters<typeof buildReview>[0]> = {}) =>
  buildReview({ kind: 'week', anchor: '2026-10-21', today: DONE, ...empty, ...over })

// ---- periods ----
test('a week runs Monday to Sunday whichever day inside it you start from', () => {
  for (const d of periodDays(WEEK_START, WEEK_END)) assert.deepEqual(reviewRange('week', d), { start: WEEK_START, end: WEEK_END })
  assert.deepEqual(reviewRange('week', '2026-10-26'), { start: '2026-10-26', end: '2026-11-01' })
})
test('a month runs from the 1st to its real last day, leap years included', () => {
  assert.deepEqual(reviewRange('month', '2026-10-15'), { start: '2026-10-01', end: '2026-10-31' })
  assert.deepEqual(reviewRange('month', '2026-11-30'), { start: '2026-11-01', end: '2026-11-30' })
  assert.deepEqual(reviewRange('month', '2027-02-10'), { start: '2027-02-01', end: '2027-02-28' })
  assert.deepEqual(reviewRange('month', '2028-02-10'), { start: '2028-02-01', end: '2028-02-29' })
  assert.deepEqual(reviewRange('month', '2026-12-31'), { start: '2026-12-01', end: '2026-12-31' })
})
test('stepping back and forward crosses the new year correctly', () => {
  const jan = reviewRange('month', '2027-01-20')
  assert.deepEqual(shiftRange('month', jan, -1), { start: '2026-12-01', end: '2026-12-31' })
  assert.deepEqual(shiftRange('month', reviewRange('month', '2026-12-05'), 1), { start: '2027-01-01', end: '2027-01-31' })
  const w = reviewRange('week', '2026-12-30') // 28 Dec to 3 Jan
  assert.deepEqual(w, { start: '2026-12-28', end: '2027-01-03' })
  assert.deepEqual(shiftRange('week', w, 1), { start: '2027-01-04', end: '2027-01-10' })
  assert.deepEqual(shiftRange('week', w, -1), { start: '2026-12-21', end: '2026-12-27' })
  assert.deepEqual(shiftRange('month', reviewRange('month', '2026-03-31'), -1), { start: '2026-02-01', end: '2026-02-28' })
})
test('a period lists every one of its days', () => {
  assert.equal(periodDays(WEEK_START, WEEK_END).length, 7)
  assert.equal(periodDays('2026-10-01', '2026-10-31').length, 31)
  assert.deepEqual(periodDays('2026-02-27', '2026-03-01'), ['2026-02-27', '2026-02-28', '2026-03-01'])
})
test('labels and the reflection title are fixed text', () => {
  assert.equal(periodLabel('week', WEEK_START, WEEK_END), '19 Oct to 25 Oct 2026')
  assert.equal(periodLabel('week', '2026-12-28', '2027-01-03'), '28 Dec 2026 to 3 Jan 2027')
  assert.equal(periodLabel('month', '2026-10-01', '2026-10-31'), 'October 2026')
  assert.equal(reviewTitle('week', WEEK_START, WEEK_END), 'Weekly review 2026-10-19 to 2026-10-25')
  assert.equal(reviewTitle('month', '2026-10-01', '2026-10-31'), 'Monthly review 2026-10')
})
test('the period is complete only once it is over', () => {
  assert.equal(week({ today: DONE }).complete, true)
  assert.equal(week({ today: WEEK_END }).complete, false) // Sunday is still going
  assert.equal(week({ today: MID }).complete, false)
  assert.equal(week().prevStart, '2026-10-12')
  assert.equal(week().prevEnd, '2026-10-18')
})

// ---- nothing at all ----
test('with no data nothing breaks and nothing is invented', () => {
  const r = week()
  assert.equal(r.trades.stats.closed, 0)
  assert.equal(r.trades.best, null)
  assert.equal(r.savings.net, 0)
  assert.deepEqual(r.savings.goals, [])
  assert.equal(r.habits.rate, null)
  assert.equal(r.habits.previousRate, null)
  assert.equal(r.mood.average, null)
  assert.equal(r.mood.trend, null)
  assert.equal(r.journal.reflection, null)
  assert.deepEqual(r.insights, [])
  assert.equal(r.trades.days.length, 7)
  assert.equal(r.habits.days.length, 7)
  assert.equal(r.mood.days.length, 7)
  assert.deepEqual(r.prompts.map((p) => p.id), ['went-well', 'change'])
})

// ---- trades ----
test('trades count on their entry date, both edges of the period included', () => {
  const t = [
    trade('2026-10-18', 100, 150), // the day before: not in this week
    trade(WEEK_START, 100, 110), // Monday: in (+10)
    trade(WEEK_END, 100, 90), // Sunday: in (-10)
    trade('2026-10-26', 100, 200) // the day after: not in this week
  ]
  const r = week({ trades: t })
  assert.equal(r.trades.stats.total, 2)
  assert.equal(r.trades.stats.totalPnl, 0)
  assert.equal(r.trades.stats.wins, 1)
  assert.equal(r.trades.stats.losses, 1)
})
test('open trades are counted as open and kept out of the P&L and the daily bars', () => {
  const r = week({ trades: [trade('2026-10-20', 100, null), trade('2026-10-20', 100, 120)] })
  assert.equal(r.trades.stats.open, 1)
  assert.equal(r.trades.stats.closed, 1)
  assert.equal(r.trades.stats.totalPnl, 20)
  assert.deepEqual(r.trades.days.find((d) => d.date === '2026-10-20'), { date: '2026-10-20', pnl: 20, closed: 1 })
})
test('daily P&L adds up the closed trades of each day, short trades and fees included', () => {
  const r = week({ trades: [trade('2026-10-21', 100, 110, { fees: 1 }), trade('2026-10-21', 100, 90, { dir: 'short', qty: 2, fees: 0.5 }), trade('2026-10-23', 50, 40)] })
  assert.deepEqual(r.trades.days.map((d) => d.pnl), [0, 0, 9 + 19.5, 0, -10, 0, 0])
  assert.equal(r.trades.stats.totalPnl, 9 + 19.5 - 10)
  assert.equal(r.trades.stats.totalFees, 1.5)
})
test('best and worst trade are named only when one really made or lost money', () => {
  const win = trade('2026-10-20', 100, 130), small = trade('2026-10-21', 100, 105), loss = trade('2026-10-22', 100, 80)
  const r = week({ trades: [win, small, loss] })
  assert.equal(r.trades.best?.id, win.id)
  assert.equal(r.trades.worst?.id, loss.id)
  const onlyWins = week({ trades: [win, small] })
  assert.equal(onlyWins.trades.worst, null) // no loser, so no "worst"
  const onlyLosses = week({ trades: [loss] })
  assert.equal(onlyLosses.trades.best, null)
})
test('the previous period is summed for comparison', () => {
  const r = week({ trades: [trade('2026-10-14', 100, 120), trade('2026-10-15', 100, 95), trade('2026-10-20', 100, 101)] })
  assert.deepEqual(r.trades.previous, { closed: 2, totalPnl: 15 })
  assert.equal(r.trades.stats.totalPnl, 1)
})

// ---- savings ----
test('savings movement is split into deposits, withdrawals and a net, only for the period', () => {
  const a = goal('Trip'), b = goal('Car')
  const txs = [
    tx(a, '2026-10-10', 'deposit', 500), // before the week
    tx(a, WEEK_START, 'deposit', 100),
    tx(a, '2026-10-22', 'withdrawal', 30),
    tx(b, WEEK_END, 'deposit', 40),
    tx(b, '2026-10-26', 'deposit', 999) // after the week
  ]
  const r = week({ goals: [a, b], txs })
  assert.equal(r.savings.deposits, 140)
  assert.equal(r.savings.withdrawals, 30)
  assert.equal(r.savings.net, 110)
  assert.equal(r.savings.txCount, 3)
  assert.equal(r.savings.startBalance, 500)
  assert.equal(r.savings.endBalance, 610)
})
test('each goal shows its own balance before and at the end of the period, biggest change first', () => {
  const a = goal('Trip', 1000), b = goal('Car')
  const r = week({ goals: [a, b], txs: [tx(a, '2026-10-01', 'deposit', 200), tx(a, '2026-10-20', 'deposit', 50), tx(b, '2026-10-21', 'deposit', 300)] })
  assert.deepEqual(r.savings.goals.map((g) => [g.name, g.net, g.startBalance, g.endBalance]), [['Car', 300, 0, 300], ['Trip', 50, 200, 250]])
})
test('a goal with no movement in the period is left out, and the totals still include its balance', () => {
  const idle = goal('Idle'), busy = goal('Busy')
  const r = week({ goals: [idle, busy], txs: [tx(idle, '2026-09-01', 'deposit', 70), tx(busy, '2026-10-20', 'deposit', 5)] })
  assert.deepEqual(r.savings.goals.map((g) => g.name), ['Busy'])
  assert.equal(r.savings.startBalance, 70)
  assert.equal(r.savings.endBalance, 75)
})
test('a goal is "reached" when this period carried it across its target, and not before or after', () => {
  const g = goal('Laptop', 1000)
  const crossing = week({ goals: [g], txs: [tx(g, '2026-10-01', 'deposit', 900), tx(g, '2026-10-21', 'deposit', 150)] })
  assert.equal(crossing.savings.goals[0].reached, true)
  const already = week({ goals: [g], txs: [tx(g, '2026-10-01', 'deposit', 1000), tx(g, '2026-10-21', 'deposit', 5)] })
  assert.equal(already.savings.goals[0].reached, false) // it was reached in an earlier period
  const short = week({ goals: [g], txs: [tx(g, '2026-10-21', 'deposit', 999)] })
  assert.equal(short.savings.goals[0].reached, false)
  const noTarget = goal('Pocket')
  assert.equal(week({ goals: [noTarget], txs: [tx(noTarget, '2026-10-21', 'deposit', 1e6)] }).savings.goals[0].reached, false)
})
test('the previous period net is available, and transactions of a deleted goal are ignored', () => {
  const g = goal('Trip')
  const ghost: SavingsTx = { ...tx(g, '2026-10-20', 'deposit', 77), goalId: 99999 }
  const r = week({ goals: [g], txs: [tx(g, '2026-10-13', 'deposit', 40), tx(g, '2026-10-14', 'withdrawal', 10), ghost] })
  assert.equal(r.savings.previousNet, 30)
  assert.equal(r.savings.net, 0)
  assert.equal(r.savings.txCount, 0)
})
test('end balance minus start balance is always the net, whatever the data (400 random cases)', () => {
  let seed = 7
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  for (let run = 0; run < 400; run++) {
    const goals = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, i) => goal(`G${i}`, rnd() < 0.5 ? null : 100 + Math.floor(rnd() * 900)))
    const txs: SavingsTx[] = []
    for (let k = 0; k < Math.floor(rnd() * 14); k++) {
      const day = `2026-10-${String(5 + Math.floor(rnd() * 26)).padStart(2, '0')}`
      txs.push(tx(goals[Math.floor(rnd() * goals.length)], day, rnd() < 0.7 ? 'deposit' : 'withdrawal', Math.round(rnd() * 20000) / 100))
    }
    const r = week({ goals, txs })
    assert.ok(Math.abs(r.savings.endBalance - r.savings.startBalance - r.savings.net) < 1e-6, `run ${run}`)
    const sumNet = r.savings.goals.reduce((a, g) => a + g.net, 0)
    assert.ok(Math.abs(sumNet - r.savings.net) < 1e-6, `run ${run}: goal nets`)
  }
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
test('today is not missed while the period is still going, but counts once it is done', () => {
  const open = week({ today: MID, habits: [habit('Read', EVERY, ['2026-10-19', '2026-10-20', '2026-10-21'], { today: MID })] })
  assert.equal(open.habits.due, 3) // Mon-Wed; Thursday (today) is not over, Fri-Sun have not happened
  assert.equal(open.habits.done, 3)
  const ticked = week({ today: MID, habits: [habit('Read', EVERY, ['2026-10-19', MID], { today: MID })] })
  assert.equal(ticked.habits.due, 4) // Tue and Wed missed, Mon and today done
  assert.equal(ticked.habits.done, 2)
})
test('rest days never count against you, and a check-in on one is a bonus', () => {
  // Weekdays only; checked every weekday plus Saturday.
  const h = habit('Gym', WEEKDAYS, ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'])
  const r = week({ habits: [h] })
  assert.equal(r.habits.due, 5)
  assert.equal(r.habits.done, 5)
  assert.equal(r.habits.rate, 100)
  assert.equal(r.habits.bonus, 1)
})
test('days before a habit existed are not missed', () => {
  const r = week({ habits: [habit('New', EVERY, ['2026-10-23', '2026-10-24', '2026-10-25'], { start: '2026-10-23' })] })
  assert.equal(r.habits.due, 3)
  assert.equal(r.habits.rate, 100)
})
test('archived habits are ignored', () => {
  const r = week({ habits: [habit('Old', EVERY, [], { archived: true }), habit('Now', EVERY, ['2026-10-19'])] })
  assert.deepEqual(r.habits.habits.map((h) => h.name), ['Now'])
  assert.equal(r.habits.due, 7)
})
test('the weakest habit is listed first', () => {
  const strong = habit('Strong', EVERY, periodDays(WEEK_START, WEEK_END)), weak = habit('Weak', EVERY, ['2026-10-19'])
  assert.deepEqual(week({ habits: [strong, weak] }).habits.habits.map((h) => h.name), ['Weak', 'Strong'])
})
test('the day strip adds up what was due and done on each day across habits', () => {
  const a = habit('A', EVERY, ['2026-10-19', '2026-10-20']), b = habit('B', EVERY, ['2026-10-19'])
  const r = week({ habits: [a, b] })
  assert.deepEqual(r.habits.days[0], { date: '2026-10-19', due: 2, done: 2 })
  assert.deepEqual(r.habits.days[1], { date: '2026-10-20', due: 2, done: 1 })
  assert.deepEqual(r.habits.days[2], { date: '2026-10-21', due: 2, done: 0 })
})
test('the previous period rate is worked out the same way', () => {
  const h = habit('Read', EVERY, ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-19'])
  const r = week({ habits: [h] })
  assert.equal(r.habits.previousRate, (4 / 7) * 100)
  assert.equal(r.habits.rate, (1 / 7) * 100)
})
test('a month of habits uses every day of the month that has passed', () => {
  const r = buildReview({ kind: 'month', anchor: '2026-10-10', today: '2026-10-10', ...empty, habits: [habit('Read', EVERY, ['2026-10-09'], { today: '2026-10-10', start: '2026-10-01' })] })
  assert.equal(r.habits.due, 9) // 1st to 9th; the 10th is today and not done yet
  assert.equal(r.habits.done, 1)
})

// ---- mood ----
test('mood is averaged on a 1 to 5 scale and counted per mood', () => {
  const r = week({ entries: [entry('2026-10-19', 'great'), entry('2026-10-20', 'good'), entry('2026-10-21', 'okay'), entry('2026-10-22', 'okay'), entry('2026-10-23', null)] })
  assert.equal(r.mood.logged, 4)
  assert.equal(r.mood.average, (5 + 4 + 3 + 3) / 4)
  assert.deepEqual(r.mood.counts, { great: 1, good: 1, okay: 2, low: 0, rough: 0 })
  assert.deepEqual(MOOD_SCORE, { great: 5, good: 4, okay: 3, low: 2, rough: 1 })
})
test('two entries on one day give that day one average', () => {
  const r = week({ entries: [entry('2026-10-20', 'great'), entry('2026-10-20', 'okay')] })
  assert.equal(r.mood.days[1].average, 4)
  assert.equal(r.mood.days[0].average, null)
})
test('entries outside the period do not count, but the previous period gives the comparison', () => {
  const r = week({ entries: [entry('2026-10-18', 'rough'), entry('2026-10-12', 'low'), entry('2026-10-26', 'rough'), entry('2026-10-20', 'good')] })
  assert.equal(r.mood.average, 4)
  assert.equal(r.mood.previousAverage, 1.5)
})
test('the trend compares the second half of the logged days with the first, and needs four days', () => {
  const up = week({ entries: [entry('2026-10-19', 'low'), entry('2026-10-20', 'low'), entry('2026-10-23', 'good'), entry('2026-10-24', 'great')] })
  assert.equal(up.mood.trend, 'up')
  const down = week({ entries: [entry('2026-10-19', 'great'), entry('2026-10-20', 'good'), entry('2026-10-23', 'low'), entry('2026-10-24', 'rough')] })
  assert.equal(down.mood.trend, 'down')
  const steady = week({ entries: [entry('2026-10-19', 'good'), entry('2026-10-20', 'okay'), entry('2026-10-23', 'good'), entry('2026-10-24', 'okay')] })
  assert.equal(steady.mood.trend, 'steady')
  const thin = week({ entries: [entry('2026-10-19', 'low'), entry('2026-10-20', 'low'), entry('2026-10-23', 'great')] })
  assert.equal(thin.mood.trend, null)
})
test('a lowest day is named only when it was low or rough', () => {
  assert.deepEqual(week({ entries: [entry('2026-10-21', 'low'), entry('2026-10-22', 'rough'), entry('2026-10-23', 'good')] }).mood.lowest, { date: '2026-10-22', mood: 'rough' })
  assert.equal(week({ entries: [entry('2026-10-21', 'okay'), entry('2026-10-22', 'good')] }).mood.lowest, null)
})

// ---- journal ----
test('journal entries of the period are listed newest first, and reflections are kept out of the list', () => {
  const title = reviewTitle('week', WEEK_START, WEEK_END)
  const r = week({ entries: [entry('2026-10-20', 'good', { title: 'Tuesday' }), entry('2026-10-22', null, { title: 'Thursday' }), entry('2026-10-12', null), entry(WEEK_END, 'okay', { title, tags: [REVIEW_TAG, 'weekly'] })] })
  assert.deepEqual(r.journal.entries.map((e) => e.title), ['Thursday', 'Tuesday'])
  assert.equal(r.journal.daysWritten, 2)
  assert.equal(r.journal.reflection?.title, title)
})
test('a saved reflection is found by its title even when its date is outside the period', () => {
  const title = reviewTitle('week', WEEK_START, WEEK_END)
  const late = entry('2026-10-28', null, { title, tags: [REVIEW_TAG, 'weekly'] })
  assert.equal(week({ entries: [late] }).journal.reflection?.id, late.id)
  const otherWeek = entry('2026-10-28', null, { title: reviewTitle('week', '2026-10-12', '2026-10-18'), tags: [REVIEW_TAG] })
  assert.equal(week({ entries: [otherWeek] }).journal.reflection, null)
  const noTag = entry(WEEK_END, null, { title }) // same title but not a review entry
  assert.equal(week({ entries: [noTag] }).journal.reflection, null)
})
test('the mood on a reflection counts like any other entry', () => {
  const title = reviewTitle('week', WEEK_START, WEEK_END)
  const r = week({ entries: [entry(WEEK_END, 'great', { title, tags: [REVIEW_TAG] })] })
  assert.equal(r.mood.average, 5)
})

// ---- links between tools ----
const days = periodDays(WEEK_START, WEEK_END)
test('mood on full-habit days against other days is reported only with at least two days each side', () => {
  const h = habit('Read', EVERY, ['2026-10-19', '2026-10-20', '2026-10-21'])
  const moods = [entry('2026-10-19', 'great'), entry('2026-10-20', 'great'), entry('2026-10-22', 'low'), entry('2026-10-23', 'low')]
  const r = week({ habits: [h], entries: moods })
  assert.equal(r.insights.length, 1)
  assert.equal(r.insights[0].id, 'habits-mood')
  assert.match(r.insights[0].text, /5\.0 of 5 on the 2 days you finished every habit and 2\.0 of 5 on the 2 other days/)
  const oneSide = week({ habits: [h], entries: [moods[0], moods[2], moods[3]] })
  assert.deepEqual(oneSide.insights, [])
})
test('similar moods are called about the same, not a difference', () => {
  const h = habit('Read', EVERY, ['2026-10-19', '2026-10-20'])
  const r = week({ habits: [h], entries: [entry('2026-10-19', 'good'), entry('2026-10-20', 'good'), entry('2026-10-22', 'good'), entry('2026-10-23', 'good')] })
  assert.match(r.insights[0].text, /^Mood was about the same/)
})
test('mood on winning trade days against losing ones is reported the same way', () => {
  const t = [trade('2026-10-19', 10, 12), trade('2026-10-20', 10, 13), trade('2026-10-21', 10, 7), trade('2026-10-22', 10, 6)]
  const moods = [entry('2026-10-19', 'good'), entry('2026-10-20', 'good'), entry('2026-10-21', 'low'), entry('2026-10-22', 'low')]
  const r = week({ trades: t, entries: moods })
  assert.deepEqual(r.insights.map((i) => i.id), ['trades-mood'])
  assert.match(r.insights[0].text, /4\.0 of 5 on the 2 days your closed trades made money and 2\.0 of 5 on the 2 days they lost/)
})
test('with only a few logged days nothing is claimed', () => {
  assert.deepEqual(week({ habits: [habit('Read', EVERY, ['2026-10-19'])], entries: [entry('2026-10-19', 'good')] }).insights, [])
  void days
})

// ---- reflection prompts ----
test('prompts follow the numbers: losses, weak habits, a low day and savings each get a question', () => {
  const t = [trade('2026-10-20', 100, 90, { qty: 1 }), trade('2026-10-21', 100, 105)]
  const g = goal('Trip')
  const r = week({
    trades: t, goals: [g], txs: [tx(g, '2026-10-21', 'withdrawal', 25)],
    habits: [habit('Read', EVERY, ['2026-10-19', '2026-10-20'])], entries: [entry('2026-10-22', 'rough')]
  })
  assert.deepEqual(r.prompts.map((p) => p.id), ['trades-loss', 'habit-weak', 'mood-low', 'savings-down', 'went-well', 'change'])
  assert.match(r.prompts[0].text, /netted -5\.00 \(1 win, 1 loss\)/)
  assert.match(r.prompts[1].text, /"Read" was done 2 of 7 scheduled days/)
  assert.match(r.prompts[2].text, /Thu 22 Oct \(rough\)/)
  assert.match(r.prompts[3].text, /went down by 25\.00/)
})
test('a good period gets the matching questions', () => {
  const g = goal('Trip')
  const r = week({
    trades: [trade('2026-10-20', 100, 130)], goals: [g], txs: [tx(g, '2026-10-21', 'deposit', 25)],
    habits: [habit('Read', EVERY, periodDays(WEEK_START, WEEK_END))]
  })
  assert.deepEqual(r.prompts.map((p) => p.id), ['trades-win', 'habit-strong', 'savings-up', 'went-well', 'change'])
})
test('open trades get a question when nothing has closed', () => {
  assert.equal(week({ trades: [trade('2026-10-20', 100, null)] }).prompts[0].id, 'trades-open')
})
test('the wording says "this" while the period runs and "that" once it is over; months say month', () => {
  assert.match(week({ today: MID }).prompts[0].text, /this week/)
  assert.match(week({ today: DONE }).prompts[0].text, /that week/)
  assert.match(buildReview({ kind: 'month', anchor: '2026-10-10', today: '2026-10-27', ...empty }).prompts[1].text, /next month/)
})

// ---- the numbers as text ----
test('created and completed task counts are included in a period and completed task tile data', () => {
  const task = (id: number, createdAt: string, completedAt: string | null): Task => ({
    id, title: `Task ${id}`, notes: '', status: completedAt ? 'done' : 'todo', priority: 'medium', dueDate: null,
    createdAt, completedAt, deletedAt: null, dueTime: null, project: null, tags: [], position: id, recurrenceRule: null, recurrenceNext: null, subtasks: []
  })
  const r = week({ tasks: [task(1, '2026-10-20T23:00:00-07:00', null), task(2, '2026-10-21T00:30:00+02:00', '2026-10-22T23:00:00-07:00'), task(3, '2026-10-26T00:00:00Z', null)] })
  assert.deepEqual(r.tasks, { created: 2, completed: 1 })
})

test('the summary text lists each tool on one line', () => {
  const g = goal('Trip')
  const r = week({
    trades: [trade('2026-10-20', 100, 130, { fees: 2 }), trade('2026-10-21', 100, 90)], goals: [g],
    txs: [tx(g, '2026-10-01', 'deposit', 100), tx(g, '2026-10-21', 'deposit', 60), tx(g, '2026-10-22', 'withdrawal', 10)],
    habits: [habit('Read', EVERY, ['2026-10-19', '2026-10-20', '2026-10-21'])], entries: [entry('2026-10-19', 'good'), entry('2026-10-20', 'okay')]
  })
  assert.equal(summaryText(r), [
    'Numbers for 19 Oct to 25 Oct 2026',
    '- Trades: 2 closed (1 win, 1 loss), net P&L +18.00, fees 2.00',
    '- Savings: net +50.00 (deposits 60.00, withdrawals 10.00), total balance 150.00',
    '- Habits: 43% of scheduled days done (3 of 7)',
    '- Mood: 3.5 of 5 on average over 2 entries'
  ].join('\n'))
})
test('irregular plurals are spelled right ("2 losses", "1 entry")', () => {
  const r = week({ trades: [trade('2026-10-20', 100, 90), trade('2026-10-21', 100, 80)], entries: [entry('2026-10-20', 'good')] })
  assert.match(summaryText(r), /\(0 wins, 2 losses\)/)
  assert.match(summaryText(r), /over 1 entry$/)
})
test('the summary text says plainly when a tool has nothing', () => {
  assert.equal(summaryText(week()), [
    'Numbers for 19 Oct to 25 Oct 2026',
    '- Trades: no closed trades',
    '- Savings: no deposits or withdrawals',
    '- Habits: nothing scheduled to count',
    '- Mood: none logged'
  ].join('\n'))
})

console.log(`\n${n} review checks passed`)
