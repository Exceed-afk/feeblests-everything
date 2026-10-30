// Summarized data from each tool for a date range, used by every later intelligence feature.
// Pure functions only: no database, no Electron, no React. The main process fetches rows
// (src/main/insightsData.ts); this file turns them into summaries. Nothing here is stored.
//
// Dates are "YYYY-MM-DD" text and the arithmetic works on the calendar date itself (UTC), so time
// zones and daylight saving cannot shift a day.
import { addDays, isScheduled, weekdayOf } from './habits'
import { round8 } from './math'
import { signedAmount } from './savings'
import { computeStats } from './trades'
import { taskReview } from './tasks'
import { MOOD_SCORE, MOODS } from './types'
import type {
  Habit, LogEntry, Mood, SavingsGoal, SavingsTx, Trade, Task, TxKind
} from './types'

// ---------- helpers ----------

const parts = (iso: string): [number, number, number] => {
  const [y, m, d] = iso.split('-').map(Number)
  return [y, m, d]
}
const inRange = (date: string, start: string, end: string): boolean => date >= start && date <= end

interface DateRange { start: string; end: string }

// ---------- Trade P&L ----------

export interface TradeSummary {
  stats: ReturnType<typeof computeStats> // over trades dated inside the range (entry date, like the P&L curve)
  byDay: { date: string; pnl: number; closed: number }[]
  // Trades that were open at the start of the range and are still open at the end (so the UI can
  // surface "you had N open trades the whole period"). A trade is "open all period" when its entry
  // is before the range starts and it has no exit, or it was entered inside the range and is still open.
  carriedOverOpen: number
}

function tradesSummary(trades: Trade[], range: DateRange, prev: DateRange): TradeSummary {
  const mine = trades.filter((t) => inRange(t.date, range.start, range.end))
  const prevMine = trades.filter((t) => inRange(t.date, prev.start, prev.end))
  const byDay = new Map<string, { pnl: number; closed: number }>()
  for (const t of mine) {
    if (t.pnl === null) continue
    const day = byDay.get(t.date) ?? { pnl: 0, closed: 0 }
    byDay.set(t.date, { pnl: round8(day.pnl + t.pnl), closed: day.closed + 1 })
  }
  // Open trades carried across the whole range (entered before and still open, or entered inside and still open).
  const carriedOverOpen = trades.filter((t) => t.pnl === null && t.date <= range.end).length
  return {
    stats: computeStats(mine),
    byDay: Array.from(byDay.entries()).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
    carriedOverOpen
  }
}

// ---------- Savings movement and goal progress ----------

export interface SavingsSummary {
  deposits: number
  withdrawals: number
  net: number // deposits - withdrawals
  txCount: number
  startBalance: number // all goals together, before the range
  endBalance: number // all goals together, at the end of the range
  goals: SavingsGoalMovement[]
}

export interface SavingsGoalMovement {
  goalId: number
  name: string
  deposits: number
  withdrawals: number
  net: number
  startBalance: number
  endBalance: number
  target: number | null
  reached: boolean // crossed its target during this range
  daysToTarget: number | null // estimated calendar days from endBalance to target at the net rate, null when net <= 0 or no target
}

interface GoalAcc { start: number; end: number; deposits: number; withdrawals: number; count: number }

function savingsSummary(goals: SavingsGoal[], txs: SavingsTx[], range: DateRange, prev: DateRange): SavingsSummary {
  const acc = new Map<number, GoalAcc>(goals.map((g) => [g.id, { start: 0, end: 0, deposits: 0, withdrawals: 0, count: 0 }]))
  let previousNet = 0
  for (const t of txs) {
    const a = acc.get(t.goalId)
    if (!a) continue // a transaction of a goal that no longer exists
    const signed = signedAmount(t.kind, t.amount)
    if (t.date < range.start) a.start += signed
    if (t.date <= range.end) a.end += signed
    if (inRange(t.date, range.start, range.end)) {
      if (t.kind === 'deposit') a.deposits += t.amount
      else a.withdrawals += t.amount
      a.count++
    }
    if (inRange(t.date, prev.start, prev.end)) previousNet += signed
  }
  const rows: SavingsGoalMovement[] = []
  let deposits = 0, withdrawals = 0, count = 0, startBalance = 0, endBalance = 0
  for (const g of goals) {
    const a = acc.get(g.id) as GoalAcc
    deposits += a.deposits; withdrawals += a.withdrawals; count += a.count
    startBalance += a.start; endBalance += a.end
    if (a.count === 0) continue
    const start = round8(a.start), end = round8(a.end)
    const net = round8(a.deposits - a.withdrawals)
    // Estimated days to target: if the goal is moving toward its target at this period's net rate.
    let daysToTarget: number | null = null
    if (g.target !== null && end < g.target && net > 0) {
      daysToTarget = Math.ceil((g.target - end) / net)
    }
    rows.push({
      goalId: g.id, name: g.name,
      deposits: round8(a.deposits), withdrawals: round8(a.withdrawals), net,
      startBalance: start, endBalance: end, target: g.target,
      reached: g.target !== null && start < g.target && end >= g.target,
      daysToTarget
    })
  }
  rows.sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.name.localeCompare(b.name))
  return {
    deposits: round8(deposits), withdrawals: round8(withdrawals), net: round8(deposits - withdrawals), txCount: count,
    startBalance: round8(startBalance), endBalance: round8(endBalance), goals: rows
  }
}

