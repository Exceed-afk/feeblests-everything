// Cross-module INSIGHTS: simple statistics only — no AI, no network. Pure
// functions so every number can be checked by a test. The main process fetches
// the same superset the review uses (src/main/insights.ts); this file finds the
// patterns. Nothing is stored except which insights the user dismissed.
//
// Honesty rules, enforced here rather than in the UI:
//  - MIN_DAYS: a comparison needs at least this many days on EACH side, and the
//    window must span at least MIN_WEEKS distinct habit-scheduled weeks.
//  - Wording stays descriptive ("was higher on"), never causal ("because").
//  - Every insight carries the raw numbers behind it (counts and averages, or
//    the correlation's n and r), so the reader can judge for themselves.
//
// Dates are "YYYY-MM-DD" text; weekday arithmetic is UTC, like everywhere else.
import { addDays, habitRateInRange, weekdayOf, WEEKDAY_NAMES } from './habits'
import { isAutomationEntry } from './automations'
import { localTaskDay } from './tasks'
import { round8 } from './math'
import { MOOD_SCORE } from './types'
import type { Habit, LogEntry, Mood, SavingsTx, Task, TaskCompletion, Trade } from './types'

export const MIN_DAYS = 4        // each group of a comparison needs at least this many days
export const MIN_WEEKS = 4       // the window must span at least this many distinct weeks
export const MIN_MOODS = 4       // mood correlations need at least this many logged days
export const MIN_TRADES = 5      // per weekday/mood group of the trade breakdowns
export const MIN_TASK_DAYS = 4   // days in each task-count group
export const SAME = 0.25         // differences smaller than this are reported as "about the same"

// ---------- tiny stats ----------

export const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : round8(xs.reduce((a, b) => a + b, 0) / xs.length)

// Pearson correlation of two equally long series. null when it cannot be computed
// (too few points, or zero variance on a side).
export function correlation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null
  const mx = mean(xs) as number, my = mean(ys) as number
  const dx = xs.map((x) => x - mx), dy = ys.map((y) => y - my)
  const sx = Math.sqrt(dx.reduce((a, d) => a + d * d, 0))
  const sy = Math.sqrt(dy.reduce((a, d) => a + d * d, 0))
  if (sx === 0 || sy === 0) return null
  const cov = dx.reduce((a, d, i) => a + d * dy[i], 0)
  return round8(cov / (sx * sy))
}

// ---------- day rows: what each day of the window looks like across tools ----------

export interface InsightDay {
  date: string
  habitDue: number
  habitDone: number
  mood: number | null // 1 rough to 5 great, averaged across the day's entries
  tradePnl: number // 0 when nothing closed that day
  tradeClosed: number
  savingsNet: number // deposits minus withdrawals that day
  tasksDone: number
}

export interface InsightsInput {
  today: string
  start: string // window start ("YYYY-MM-DD"), inclusive
  end: string // window end, inclusive
  habits: Habit[]
  tasks: Task[]
  completions: TaskCompletion[]
  trades: Trade[]
  txs: SavingsTx[]
  entries: LogEntry[]
}

export function buildInsightDays(i: InsightsInput): InsightDay[] {
  const days: InsightDay[] = []
  for (let d = i.start; d <= i.end; d = addDays(d, 1)) {
    const byDate = <T extends { date: string }>(rows: T[]): T[] => rows.filter((r) => r.date === d)
    const closed = byDate(i.trades).filter((t) => t.pnl !== null)
    const entries = byDate(i.entries)
    const moods = entries.filter((e) => !isAutomationEntry(e) && e.mood !== null && e.mood in MOOD_SCORE).map((e) => MOOD_SCORE[e.mood as Mood])
    days.push({
      date: d,
      habitDue: 0,
      habitDone: 0,
      mood: moods.length === 0 ? null : round8(moods.reduce((a, b) => a + b, 0) / moods.length),
      tradePnl: round8(closed.reduce((a, t) => a + (t.pnl as number), 0)),
      tradeClosed: closed.length,
      savingsNet: round8(byDate(i.txs).reduce((a, t) => a + (t.kind === 'deposit' ? t.amount : -t.amount), 0)),
      tasksDone: i.completions.filter((completion) => localTaskDay(completion.completedAt) === d).length
    })
  }
  for (const day of days) {
    for (const habit of i.habits) {
      const rate = habitRateInRange(habit, day.date, day.date, i.today)
      day.habitDue += rate.due
      day.habitDone += rate.done
    }
  }
  return days
}

// ---------- the comparisons ----------

export interface GroupStats { n: number; average: number | null }
export interface CompareInsight {
  id: string
  ok: boolean // false = not enough data yet
  needText?: string // what is missing, said plainly
  text: string // always descriptive, never causal
  a: GroupStats
  b: GroupStats
  detail: string // the numbers behind the sentence ("n days each, averages X and Y")
}

