import assert from 'node:assert/strict'
import {
  buildInsights, buildInsightDays, INSIGHT_IDS, isInsightId, lastN,
  type InsightsInput
} from '../src/shared/insights'
import type { Habit, LogEntry, Mood, SavingsTx, TaskCompletion, TxKind } from '../src/shared/types'

let id = 1
const everyDay = [0, 1, 2, 3, 4, 5, 6]

const habit = (checkins: string[], startDate: string): Habit => ({
  id: id++, name: 'Daily habit', notes: '', days: everyDay, archived: false, startDate, checkins,
  stats: { current: 0, best: 0, rate30: null, total: checkins.length }, createdAt: '', updatedAt: ''
})

const entry = (date: string, mood: Mood): LogEntry => ({
  id: id++, date, title: 'Day', body: '', mood, tags: [], createdAt: '', updatedAt: ''
})

const tx = (date: string, kind: TxKind, amount: number): SavingsTx => ({
  id: id++, goalId: 1, date, kind, amount, note: '', createdAt: '', updatedAt: ''
})

const input = (over: Partial<InsightsInput> = {}): InsightsInput => ({
  today: '2026-10-11',
  start: '2026-10-01',
  end: '2026-10-10',
  habits: [],
  tasks: [],
  completions: [],
  trades: [],
  txs: [],
  entries: [],
  ...over
})

const days = (start: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10))

const completion = (taskId: number, date: string): TaskCompletion => ({
  taskId,
  completedAt: new Date(`${date}T12:00:00`).toISOString()
})

const findInsight = (result: ReturnType<typeof buildInsights>, id_: string) =>
  result.correlations.find((insight) => insight.id === id_)

const test = (name: string, fn: () => void) => {
  fn()
  console.log('ok  ', name)
}

test('weak correlations do not claim a direction', () => {
  const dates = days('2026-10-01', 10)
  const moods: Mood[] = ['rough', 'rough', 'low', 'low', 'okay', 'okay', 'good', 'good', 'great', 'great']
  const hasTask = [false, true, false, true, false, true, false, true, false, false]
  const result = buildInsights(input({
    entries: dates.map((date, i) => entry(date, moods[i])),
    completions: dates.flatMap((date, i) => hasTask[i] ? [completion(i + 1, date)] : [])
  }))
  const insight = findInsight(result, INSIGHT_IDS.moodVsTasks)
  assert.ok(insight?.ok)
  assert.ok(insight.r !== null && Math.abs(insight.r) < 0.3)
  assert.match(insight.text, /did not clearly move/)
  assert.doesNotMatch(insight.text, /tended to be (higher|lower)/)
})

test('one-day windows and non-positive lastN counts are safe', () => {
  const result = buildInsights(input({
    today: '2026-10-02',
    start: '2026-10-01',
    end: '2026-10-01',
    entries: [entry('2026-10-01', 'good')]
  }))
  assert.equal(result.windowDays, 1)
  assert.deepEqual(lastN([1, 2, 3], 0), [])
  assert.deepEqual(lastN([1, 2, 3], -1), [])
})

test('all-zero task days are excluded as median ties', () => {
  const dates = days('2026-10-01', 8)
  const result = buildInsights(input({ entries: dates.map((date) => entry(date, 'good')) }))
  const insight = result.comparisons.find((item) => item.id === INSIGHT_IDS.moodByTasks)
  assert.ok(insight)
  assert.equal(insight.ok, false)
  assert.equal(insight.a.n, 0)
  assert.equal(insight.b.n, 0)
  assert.match(insight.needText ?? '', /Not enough/)
})

test('all perfect and lower-rate habit days are included in their groups', () => {
  const dates = days('2026-10-01', 15)
  const result = buildInsights(input({
    today: '2026-10-16',
    start: dates[0],
    end: dates[dates.length - 1],
    habits: [habit(dates.slice(0, 10), dates[0])],
    txs: dates.map((date) => tx(date, 'deposit', 10))
  }))
  const insight = result.comparisons.find((item) => item.id === INSIGHT_IDS.savingsByHabits)
  assert.ok(insight?.ok)
  assert.equal(insight.a.n, 10)
  assert.equal(insight.b.n, 5)
})

test('insight IDs used by the engine are in the shared dismissal allowlist', () => {
  const result = buildInsights(input())
  const ids = [
    ...result.comparisons.map((insight) => insight.id),
    ...result.correlations.map((insight) => insight.id)
  ]
  assert.deepEqual(ids.sort(), Object.values(INSIGHT_IDS).sort())
  for (const id_ of Object.values(INSIGHT_IDS)) assert.equal(isInsightId(id_), true)
  assert.equal(isInsightId('unknown-insight'), false)
})

test('savings totals use the shared signed amount helper semantics', () => {
  const [day] = buildInsightDays(input({
    start: '2026-10-01',
    end: '2026-10-01',
    txs: [tx('2026-10-01', 'withdrawal', 12)]
  }))
  assert.equal(day.savingsNet, -12)
})

// ---------- I1: effect size instead of a fixed threshold ----------

import { sd, cohensD, effectSizeText, MIN_DAYS } from '../src/shared/insights'

test('I1: sd of a known set matches the textbook sample value', () => {
  // [2, 4, 4, 4, 5, 5, 7, 9]: population sd = 2; sample sd (n-1) = 2.138...
  assert.equal(sd([2, 4, 4, 4, 5, 5, 7, 9]), 2.138089935299395)
  assert.equal(sd([5]), null) // one number has no spread
  assert.equal(sd([]), null)
})

test('I1: cohensD is 0 for equal groups and null for zero spread with different means', () => {
  assert.equal(cohensD([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]), 0)
  // Both groups constant but different means: a difference with no measurable spread.
  assert.equal(cohensD([3, 3, 3, 3, 3], [5, 5, 5, 5, 5]), null)
  // Textbook-style: two groups of the SAME shape shifted by one pooled sd -> d = 1.
  const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const spread = sd(a) as number
  const b = a.map((x) => x + spread) // same shape shifted by exactly one pooled sd
  assert.equal(Math.abs(cohensD(a, b) as number), 1)
})

test('I1: the wording bands follow |d|', () => {
  assert.equal(effectSizeText(0), 'about the same')
  assert.equal(effectSizeText(0.19), 'about the same')
  assert.equal(effectSizeText(0.2), 'a small difference')
  assert.equal(effectSizeText(0.49), 'a small difference')
  assert.equal(effectSizeText(0.5), 'a moderate difference')
  assert.equal(effectSizeText(0.79), 'a moderate difference')
  assert.equal(effectSizeText(0.8), 'a large difference')
  assert.equal(effectSizeText(-0.9), 'a large difference') // sign does not matter
  assert.equal(effectSizeText(null), null)
})

test('I1: MIN_DAYS is raised to 5', () => {
  assert.equal(MIN_DAYS, 5)
})

test('I1: a money comparison is judged by effect size, not raw size', () => {
  // Two savings groups with the SAME shape but a small shift relative to their
  // wide spread: d lands in "about the same" even though the raw gap (3.5/day)
  // is big money. The fixed SAME=0.25 rule could not do this for money.
  const high = [0, 20, 30, 40, 90] // mean 36, sd ~35
  const low2 = high.map((x) => x + 3.5)
  const d = cohensD(high, low2)
  assert.equal(effectSizeText(d), 'about the same')
})
