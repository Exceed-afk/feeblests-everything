// The design system and the chart arithmetic (src/shared/design.ts, src/renderer/src/lib/chartData.ts,
// and the Weekly insights in src/shared/review.ts). Needs no DOM:
//   npm test
import assert from 'node:assert/strict'
import { COLOR_TOKENS, DEFAULT_ACCENT, RADIUS, SPACING, TYPE_SCALE, accentFor, contrast, hexToRgb, shortDate, toneOf } from '../src/shared/design'
import { barTone, habitDayState, moodPoints, sparkPath, tradeBars } from '../src/renderer/src/lib/chartData'
import { weeklyInsights, periodDays } from '../src/shared/review'
import type { ReviewData } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }
const ratio = (a: string, b: string) => contrast(hexToRgb(a), hexToRgb(b))

// ---- the colour tokens ----
for (const mode of ['light', 'dark'] as const) {
  const t = COLOR_TOKENS[mode]
  test(`${mode}: text, secondary text and meaning colours are readable on the page and on cards`, () => {
    for (const surface of [t.bg, t.surface, t.panel]) {
      assert.ok(ratio(t.fg, surface) >= 7, `fg on ${surface}: ${ratio(t.fg, surface).toFixed(2)}`)
      assert.ok(ratio(t.muted, surface) >= 4.5, `muted on ${surface}: ${ratio(t.muted, surface).toFixed(2)}`)
      for (const c of [t.pos, t.neg, t.warn, t.mood]) assert.ok(ratio(c, surface) >= 4.5, `${c} on ${surface}: ${ratio(c, surface).toFixed(2)}`)
    }
  })
  test(`${mode}: a card stands out from the page, and its border is visible`, () => {
    assert.ok(ratio(t.card, t.bg) >= 1.04, 'card vs page')
    assert.ok(ratio(t.line, t.card) >= 1.2, 'border vs card')
  })
}
test('the dark set is designed, not an inversion: its page is not pure black and its gains are lighter', () => {
  assert.notEqual(COLOR_TOKENS.dark.bg, '#000000')
  const lightGain = hexToRgb(COLOR_TOKENS.light.pos).reduce((a, b) => a + b, 0)
  const darkGain = hexToRgb(COLOR_TOKENS.dark.pos).reduce((a, b) => a + b, 0)
  assert.ok(darkGain > lightGain, 'the dark gain colour is lighter than the light one')
})
test('the default accent follows the mode; a picked accent is left alone', () => {
  assert.equal(accentFor(DEFAULT_ACCENT.light, false), DEFAULT_ACCENT.light)
  assert.equal(accentFor(DEFAULT_ACCENT.light, true), DEFAULT_ACCENT.dark)
  assert.equal(accentFor(DEFAULT_ACCENT.dark, false), DEFAULT_ACCENT.light)
  assert.equal(accentFor(DEFAULT_ACCENT.dark, true), DEFAULT_ACCENT.dark)
  assert.equal(accentFor('#8b5cf6', true), '#8b5cf6')
})
test('spacing is the 4px grid, radii are the documented sizes, type is the documented scale', () => {
  assert.deepEqual([...SPACING], [0, 4, 8, 12, 16, 24, 32])
  assert.equal(RADIUS.card, 16)
  assert.equal(RADIUS.control, 10)
  assert.ok(TYPE_SCALE.pageTitle > TYPE_SCALE.metric * 0.8 && TYPE_SCALE.metric > TYPE_SCALE.body && TYPE_SCALE.body > TYPE_SCALE.small)
})
test('money is green up, red down, neutral at nothing', () => {
  assert.equal(toneOf(1), 'pos')
  assert.equal(toneOf(-1), 'neg')
  assert.equal(toneOf(0), 'muted')
  assert.equal(toneOf(null), 'muted')
})
test('a date is read as a calendar date, whatever the time zone', () => {
  assert.equal(shortDate('2026-10-28'), 'Wed 28 Oct')
  assert.equal(shortDate('2027-01-01'), 'Fri 1 Jan')
})

// ---- trading chart ----
const STATS = { total: 0, open: 0, closed: 0, wins: 0, losses: 0, winRate: null, totalPnl: 0, totalFees: 0, avgWin: null, avgLoss: null, profitFactor: null, best: null, worst: null }
const week = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']
const days = week.map((date, i) => ({ date, pnl: [4.4, -6.4, 7.8, 0, -18, 0, 0][i], closed: [1, 1, 1, 1, 1, 0, 0][i] }))