// ---------- Habit completion ----------

export interface HabitsSummary {
  due: number // scheduled days that have passed
  done: number // of those, checked off
  rate: number | null // % done, null when nothing was due
  bonus: number // check-ins on rest days
  habits: HabitCompletion[]
  byDay: { date: string; due: number; done: number }[]
}

export interface HabitCompletion {
  id: number
  name: string
  due: number
  done: number
  rate: number | null
  bonus: number
  missed: string[]
}

interface HabitPeriod { rows: HabitCompletion[]; byDay: Map<string, { due: number; done: number }>; due: number; done: number; bonus: number }

function habitPeriod(habits: Habit[], range: DateRange, today: string): HabitPeriod {
  const last = range.end < today ? range.end : today // nothing after today has happened yet
  const byDay = new Map<string, { due: number; done: number }>()
  const rows: HabitCompletion[] = []
  let due = 0, done = 0, bonus = 0
  for (const h of habits) {
    if (h.archived) continue
    const checked = new Set(h.checkins)
    const first = [h.startDate, ...h.checkins].sort()[0]
    const from = range.start > first ? range.start : first
    const missed: string[] = []
    let hDue = 0, hDone = 0, hBonus = 0
    for (let d = from; d <= last; d = addDays(d, 1)) {
      const scheduled = isScheduled(h.days, d)
      if (checked.has(d)) {
        if (scheduled) { hDue++; hDone++; tally(byDay, d, true) } else hBonus++
      } else if (scheduled && d !== today) {
        hDue++; missed.push(d); tally(byDay, d, false)
      }
    }
    due += hDue; done += hDone; bonus += hBonus
    if (hDue > 0 || hBonus > 0) {
      rows.push({ id: h.id, name: h.name, due: hDue, done: hDone, rate: hDue > 0 ? (hDone / hDue) * 100 : null, bonus: hBonus, missed })
    }
  }
  rows.sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || a.name.localeCompare(b.name))
  return { rows, byDay, due, done, bonus }
}

function tally(byDay: Map<string, { due: number; done: number }>, date: string, done: boolean): void {
  const d = byDay.get(date) ?? { due: 0, done: 0 }
  d.due++
  if (done) d.done++
  byDay.set(date, d)
}

const rateOf = (done: number, due: number): number | null => (due > 0 ? (done / due) * 100 : null)

function habitsSummary(habits: Habit[], range: DateRange, prev: DateRange, today: string, days: string[]): HabitsSummary {
  const now = habitPeriod(habits, range, today)
  const before = habitPeriod(habits, prev, today)
  return {
    due: now.due, done: now.done, rate: rateOf(now.done, now.due), bonus: now.bonus,
    habits: now.rows,
    byDay: days.map((date) => ({ date, ...(now.byDay.get(date) ?? { due: 0, done: 0 }) }))
  }
}

// ---------- Tasks due / completed / overdue ----------

export interface TasksSummary {
  created: number // tasks created in the range
  completed: number // tasks completed in the range
  dueToday: number // active tasks due today
  overdue: number // active tasks overdue (due before today, not done)
  completedThisWeek: number // tasks completed in the Monday-to-Sunday week containing today
}

function tasksSummary(tasks: Task[], range: DateRange, today: string): TasksSummary {
  const weekStart = taskWeekStart(today)
  const weekEnd = addDays(weekStart, 6)
  const active = tasks.filter((task) => task.status !== 'done')
  const dueToday = active.filter((task) => task.dueDate === today).length
  const overdue = active.filter((task) => task.dueDate !== null && task.dueDate < today).length
  const completedThisWeek = tasks.filter((task) => {
    if (task.status !== 'done') return false
    const day = localDay(task.completedAt)
    return day !== null && day >= weekStart && day <= weekEnd
  }).length
  return {
    ...taskReview(tasks, range.start, range.end),
    dueToday, overdue, completedThisWeek
  }
}

