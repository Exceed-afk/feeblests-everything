import assert from 'node:assert/strict'
import { functionByName, matchFilters, type AssistantRows } from '../src/shared/assistant'
import type { Habit, SavingsGoal, SavingsTx, Task, Trade } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const goal: SavingsGoal = {
  id: 8, name: 'Emergency Fund', target: 1000, notes: '', balance: 0, txCount: 0, createdAt: '', updatedAt: ''
}
const tx = (goalId: number, amount: number): SavingsTx => ({
  id: amount, goalId, date: '2026-10-10', kind: 'deposit', amount, note: '', createdAt: '', updatedAt: ''
})
const trade = (id: number, asset: string, pnl: number, direction: 'long' | 'short', tags: string[]): Trade => ({
  id, date: '2026-10-10', asset, direction, entryPrice: 1, exitPrice: 2, quantity: 1, fees: 0,
  notes: '', tags, pnl, createdAt: '', updatedAt: ''
})
const task = (id: number, project: string | null, tags: string[]): Task => ({
  id, title: 'Task', notes: '', status: 'done', priority: 'medium', dueDate: null, dueTime: null,
  createdAt: '', completedAt: '2026-10-10T12:00:00.000Z', deletedAt: null, project, tags,
  position: 0, recurrenceRule: null, recurrenceNext: null, subtasks: []
})
const habit: Habit = {
  id: 12, name: 'Reading', notes: '', days: [0, 1, 2, 3, 4, 5, 6], archived: false,
  startDate: '2026-10-01', checkins: ['2026-10-10'],
  stats: { current: 0, best: 0, rate30: null, total: 1 }, createdAt: '', updatedAt: ''
}
const rows: AssistantRows = {
  txs: [tx(goal.id, 100), tx(9, 50)],
  goals: [goal],
  trades: [
    trade(1, 'XAUUSD', 25, 'long', ['gold']),
    trade(2, 'EURUSD', -10, 'short', ['forex'])
  ],
  habits: [habit],
  tasks: [task(4, 'Work', ['planning'])],
  completions: [{ taskId: 4, completedAt: '2026-10-10T12:00:00.000Z' }],
  entries: [
    { id: 1, date: '2026-10-10', title: '', body: '', mood: 'good', tags: ['Trading'], createdAt: '', updatedAt: '' },
    { id: 2, date: '2026-10-10', title: '', body: '', mood: 'rough', tags: ['personal'], createdAt: '', updatedAt: '' }
  ]
}
const month = { from: '2026-10-01', to: '2026-10-31' }

test('asset names match case-insensitively without revealing the asset list', () => {
  const result = matchFilters(rows, 'trade_pnl', { asset: 'xauusd' })
  assert.deepEqual(result, {
    ok: true,
    filters: { asset: 'XAUUSD' },
    disclosure: { sent: { asset: 'xauusd' }, matched: { asset: 'XAUUSD' }, ignored: [] },
    warning: null
  })
})

test('an unknown asset returns a local not-found message', () => {
  assert.deepEqual(matchFilters(rows, 'trade_pnl', { asset: 'gold' }), {
    ok: false,
    error: 'I couldn\'t find an asset called "gold".'
  })
})

test('a filter unsupported by the selected function is ignored with an explicit note', () => {
  const result = matchFilters(rows, 'trade_pnl', { project: 'Work' })
  assert.ok(result.ok)
  if (!result.ok) return
  assert.deepEqual(result.filters, {})
  assert.deepEqual(result.disclosure.ignored, ['project'])
  assert.equal(result.warning, 'Note: I ignored unsupported filters: project.')
})

test('trade filters apply the matched asset, direction and tag locally', () => {
  const matched = matchFilters(rows, 'trade_pnl', { asset: 'xauusd', direction: 'LONG', tag: 'GOLD' })
  assert.ok(matched.ok)
  if (!matched.ok) return
  assert.deepEqual(matched.filters, { asset: 'XAUUSD', direction: 'long', tag: 'gold' })
  assert.deepEqual(functionByName('trade_pnl')!.run(rows, month, undefined, matched.filters), { type: 'number', value: 25 })
})

test('goal and habit filters resolve to local identifiers and select only the matching record', () => {
  const selectedGoal = matchFilters(rows, 'savings_total', { goal: 'emergency fund' })
  assert.ok(selectedGoal.ok)
  if (!selectedGoal.ok) return
  assert.deepEqual(selectedGoal.filters, { goal: goal.id })
  assert.deepEqual(selectedGoal.disclosure.matched, { goal: 'Emergency Fund' })
  assert.deepEqual(functionByName('savings_total')!.run(rows, month, undefined, selectedGoal.filters), { type: 'number', value: 100 })

  const selectedHabit = matchFilters(rows, 'habit_completion_rate', { habit: 'reading' })
  assert.ok(selectedHabit.ok)
  if (!selectedHabit.ok) return
  assert.deepEqual(selectedHabit.filters, { habit: habit.id })
  assert.deepEqual(functionByName('habit_completion_rate')!.run(rows, month, '2026-10-23', selectedHabit.filters), { type: 'number', value: 4.54545455 })
})

test('task and journal tag filters match locally', () => {
  const project = matchFilters(rows, 'tasks_completed', { project: 'work', tag: 'PLANNING' })
  assert.ok(project.ok)
  if (!project.ok) return
  assert.deepEqual(project.filters, { project: 'Work', tag: 'planning' })
  assert.deepEqual(functionByName('tasks_completed')!.run(rows, month, undefined, project.filters), { type: 'number', value: 1 })
  const journal = matchFilters(rows, 'mood_average', { tag: 'trading' })
  assert.ok(journal.ok)
  if (!journal.ok) return
  assert.deepEqual(journal.filters, { tag: 'Trading' })
  assert.deepEqual(functionByName('mood_average')!.run(rows, month, undefined, journal.filters), { type: 'number', value: 4 })
})

test('filter inputs must be non-empty strings with known names', () => {
  for (const filters of [{ asset: '' }, { asset: 5 }, { unknown: 'value' }]) {
    assert.equal(matchFilters(rows, 'trade_pnl', filters as never).ok, false)
  }
})

console.log(`\n${n} assistant filter checks passed`)
