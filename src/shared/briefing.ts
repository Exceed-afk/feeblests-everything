// The daily briefing's rules, with no database, no Electron and no React: the page hands the
// data in, this returns the sections out. Every section is null when it has nothing to show,
// so the UI can simply hide them. Dates are "YYYY-MM-DD" text and are never converted with
// Date parsing other than through the UTC helpers below, so time zones cannot shift a day.
// Nothing here is stored, and nothing touches the network.
import { round8 } from './math'
import { computeHabitStats, isScheduled, scheduleLabel } from './habits'
import { progressPercent } from './savings'
import { prevDay } from './dashboard'
import { taskWeekStart, addTaskDays } from './tasks'
import { MOODS, MOOD_SCORE } from './types'
import type { AutomationActivity } from './automations'
import type {
  Habit, LogEntry, Mood, SavingsGoal, SavingsTx, Task, Trade
} from './types'

// ---------- The sections the page shows ----------

export interface BriefingTaskItem { id: number; title: string; priority: Task['priority']; dueDate: string }

export interface BriefingTasks {
  due: BriefingTaskItem[]       // active tasks whose due date is today, highest priority first
  overdue: BriefingTaskItem[]   // active tasks whose due date is before today, oldest first
  doneThisWeek: { id: number; title: string }[] // tasks completed in this Monday-to-Sunday week
}

export interface BriefingHabitItem { id: number; name: string; done: boolean; schedule: string; current: number; rate30: number | null }

export interface BriefingHabits {
  total: number               // active habits (scheduled or not)
  due: number                 // of those, how many are scheduled today
  done: number                // of those, checked off already
  label: string               // "2 of 5 done" for the heading
  items: BriefingHabitItem[]  // scheduled today, unfinished first
}

export interface BriefingGoal { goalId: number; name: string; balance: number; target: number | null; percent: number | null }

export interface BriefingSavings {
  goals: BriefingGoal[]
  totalBalance: number
  lastDeposit: { goalName: string; amount: number; date: string } | null // most recent deposit up to today
}

export interface BriefingTrades {
  open: Trade[]                 // trades with no exit price, newest first
  yesterdayResult: { pnl: number; count: number } | null // closed trades dated yesterday, null when none
}

export interface BriefingJournal {
  yesterdayMood: { mood: Mood; average: number; date: string } | null
  lastEntry: { id: number; title: string; date: string; mood: Mood | null } | null
}

export interface DailyBriefing {
  today: string
  summary: string   // one line at the top, assembled from simple rules
  tasks: BriefingTasks | null
  habits: BriefingHabits | null
  savings: BriefingSavings | null
  trades: BriefingTrades | null
  journal: BriefingJournal | null
  automations: AutomationActivity[] // what the automations did recently, newest first (may be empty)
  staleOverdueTasks: { id: number; title: string; daysOverdue: number }[] // surfaced by the overdue rule
}

// ---------- helpers ----------

const toUtc = (iso: string): number => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const localDay = (isoTimestamp: string | null): string | null => {
  if (!isoTimestamp) return null
  const date = new Date(isoTimestamp)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const fmtAmount = (n: number): string => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Nearest mood word to a 1-5 average (same rule the calendar uses).
export const moodNear = (average: number): Mood => {
  let best = MOODS[0]
  for (const m of MOODS) if (Math.abs(MOOD_SCORE[m] - average) < Math.abs(MOOD_SCORE[best] - average)) best = m
  return best
}

// ---------- sections (each exported so a test can call one directly) ----------

const PRIORITY_RANK: Record<Task['priority'], number> = { high: 0, medium: 1, low: 2 }

export function tasksToday(tasks: Task[], today: string): BriefingTasks | null {
  const weekStart = taskWeekStart(today)
  const weekEnd = addTaskDays(weekStart, 6)
  const item = (t: Task): BriefingTaskItem => ({ id: t.id, title: t.title, priority: t.priority, dueDate: t.dueDate ?? '' })
  const active = tasks.filter((t) => t.status !== 'done')
  const due = active.filter((t) => t.dueDate === today).sort((a, b) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.id - b.id).map(item)
  const overdue = active.filter((t) => t.dueDate !== null && t.dueDate < today)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.id - b.id).map(item)
  const doneThisWeek = tasks.filter((t) => {
    if (t.status !== 'done') return false
    const day = localDay(t.completedAt)
    return day !== null && day >= weekStart && day <= weekEnd
  }).map((t) => ({ id: t.id, title: t.title }))
  if (due.length === 0 && overdue.length === 0 && doneThisWeek.length === 0) return null
  return { due, overdue, doneThisWeek }
}