test('daily P&L bars keep the review\'s own per-day figures', () => {
  assert.deepEqual(tradeBars(days, 'pnl').map((b) => b.value), [4.4, -6.4, 7.8, 0, -18, 0, 0])
})
test('cumulative bars add the days up and start from the period\'s own zero', () => {
  const cum = tradeBars(days, 'cumulative').map((b) => b.value)
  assert.deepEqual(cum, [4.4, -2, 5.8, 5.8, -12.2, -12.2, -12.2])
  assert.equal(cum[cum.length - 1], -12.2) // the last bar is the period total
})
test('trade-count bars count closed trades, not money', () => {
  assert.deepEqual(tradeBars(days, 'count').map((b) => b.value), [1, 1, 1, 1, 1, 0, 0])
})
test('a day with no closed trades is never drawn as a loss', () => {
  const empty = tradeBars(days, 'pnl')[5]
  assert.equal(empty.closed, 0)
  assert.equal(barTone(empty, 'pnl'), 'muted') // value 0 -> neutral, and the component draws no bar for it
  assert.equal(barTone(tradeBars(days, 'pnl')[1], 'pnl'), 'neg')
  assert.equal(barTone(tradeBars(days, 'pnl')[0], 'pnl'), 'pos')
})

// ---- sparklines ----
test('a sparkline needs two points and a flat line sits in the middle', () => {
  assert.equal(sparkPath([5], 100, 20), '')
  assert.equal(sparkPath([3, 3, 3], 100, 10), 'M0.0 5.0 L50.0 5.0 L100.0 5.0') // a flat line sits in the middle
})
test('a sparkline skips missing days instead of treating them as zero', () => {
  const p = sparkPath([null, 2, null, 4], 3, 10)
  assert.equal(p, 'M1.0 10.0 L3.0 0.0') // day 2 is the low point, day 4 the high one; day 1 and 3 are skipped
})

// ---- mood trend ----
test('only logged days are plotted, on the fixed 1 to 5 scale', () => {
  const rows = [{ date: '2026-10-26', average: null }, { date: '2026-10-27', average: 3 }, { date: '2026-10-28', average: null }, { date: '2026-10-29', average: 5 }]
  const pts = moodPoints(rows, 300, 100)
  assert.equal(pts.length, 2) // the two missing days are not on the line
  assert.equal(pts[0].x, 100) // day 1 of 3 gaps
  assert.equal(pts[0].y, 50) // 3 of 5 is the middle
  assert.equal(pts[1].y, 0) // 5 of 5 is the top
})

// ---- habit days ----
test('a habit day is done, partial, missed, rest, untracked, pending or future - and nothing else', () => {
  const today = '2026-10-29'
  const tracked = '2026-10-01'
  assert.equal(habitDayState({ date: '2026-10-26', due: 3, done: 3 }, today, tracked), 'done')
  assert.equal(habitDayState({ date: '2026-10-27', due: 3, done: 1 }, today, tracked), 'partial')
  assert.equal(habitDayState({ date: '2026-10-28', due: 3, done: 0 }, today, tracked), 'missed')
  assert.equal(habitDayState({ date: '2026-10-28', due: 0, done: 0 }, today, tracked), 'rest')
  // Before the first active habit existed there was nothing to track, which is not a rest day.
  assert.equal(habitDayState({ date: '2026-10-26', due: 0, done: 0 }, today, '2026-10-28'), 'untracked')
  assert.equal(habitDayState({ date: '2026-10-26', due: 0, done: 0 }, today, null), 'untracked')
  assert.equal(habitDayState({ date: today, due: 3, done: 0 }, today, tracked), 'pending') // today is not missed yet
  assert.equal(habitDayState({ date: '2026-10-30', due: 3, done: 0 }, today, tracked), 'future')
})