function localDay(isoTimestamp: string | null): string | null {
  if (!isoTimestamp) return null
  const date = new Date(isoTimestamp)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function taskWeekStart(date: string): string {
  const [y, m, d] = parts(date)
  const day = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
  // Use addDays from habits which works correctly in UTC
  const DAY_MS = 86_400_000
  const toUtc = (iso: string): number => { const [a, b, c] = parts(iso); return Date.UTC(a, b - 1, c) }
  const fromUtc = (n: number): string => new Date(n).toISOString().slice(0, 10)
  return fromUtc(toUtc(date) - day * DAY_MS)
}

// ---------- Journal mood ----------

export interface MoodSummary {
  logged: number // entries with a mood in the range
  average: number | null // 1 (rough) to 5 (great)
  counts: Record<Mood, number>
  byDay: { date: string; average: number | null }[]
  lowest: { date: string; mood: Mood } | null // the worst day, only when it was low or rough
  trend: 'up' | 'down' | 'steady' | null // second half of the range against the first; null = too little data
}

function moodSummary(entries: LogEntry[], range: DateRange, prev: DateRange, days: string[]): MoodSummary {
  const withMood = (from: string, to: string) =>
    entries.filter((e) => e.mood !== null && e.mood in MOOD_SCORE && inRange(e.date, from, to))
  const mine = withMood(range.start, range.end)
  const before = withMood(prev.start, prev.end)
  const counts = Object.fromEntries(MOODS.map((m) => [m, 0])) as Record<Mood, number>
  const perDay = new Map<string, number[]>()
  for (const e of mine) {
    counts[e.mood as Mood]++
    perDay.set(e.date, [...(perDay.get(e.date) ?? []), MOOD_SCORE[e.mood as Mood]])
  }
  const byDay = days.map((date) => ({ date, average: perDay.has(date) ? (perDay.get(date) as number[]).reduce((a, b) => a + b, 0) / (perDay.get(date) as number[]).length : null }))
  const series = byDay.filter((d): d is { date: string; average: number } => d.average !== null)

  const worst = [...mine].sort((a, b) => MOOD_SCORE[a.mood as Mood] - MOOD_SCORE[b.mood as Mood] || a.date.localeCompare(b.date))[0]
  const lowest = worst && MOOD_SCORE[worst.mood as Mood] <= 2 ? { date: worst.date, mood: worst.mood as Mood } : null

  let trend: MoodSummary['trend'] = null
  if (series.length >= 4) {
    const half = Math.floor(series.length / 2)
    const diff = series.slice(-half).map((d) => d.average).reduce((a, b) => a + b, 0) / half
      - series.slice(0, half).map((d) => d.average).reduce((a, b) => a + b, 0) / half
    trend = diff >= 0.5 ? 'up' : diff <= -0.5 ? 'down' : 'steady'
  }
  return {
    logged: mine.length,
    average: mine.length ? mine.map((e) => MOOD_SCORE[e.mood as Mood]).reduce((a, b) => a + b, 0) / mine.length : null,
    counts,
    byDay,
    lowest,
    trend
  }
}// ---------- Range helpers (mirror review.ts) ----------
export function buildRange(kind: 'week' | 'month', anchor: string): DateRange {
  if (kind === 'week') {
    const start = addDays(anchor, -weekdayOf(anchor))
    return { start, end: addDays(start, 6) }
  }
  const [y, m] = parts(anchor)
  // day 0 of next month = last day of this one (same trick as review.ts)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return { start, end }
}

// ---------- The whole intelligence data snapshot ----------

export interface IntelligenceData {
  kind: 'week' | 'month'
  start: string
  end: string
  trades: TradeSummary
  savings: SavingsSummary
  habits: HabitsSummary
  tasks: TasksSummary
  mood: MoodSummary
}

function shiftRange(kind: 'week' | 'month', range: DateRange, delta: number): DateRange {
  if (kind === 'week') return buildRange('week', addDays(range.start, 7 * delta))
  const [y, m] = parts(range.start)
  const newM = m + delta
  const newY = newM < 1 ? y - 1 : newM > 12 ? y + 1 : y
  const adjM = ((newM - 1) % 12 + 12) % 12 + 1
  return buildRange('month', `${newY}-${String(adjM).padStart(2, '0')}-01`)
}
export function buildIntelligenceData(input: {
  kind: 'week' | 'month'
  anchor: string
  today: string
  trades: Trade[]
  goals: SavingsGoal[]
  txs: SavingsTx[]
  habits: Habit[]
  tasks: Task[]
  entries: LogEntry[]
}): IntelligenceData {
  const range = buildRange(input.kind, input.anchor)
  const prev = shiftRange(input.kind, range, -1)
  const days: string[] = []
  for (let d = range.start; d <= range.end && days.length < 366; d = addDays(d, 1)) days.push(d)

  return {
    kind: input.kind,
    start: range.start,
    end: range.end,
    trades: tradesSummary(input.trades, range, prev),
    savings: savingsSummary(input.goals, input.txs, range, prev),
    habits: habitsSummary(input.habits, range, prev, input.today, days),
    tasks: tasksSummary(input.tasks, range, input.today),
    mood: moodSummary(input.entries, range, prev, days)
  }
}