const same = (a: number | null, b: number | null): boolean =>
  a !== null && b !== null && Math.abs(a - b) < SAME

const oneDec = (n: number): string => (Math.round(n * 10) / 10).toFixed(1)

function compare(id: string, a: number[], b: number[], text: (ga: number | null, gb: number | null) => string, need: string): CompareInsight {
  const ga = mean(a), gb = mean(b)
  if (a.length < MIN_DAYS || b.length < MIN_DAYS) {
    return {
      id, ok: false, text: '', needText: need,
      a: { n: a.length, average: ga }, b: { n: b.length, average: gb },
      detail: `${a.length} and ${b.length} days so far; need at least ${MIN_DAYS} on each side.`
    }
  }
  const na = ga === null ? '-' : oneDec(ga), nb = gb === null ? '-' : oneDec(gb)
  const body = same(ga, gb)
    ? `Averages were about the same (${na} vs ${nb}).`
    : text(ga, gb)
  return {
    id, ok: true, text: body,
    a: { n: a.length, average: ga }, b: { n: b.length, average: gb },
    detail: `${a.length} days vs ${b.length} days; averages ${na} and ${nb}.`
  }
}

// Correlation-based insights carry r and n instead of two group averages.
export interface CorrelationInsight {
  id: string
  ok: boolean
  needText?: string
  text: string
  r: number | null
  n: number
  detail: string
}

function correlationInsight(id: string, xs: number[], ys: number[], need: string, label: (r: number) => string): CorrelationInsight {
  const usable = xs.map((x, i2) => ({ x, y: ys[i2] })).filter((p) => p.y !== null)
  const ux = usable.map((p) => p.x), uy = usable.map((p) => p.y)
  if (usable.length < MIN_MOODS) {
    return { id, ok: false, needText: need, text: '', r: null, n: usable.length, detail: `${usable.length} days with both numbers so far; need at least ${MIN_MOODS}.` }
  }
  const r = correlation(ux, uy)
  if (r === null) {
    return { id, ok: false, needText: 'One of the two sides does not vary yet (all days the same), so a correlation cannot be computed.', text: '', r: null, n: usable.length, detail: `${usable.length} days.` }
  }
  const strength = Math.abs(r) < 0.3 ? 'no clear link' : Math.abs(r) < 0.6 ? 'a weak link' : 'a fairly strong link'
  return { id, ok: true, text: `${label(r)} (${strength}, r = ${oneDec(r)}).`, r, n: usable.length, detail: `n = ${usable.length} days, r = ${oneDec(r)}.` }
}

// The weekday-average of habit completion per habit-scheduled day, as 7 groups.
export function habitConsistencyByWeekday(i: InsightsInput): { weekday: string; scheduled: number; done: number; rate: number | null }[] {
  const days = buildInsightDays(i).filter((d) => d.habitDue > 0)
  const byWeekday = WEEKDAY_NAMES.map((name, wd) => {
    const mine = days.filter((d) => weekdayOf(d.date) === wd)
    const scheduled = mine.reduce((a, d) => a + d.habitDue, 0)
    const done = mine.reduce((a, d) => a + d.habitDone, 0)
    return { weekday: name, scheduled, done, rate: scheduled === 0 ? null : round8((done / scheduled) * 100) }
  }).filter((r) => r.scheduled > 0)
  return byWeekday
}

export function tradePnlByWeekday(i: InsightsInput): { weekday: string; closed: number; pnl: number }[] {
  const days = buildInsightDays(i).filter((d) => d.tradeClosed > 0)
  return WEEKDAY_NAMES.map((name, wd) => {
    const mine = days.filter((d) => weekdayOf(d.date) === wd)
    return {
      weekday: name,
      closed: mine.reduce((a, d) => a + d.tradeClosed, 0),
      pnl: round8(mine.reduce((a, d) => a + d.tradePnl, 0))
    }
  }).filter((r) => r.closed > 0)
}

export function tradePnlByMood(i: InsightsInput): { mood: Mood; days: number; avgPnl: number | null }[] {
  const pairs = buildInsightDays(i).filter((d) => d.tradeClosed > 0 && d.mood !== null)
  const byMood = new Map<Mood, number[]>()
  for (const d of pairs) {
    const mood = MOODS_BY_SCORE[Math.round(d.mood as number)]
    if (!mood) continue
    byMood.set(mood, [...(byMood.get(mood) ?? []), d.tradePnl])
  }
  return [...byMood.entries()].map(([mood, pnls]) => ({ mood, days: pnls.length, avgPnl: mean(pnls) }))
}

const MOODS_BY_SCORE: Record<number, Mood> = { 1: 'rough', 2: 'low', 3: 'okay', 4: 'good', 5: 'great' }

// ---------- the insight list itself ----------

export function windowWeeks(i: InsightsInput): number {
  const days = Math.round((Date.parse(i.end) - Date.parse(i.start)) / 86_400_000) + 1
  return Math.max(1, Math.ceil(days / 7))
}