export function habitsToday(habits: Habit[], today: string): BriefingHabits | null {
  const active = habits.filter((h) => !h.archived)
  if (active.length === 0) return null
  const items = active
    .filter((h) => isScheduled(h.days, today))
    .map((h) => ({
      id: h.id, name: h.name, done: h.checkins.includes(today),
      schedule: scheduleLabel(h.days),
      current: h.stats?.current ?? computeHabitStats(h, h.checkins, today).current,
      rate30: h.stats?.rate30 ?? computeHabitStats(h, h.checkins, today).rate30
    }))
    .sort((a, b) => Number(a.done) - Number(b.done) || a.name.localeCompare(b.name))
  const done = items.filter((i) => i.done).length
  return {
    total: active.length,
    due: items.length,
    done,
    label: items.length === 0 ? `${active.length} habit${active.length === 1 ? '' : 's'}, none due today` : `${done} of ${items.length} done`,
    items
  }
}

export function savingsToday(goals: SavingsGoal[], txs: SavingsTx[], today: string): BriefingSavings | null {
  if (goals.length === 0) return null
  const nameOf = new Map(goals.map((g) => [g.id, g.name]))
  const deposits = txs.filter((t) => t.kind === 'deposit' && t.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  const last = deposits[0]
  return {
    goals: goals.map((g) => ({
      goalId: g.id, name: g.name, balance: g.balance, target: g.target,
      percent: progressPercent(g.balance, g.target) === null ? null : Math.floor(progressPercent(g.balance, g.target) as number)
    })),
    totalBalance: round8(goals.reduce((sum, g) => sum + g.balance, 0)),
    lastDeposit: last ? { goalName: nameOf.get(last.goalId) ?? 'a goal', amount: last.amount, date: last.date } : null
  }
}

export function tradesToday(trades: Trade[], today: string): BriefingTrades | null {
  const yesterday = prevDay(today)
  const open = trades.filter((t) => t.pnl === null)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  const closedYesterday = trades.filter((t) => t.date === yesterday && t.pnl !== null)
  const yesterdayResult = closedYesterday.length === 0 ? null : {
    pnl: round8(closedYesterday.reduce((sum, t) => sum + (t.pnl as number), 0)),
    count: closedYesterday.length
  }
  if (open.length === 0 && yesterdayResult === null) return null
  return { open, yesterdayResult }
}

export function journalToday(entries: LogEntry[], today: string): BriefingJournal | null {
  const yesterday = prevDay(today)
  const yesterdayEntries = entries.filter((e) => e.date === yesterday && e.mood !== null && e.mood in MOOD_SCORE)
  let yesterdayMood: BriefingJournal['yesterdayMood'] = null
  if (yesterdayEntries.length > 0) {
    const average = yesterdayEntries.reduce((sum, e) => sum + MOOD_SCORE[e.mood as Mood], 0) / yesterdayEntries.length
    yesterdayMood = { mood: moodNear(round8(average)), average: round8(average), date: yesterday }
  }
  const written = entries.filter((e) => e.date <= today).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  const last = written[0]
  const lastEntry = last ? { id: last.id, title: last.title, date: last.date, mood: last.mood } : null
  if (yesterdayMood === null && lastEntry === null) return null
  return { yesterdayMood, lastEntry }
}

// ---------- the one-line summary at the top ----------

export function briefingSummary(b: Pick<DailyBriefing, 'tasks' | 'habits' | 'savings' | 'trades' | 'journal'>): string {
  const parts: string[] = []
  if (b.tasks) {
    const { due, overdue } = b.tasks
    if (due.length > 0 && overdue.length > 0) {
      parts.push(`${due.length} task${due.length === 1 ? '' : 's'} due and ${overdue.length} overdue`)
    } else if (due.length > 0) {
      parts.push(`${due.length} task${due.length === 1 ? '' : 's'} due today`)
    } else if (overdue.length > 0) {
      parts.push(`${overdue.length} overdue task${overdue.length === 1 ? '' : 's'}`)
    }
  }
  if (b.habits && b.habits.due > 0 && b.habits.done < b.habits.due) {
    parts.push(`${b.habits.due - b.habits.done} habit${b.habits.due - b.habits.done === 1 ? '' : 's'} left today`)
  }
  if (b.trades) {
    if (b.trades.open.length > 0) parts.push(`${b.trades.open.length} open trade${b.trades.open.length === 1 ? '' : 's'}`)
    else if (b.trades.yesterdayResult) {
      const r = b.trades.yesterdayResult
      parts.push(`Yesterday's ${r.count === 1 ? 'trade' : `${r.count} trades`} closed ${fmtAmount(Math.abs(r.pnl))} ${r.pnl < 0 ? 'down' : 'up'}`)
    }
  }
  if (b.journal?.yesterdayMood) parts.push(`Yesterday was "${b.journal.yesterdayMood.mood}"`)
  else if (b.journal?.lastEntry) parts.push(`Last entry ${b.journal.lastEntry.date}`)
  if (b.savings) {
    const deposit = b.savings.lastDeposit
    parts.push(`${fmtAmount(b.savings.totalBalance)} across ${b.savings.goals.length} goal${b.savings.goals.length === 1 ? '' : 's'}`
      + (deposit ? `, last deposit ${fmtAmount(deposit.amount)}` : ''))
  }
  if (parts.length === 0) return 'No tasks due today · No journal entries yet'
  return parts.join(' · ')
}

// ---------- the whole briefing ----------

export interface BriefingInput {
  today: string
  tasks: Task[]
  habits: Habit[]
  goals: SavingsGoal[]
  txs: SavingsTx[]
  trades: Trade[]
  entries: LogEntry[]
  automations?: AutomationActivity[]
  overdueDays?: number
} 

export function buildBriefing(input: BriefingInput): DailyBriefing {
  const { today, tasks, habits, goals, txs, trades, entries } = input
  const b = {
    tasks: tasksToday(tasks, today),
    habits: habitsToday(habits, today),
    savings: savingsToday(goals, txs, today),
    trades: tradesToday(trades, today),
    journal: journalToday(entries, today)
  }
  // The overdue rule surfaces stale tasks in the briefing when it is on and set.
  const overdueDays = input.overdueDays ?? 7
  const active = tasks.filter((t) => t.status !== 'done' && t.dueDate !== null && t.dueDate < today)
  const staleOverdueTasks = active
    .map((t) => ({ id: t.id, title: t.title, daysOverdue: Math.round((toUtc(today) - toUtc(t.dueDate as string)) / 86_400_000) }))
    .filter((t) => t.daysOverdue > overdueDays)
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
  return {
    today, ...b, automations: input.automations ?? [], staleOverdueTasks,
    summary: briefingSummary(b)
  }
}

// ---------- test builders (only used by tests; keeps them short) ----------

export type EntryBuilder = (date: string, mood: Mood | null, title?: string) => LogEntry
export type TradeBuilder = (date: string, entry: number, exit: number | null) => Trade
export type GoalBuilder = (name: string, target?: number | null) => SavingsGoal
export type TxBuilder = (goal: SavingsGoal, date: string, kind: 'deposit' | 'withdrawal', amount: number) => SavingsTx
export type HabitBuilder = (name: string, days: number[], checkins: string[], start?: string) => Habit
export type TaskBuilder = (id: number, createdAt: string, completedAt: string | null, dueDate?: string | null, status?: Task['status'], priority?: Task['priority']) => Task
export type TestBuilders = { entry: EntryBuilder; trade: TradeBuilder; goal: GoalBuilder; tx: TxBuilder; habit: HabitBuilder; task: TaskBuilder }

export const testBuilders = (startId = 1): TestBuilders => {
  let id = startId
  return {
    entry: (date, mood, title = 'A day'): LogEntry => ({ id: id++, date, title, body: '', mood, tags: [], createdAt: '', updatedAt: '' }),
    trade: (date, entryPrice, exit): Trade => {
      const base = { date, asset: 'XAUUSD', direction: 'long' as const, entryPrice, exitPrice: exit, quantity: 1, fees: 0, notes: '', tags: [] }
      const move = exit === null ? null : base.direction === 'long' ? exit - entryPrice : entryPrice - exit
      return { id: id++, ...base, pnl: move, createdAt: '', updatedAt: '' }
    },
    goal: (name, target = null): SavingsGoal => ({ id: id++, name, target, notes: '', balance: 0, txCount: 0, createdAt: '', updatedAt: '' }),
    tx: (goal, date, kind, amount): SavingsTx => ({ id: id++, goalId: goal.id, date, kind, amount, note: '', createdAt: '', updatedAt: '' }),
    habit: (name, days, checkins, start = '2026-09-01'): Habit => ({
      id: id++, name, notes: '', days, archived: false, startDate: start, checkins,
      stats: computeHabitStats({ days, startDate: start }, checkins, checkins[checkins.length - 1] ?? '2026-09-01'),
      createdAt: '', updatedAt: ''
    }),
    task: (id_, createdAt, completedAt, dueDate = null, status: Task['status'] = 'todo', priority: Task['priority'] = 'medium'): Task => ({
      id: id_, title: `Task ${id_}`, notes: '', status, priority, dueDate, createdAt, completedAt,
      dueTime: null, deletedAt: null, project: null, tags: [], position: id_, recurrenceRule: null, recurrenceNext: null, subtasks: []
    })
  }
}

export const toUtcMs = toUtc
export const fmtAmountForTests = fmtAmount
