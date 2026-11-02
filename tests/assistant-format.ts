import assert from 'node:assert/strict'
import { formatAnswer, functionByName } from '../src/shared/assistant'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }
const range = {
  spec: { kind: 'this_month' } as const,
  resolved: { from: '2026-10-01', to: '2026-10-31' }
}
const answer = (name: string, value: number) => formatAnswer({
  fn: functionByName(name)!,
  result: { type: 'number', value },
  range,
  filters: {},
  compare: null
})

test('money answers show the human label, requested period, local dates and two decimals', () => {
  assert.equal(answer('savings_total', 120), 'Net savings for this month (1 to 31 Oct 2026): 120.00.')
})

test('percent answers include the percent unit', () => {
  assert.equal(answer('habit_completion_rate', 75), 'Habit completion for this month (1 to 31 Oct 2026): 75%.')
})

test('count answers remain counts rather than formatted currency', () => {
  assert.equal(answer('tasks_completed', 4), 'Tasks completed for this month (1 to 31 Oct 2026): 4.')
})

test('score answers use the five-point scale', () => {
  assert.equal(answer('mood_average', 3.8), 'Mood average for this month (1 to 31 Oct 2026): 3.8 of 5.')
})

test('comparison answers use unit-aware change wording and omit percent change from zero', () => {
  const fn = functionByName('savings_total')!
  const result = formatAnswer({
    fn, result: { type: 'number', value: 120 }, range, filters: {},
    compare: { range: { from: '2026-08-31', to: '2026-09-30' }, result: 90 }
  })
  assert.equal(result,
    'Net savings for this month (1 to 31 Oct 2026): 120.00. Compared with the previous period (31 Aug to 30 Sep 2026): 90.00; up 30.00 (33.33%).')

  const fromZero = formatAnswer({
    fn, result: { type: 'number', value: 20 }, range, filters: {},
    compare: { range: { from: '2026-08-31', to: '2026-09-30' }, result: 0 }
  })
  assert.match(fromZero, /up 20\.00\.$/)
})

test('list answers get a human heading and describe an empty list', () => {
  const fn = functionByName('biggest_losses')!
  const listed = formatAnswer({
    fn, result: { type: 'list', rows: [{ label: 'XAUUSD', value: -50 }] },
    range, filters: {}, compare: null
  })
  assert.equal(listed, 'Biggest losses for this month (1 to 31 Oct 2026): 1 result.')
  assert.equal(listed.includes('biggest_losses'), false)

  assert.equal(formatAnswer({
    fn, result: { type: 'list', rows: [] }, range, filters: {}, compare: null
  }), 'No biggest losses found for this month (1 to 31 Oct 2026).')
})

test('matched filters are described without exposing numeric identifiers', () => {
  const result = formatAnswer({
    fn: functionByName('savings_total')!,
    result: { type: 'number', value: 20 }, range,
    filters: { goal: 'Emergency Fund' }, compare: null
  })
  assert.equal(result, 'Net savings for this month (1 to 31 Oct 2026), filtered by goal "Emergency Fund": 20.00.')
})

console.log(`\n${n} assistant format checks passed`)