// ---- weekly insights ----
const line = (text: string) => text
const base = (over: Partial<ReviewData>): ReviewData => ({
  kind: 'week', start: week[0], end: week[6], today: '2026-11-02', complete: true, prevStart: '2026-10-19', prevEnd: '2026-10-25',
  label: '', title: '',
  trades: { stats: { ...STATS }, days: days.map((d) => ({ ...d })), best: null, worst: null, previous: { closed: 0, totalPnl: 0 } },
  savings: { deposits: 0, withdrawals: 0, net: 0, txCount: 0, startBalance: 0, endBalance: 0, goals: [], previousNet: 0, recent: [] },
  habits: { due: 0, done: 0, rate: null, bonus: 0, previousRate: null, trackedFrom: null, habits: [], days: [] },
  tasks: { created: 0, completed: 0 }, mood: { logged: 0, average: null, previousAverage: null, counts: { great: 0, good: 0, okay: 0, low: 0, rough: 0 }, days: [], lowest: null, trend: null },
  journal: { entries: [], daysWritten: 0, reflection: null }, insights: [], prompts: [],
  ...over
})
test('with no data there are no insights, so nothing is invented', () => {
  assert.deepEqual(weeklyInsights(base({})), [])
})
test('the best and worst trading days come from the real per-day figures', () => {
  const d = base({})
  d.trades.stats = { ...d.trades.stats, closed: 5, totalPnl: -12.2 }
  const out = weeklyInsights(d)
  assert.deepEqual(out.map((i) => i.id), ['best-day', 'worst-day']) // both facts, not one replacing the other
  assert.equal(out[0].topic, 'trades')
  assert.match(line(out[0].text), /Best trading day was Wed 28 Oct, \+7\.80 from 1 closed trade\./)
  assert.match(line(out[1].text), /Worst trading day was Fri 30 Oct, -18\.00\./)
})
test('a one-day period names the day instead of calling it best and worst', () => {
  const d = base({})
  d.trades.days = [{ date: '2026-10-29', pnl: -18, closed: 1 }]
  d.trades.stats = { ...d.trades.stats, closed: 1, totalPnl: -18 }
  const out = weeklyInsights(d)
  assert.deepEqual(out.map((i) => i.id), ['one-day'])
  assert.match(out[0].text, /All 1 closed trade was on Thu 29 Oct \(-18\.00\)\./)
})
test('a whole losing week reports its worst day and no invented winner', () => {
  const d = base({})
  d.trades.days = [
    { date: '2026-10-26', pnl: -10, closed: 1 },
    { date: '2026-10-29', pnl: -18, closed: 1 }
  ]
  d.trades.stats = { ...d.trades.stats, closed: 2, totalPnl: -28 }
  const out = weeklyInsights(d)
  assert.deepEqual(out.map((i) => i.id), ['worst-day'])
  assert.match(out[0].text, /Worst trading day was Thu 29 Oct, -18\.00\./)
})
test('a tie between best days stays deterministic and does not invent a worst day', () => {
  const d = base({})
  d.trades.days = [
    { date: '2026-10-27', pnl: 10, closed: 1 },
    { date: '2026-10-28', pnl: 10, closed: 1 }
  ]
  d.trades.stats = { ...d.trades.stats, closed: 2, totalPnl: 20 }
  const out = weeklyInsights(d)
  assert.deepEqual(out.map((i) => i.id), ['best-day']) // first day wins the tie, as the data is ordered
  assert.match(out[0].text, /Best trading day was Tue 27 Oct, \+10\.00/)
})
test('savings, habits and mood each get one short line', () => {
  const d = base({})
  d.savings = { ...d.savings, deposits: 10, net: 10, txCount: 1, endBalance: 10 }
  d.habits = { ...d.habits, due: 6, done: 6, rate: 100, days: periodDays(week[0], week[6]).map((date) => ({ date, due: 3, done: 3 })) }
  d.mood = { ...d.mood, logged: 4, average: 2.75, previousAverage: 5 }
  const out = weeklyInsights(d)
  assert.deepEqual(out.map((i) => i.topic), ['savings', 'habits', 'mood'])
  assert.equal(out[0].text, 'You put 10.00 more into savings than you took out.')
  assert.equal(out[1].text, 'Every scheduled habit day was done (6 of 6).')
  assert.equal(out[2].text, 'Mood averaged 2.8 of 5 across 4 entries. It is lower than the week before (5.0).')
})
test('a running period does not compare its mood with a whole earlier one', () => {
  const d = base({ complete: false })
  d.mood = { ...d.mood, logged: 2, average: 3, previousAverage: 4 }
  assert.match(weeklyInsights(d)[0].text, /^Mood averaged 3\.0 of 5 across 2 entries\.$/)
})

console.log(`\n${n} design checks passed`)
