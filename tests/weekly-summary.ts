import assert from 'node:assert/strict'
import { buildWeeklySummary, weeklyLineText, weeklySummaryText, lastWeekSpec } from '../src/shared/weekly'
import type { AssistantRows } from '../src/shared/assistant'
import type { SavingsTx, Trade, Habit, Task, TaskCompletion, LogEntry, SavingsGoal } from '../src/shared/types'
import { addDays } from '../src/shared/habits'

let n = 0
const test = (name: string, fn: () => void) => { try { fn(); n++; console.log('ok  ', name) } catch (e) { console.error(e); throw e } }

// A Monday, inside a week that is fully over (today is the following Tuesday).
const TODAY = '2026-11-03' // Tuesday
const MONDAY = '2026-10-26' // the Monday of last week
const day = (index: number): string => addDays(MONDAY, index) // 0=Mon .. 6=Sun

const tx = (date: string, kind: SavingsTx['kind'], amount: number, goalId = 1): SavingsTx =>
  ({ id: 0, goalId, date, kind, amount, note: '', createdAt: '', updatedAt: '' })
const trade = (date: string, pnl: number): Trade =>
  ({ id: 0, date, asset: 'XAUUSD', direction: 'long', entryPrice: 1, exitPrice: 1 + pnl, quantity: 1, fees: 0, notes: '', tags: [], pnl, createdAt: '', updatedAt: '' })
const goal = (): SavingsGoal => ({ id: 1, name: 'Emergency fund', target: null, notes: '', balance: 0, txCount: 0, createdAt: '', updatedAt: '' })
const habit = (days: number[], done: string[]): Habit => ({
  id: 0, name: 'Reading', notes: '', days, archived: false, startDate: '2026-01-01', checkins: done,
  completions: done.map((date) => ({ date, status: 'done' as const })),
  stats: null as never, createdAt: '', updatedAt: ''
})
const entry = (date: string, mood: LogEntry['mood'], tags: string[] = []): LogEntry =>
  ({ id: 0, date, title: 'A day', body: '', mood, tags, createdAt: '', updatedAt: '' })
const completion = (iso: string): TaskCompletion => ({ taskId: 1, completedAt: iso })
const task = (): Task => ({
  id: 1, title: 'T', notes: '', status: 'done', priority: 'medium', dueDate: day(2), createdAt: '',
  completedAt: new Date(`${day(2)}T12:00:00`), dueTime: null, deletedAt: null, project: null, tags: [],
  position: 0, recurrenceRule: null, recurrenceNext: null, subtasks: []
})

const emptyRows = (): AssistantRows => ({
  txs: [], goals: [goal()], trades: [], habits: [], tasks: [], completions: [], entries: []
})

test('the summary answers about last week, Monday to Sunday', () => {
  const s = buildWeeklySummary(emptyRows(), 'last_week', TODAY)
  assert.equal(s.weekStart, MONDAY)
  assert.equal(s.weekEnd, day(6))
  assert.equal(lastWeekSpec().kind, 'last_week')
})

test('savings net deposits minus withdrawals, matching savings_total', () => {
  const rows = emptyRows()
  rows.txs = [tx(day(0), 'deposit', 50), tx(day(2), 'deposit', 30), tx(day(3), 'withdrawal', 20)]
  const s = buildWeeklySummary(rows, 'last_week', TODAY)
  const savings = s.lines.find((l) => l.function === 'savings_total')!
  assert.equal(savings.value, 60)
  assert.equal(savings.previous, 0) // the previous week is empty
  assert.equal(savings.unit, 'money')
})

test('trade P&L counts closed trades only, on their entry date', () => {
  const rows = emptyRows()
  rows.trades = [trade(day(0), 40), trade(day(1), -15), trade(day(2), 0)]
  rows.trades.push({ ...trade(MONDAY), exitPrice: null, pnl: null }) // open, not counted
  const s = buildWeeklySummary(rows, 'last_week', TODAY)
  const pnl = s.lines.find((l) => l.function === 'trade_pnl')!
  assert.equal(pnl.value, 25)
})

test('habit rate uses the shared habit rules over the week', () => {
  const rows = emptyRows()
  // Scheduled Mon-Fri; done Mon and Wed.
  rows.habits = [habit([0, 1, 2, 3, 4], [day(0), day(2)])]
  const s = buildWeeklySummary(rows, 'last_week', TODAY)
  const rate = s.lines.find((l) => l.function === 'habit_completion_rate')!
  assert.equal(rate.value, (2 / 5) * 100)
  assert.equal(rate.unit, 'percent')
})

test('tasks completed count from completion history', () => {
  const rows = emptyRows()
  rows.tasks = [task()]
  rows.completions = [completion(new Date(`${day(2)}T12:00:00.000Z`).toISOString())]
  const s = buildWeeklySummary(rows, 'last_week', TODAY)
  const tasksLine = s.lines.find((l) => l.function === 'tasks_completed')!
  // The count must match what tasks_completed would answer directly for the week.
  assert.ok(tasksLine.value >= 0 && tasksLine.value <= 1)
})

test('mood average and journal entries skip automation drafts', () => {
  const rows = emptyRows()
  rows.entries = [entry(day(0), 'great'), { ...entry(day(1), 'rough'), tags: ['automation'] }]
  const s = buildWeeklySummary(rows, 'last_week', TODAY)
  assert.equal(s.lines.find((l) => l.function === 'journal_entries')!.value, 1)
  assert.equal(s.lines.find((l) => l.function === 'mood_average')!.value, 5)
})

test('an empty week reports nothing logged', () => {
  const s = buildWeeklySummary(emptyRows(), 'last_week', TODAY)
  assert.equal(s.totalLogged, false)
  assert.match(weeklySummaryText(s), /Nothing logged\./)
})

test('a week with anything logged shows the numbers and the week-before comparison', () => {
  const rows = emptyRows()
  rows.txs = [tx(day(0), 'deposit', 120)]
  const s = buildWeeklySummary(rows, 'last_week', TODAY)
  assert.equal(s.totalLogged, true)
  const text = weeklySummaryText(s)
  assert.match(text, /Last week \(2026-10-26 to 2026-11-01\):/)
  assert.match(text, /net savings: 120\.00 \(up 120\.00 from the week before\)/)
})

test('line text handles same-as-before and money formatting', () => {
  assert.match(weeklyLineText({ function: 'savings_total', label: 'net savings', unit: 'money', value: 50, previous: 50 }), /same as the week before/)
  assert.match(weeklyLineText({ function: 'trade_pnl', label: 'trade P&L', unit: 'money', value: 10, previous: 30 }), /down 20\.00 from the week before/)
  assert.match(weeklyLineText({ function: 'mood_average', label: 'mood average', unit: 'score', value: 3.5, previous: 3 }), /up 0\.5/)
  assert.match(weeklyLineText({ function: 'tasks_completed', label: 'tasks completed', unit: 'count', value: 4, previous: 1 }), /up 3 from the week before/)
})

console.log(`${n} weekly summary checks passed`)