export interface InsightsResult {
  enoughData: boolean
  needText: string // said when enoughData is false
  windowDays: number
  windowWeeks: number
  comparisons: CompareInsight[]
  correlations: CorrelationInsight[]
  habitByWeekday: { weekday: string; scheduled: number; done: number; rate: number | null }[]
  tradeByWeekday: { weekday: string; closed: number; pnl: number }[]
  tradeByMood: { mood: Mood; days: number; avgPnl: number | null }[]
}

export function buildInsights(i: InsightsInput): InsightsResult {
  const days = buildInsightDays(i)
  const weeks = windowWeeks(i)
  const habitDays = days.filter((d) => d.habitDue > 0)

  // High vs low habit-completion days (top/bottom half of scheduled days by rate).
  const withRate = habitDays.map((d) => ({ ...d, rate: d.habitDone / d.habitDue }))
  const sorted = [...withRate].sort((a, b) => b.rate - a.rate)
  const half = Math.floor(sorted.length / 2)
  const high = sorted.slice(0, half).filter((d) => d.rate >= 1).map((d) => d.date)
  const low = sorted.slice(-half).filter((d) => d.rate < 1).map((d) => d.date)
  const highSet = new Set(high), lowSet = new Set(low)

  const savHigh = days.filter((d) => highSet.has(d.date) && d.savingsNet !== 0).map((d) => d.savingsNet)
  const savLow = days.filter((d) => lowSet.has(d.date) && d.savingsNet !== 0).map((d) => d.savingsNet)
  const pnlHigh = days.filter((d) => highSet.has(d.date) && d.tradeClosed > 0).map((d) => d.tradePnl)
  const pnlLow = days.filter((d) => lowSet.has(d.date) && d.tradeClosed > 0).map((d) => d.tradePnl)

  // Mood on days with more vs fewer completed tasks (top/bottom half by tasksDone).
  const withTasks = days.filter((d) => d.mood !== null)
  const taskSorted = [...withTasks].sort((a, b) => b.tasksDone - a.tasksDone)
  const th = Math.floor(taskSorted.length / 2)
  const moreTasks = taskSorted.slice(0, th).filter((d) => d.mood !== null).map((d) => d.mood as number)
  const fewerTasks = taskSorted.slice(-th).filter((d) => d.mood !== null).map((d) => d.mood as number)

  // Mood vs tasks-done correlation.
  const moodXs = days.filter((d) => d.mood !== null).map((d) => d.tasksDone)
  const moodYs = days.filter((d) => d.mood !== null).map((d) => d.mood as number)

  const comparisons: CompareInsight[] = [
    compare('savings-by-habits', savHigh, savLow,
      (a, b) => a === null || b === null ? '' : `Net savings was ${oneDec(a)} per day on your best habit days and ${oneDec(b)} on your weakest — might be a pattern.`,
      `Not enough habit-and-savings days yet: ${savHigh.length + savLow.length} so far. Log habits and savings over a few weeks.`),
    compare('trades-by-habits', pnlHigh, pnlLow,
      (a, b) => a === null || b === null ? '' : `Trading P&L averaged ${oneDec(a)} on your best habit days and ${oneDec(b)} on your weakest — might be a pattern.`,
      `Not enough habit-and-trade days yet: ${pnlHigh.length + pnlLow.length} so far. Close trades on more days with habits logged.`),
    compare('mood-by-tasks', moreTasks, fewerTasks,
      (a, b) => a === null || b === null ? '' : `Mood averaged ${oneDec(a)} of 5 on days you completed more tasks and ${oneDec(b)} of 5 on days you completed fewer — might be a pattern.`,
      `Not enough mood-and-task days yet: ${moreTasks.length + fewerTasks.length} so far. Log a mood on days with tasks completed.`)
  ]

  const correlations: CorrelationInsight[] = [
    correlationInsight('mood-vs-tasks', moodXs, moodYs,
      `Not enough days with both a mood and tasks completed yet.`,
      (r) => `Mood ${r > 0 ? 'tended to be higher' : r < 0 ? 'tended to be lower' : 'did not clearly move'} on days with more completed tasks`)
  ]

  const enoughData = weeks >= MIN_WEEKS && habitDays.length >= MIN_DAYS
  return {
    enoughData,
    needText: enoughData ? '' : `Not enough history yet: this window covers ${weeks} week${weeks === 1 ? '' : 's'} with ${habitDays.length} habit days. Log habits for at least ${MIN_WEEKS} weeks and comparisons will start appearing.`,
    windowDays: days.length,
    windowWeeks: weeks,
    comparisons, correlations,
    habitByWeekday: habitConsistencyByWeekday(i),
    tradeByWeekday: tradePnlByWeekday(i),
    tradeByMood: tradePnlByMood(i)
  }
}
