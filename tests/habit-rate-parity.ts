import assert from 'node:assert/strict'
import { habitRateInRange, addDays, computeHabitStatsFromCompletions } from '../src/shared/habits'
import { functionByName, type AssistantRows } from '../src/shared/assistant'
import { buildInsightDays, type InsightsInput } from '../src/shared/insights'
import { round8 } from '../src/shared/math'
import type { Habit } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const today = '2026-10-25'
const from = addDays(today, -29)

const habit = (
  id: number,
  name: string,
  options: {
    days?: number[]
    startDate?: string
    archived?: boolean
    type?: Habit['type']
    target?: number
    completions?: NonNullable<Habit['completions']>
  } = {}
): Habit => {
  const completions = options.completions ?? []
  return {
    id, name, notes: '', days: options.days ?? [0, 1, 2, 3, 4, 5, 6],
    archived: options.archived ?? false, startDate: options.startDate ?? from,
    checkins: completions.filter((completion) => completion.status === 'done').map((completion) => completion.date),
    completions, type: options.type, target: options.target,
    stats: { current: 0, best: 0, rate30: null, total: 0 }, createdAt: '', updatedAt: ''
  }
}

const habits = [
  habit(1, 'Rest days and skips', {
    days: [0, 2, 4],
    completions: [
      { date: '2026-10-19', status: 'done' },
      { date: '2026-10-20', status: 'done' },
      { date: '2026-10-21', status: 'skipped' },
      { date: '2026-10-23', status: 'done' },
      { date: today, status: 'done' }
    ]
  }),
  habit(2, 'Count target', {
    type: 'count', target: 2,
    completions: [
      { date: '2026-10-23', status: 'done', value: 2 },
      { date: '2026-10-24', status: 'done', value: 1 }
    ]
  }),
  habit(3, 'Started mid-window', {
    startDate: '2026-10-20',
    completions: [{ date: '2026-10-21', status: 'done' }]
  }),
  habit(4, 'Archived', {
    archived: true,
    completions: [{ date: '2026-10-24', status: 'done' }]
  })
]

const totals = habits.reduce((sum, h) => {
  const current = habitRateInRange(h, from, today, today)
  return { done: sum.done + current.done, due: sum.due + current.due }
}, { done: 0, due: 0 })

test('range rates match the Habits page stats for skips, rest days and targets', () => {
  for (const h of habits.filter((item) => !item.archived)) {
    const rate = habitRateInRange(h, from, today, today)
    const stats = computeHabitStatsFromCompletions(h, h.completions ?? [], today)
    assert.ok(stats.rate30 !== null)
    assert.equal(round8((rate.done / rate.due) * 100), stats.rate30)
  }
  assert.deepEqual(habitRateInRange(habits[0], from, today, today), { done: 2, due: 12 })
  assert.deepEqual(habitRateInRange(habits[1], from, today, today), { done: 1, due: 29 })
  assert.deepEqual(habitRateInRange(habits[2], from, today, today), { done: 1, due: 5 })
  assert.deepEqual(habitRateInRange(habits[3], from, today, today), { done: 0, due: 0 })
})

test('pending today and future days do not count in a rate', () => {
  const daily = habits[1]
  assert.deepEqual(habitRateInRange(daily, today, today, today), { done: 0, due: 0 })
  const completedToday = {
    ...daily,
    completions: [...(daily.completions ?? []), { date: today, status: 'done' as const, value: 2 }]
  }
  assert.deepEqual(habitRateInRange(completedToday, today, today, today), { done: 1, due: 1 })
  assert.deepEqual(habitRateInRange(daily, addDays(today, 1), addDays(today, 3), today), { done: 0, due: 0 })
})

test('Assistant and Insights use the shared habit-rate totals', () => {
  const rows: AssistantRows = { txs: [], goals: [], trades: [], habits, tasks: [], completions: [], entries: [] }
  const assistantRate = functionByName('habit_completion_rate')!.run(rows, { from, to: today }, today)
  assert.equal(assistantRate, round8((totals.done / totals.due) * 100))

  const input: InsightsInput = {
    today, start: from, end: today, habits, tasks: [], completions: [], trades: [], txs: [], entries: []
  }
  const days = buildInsightDays(input)
  assert.equal(days.reduce((sum, day) => sum + day.habitDue, 0), totals.due)
  assert.equal(days.reduce((sum, day) => sum + day.habitDone, 0), totals.done)

  const future = buildInsightDays({ ...input, start: addDays(today, 1), end: addDays(today, 3) })
  assert.equal(future.reduce((sum, day) => sum + day.habitDue + day.habitDone, 0), 0)
})

test('legacy habits without completion records retain their checkin fallback', () => {
  const legacy = { ...habits[2], completions: undefined, checkins: [] }
  const yesterday = addDays(today, -1)
  assert.deepEqual(habitRateInRange(legacy, yesterday, yesterday, today), { done: 0, due: 1 })
  const checked = { ...legacy, checkins: [yesterday] }
  assert.deepEqual(habitRateInRange(checked, yesterday, yesterday, today), { done: 1, due: 1 })
})

console.log(`\n${n} habit rate parity checks passed`)
