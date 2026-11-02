// The weekly summary: one pure, offline snapshot of LAST week (Monday to
// Sunday). It deliberately reuses the assistant's own number rules (the same
// function table and range helpers), so the briefing card and an assistant
// answer can never disagree about the same week.
//
// Nothing here touches a database, Electron or React; the caller hands the
// rows in. Dates are local "YYYY-MM-DD" text. Nothing is stored — the card is
// computed on demand, and "Save to Logbook" (the renderer) creates an ordinary
// entry, never an automation draft.
import { functionByName, previousRange, resolveRange, type AssistantRows, type DateRange, type RangeSpec } from './assistant'
import { round8 } from './math'

export type WeeklyFunctionName = 'savings_total' | 'trade_pnl' | 'habit_completion_rate' | 'tasks_completed' | 'mood_average' | 'journal_entries'

// The functions the weekly summary reports, in card order.
export const WEEKLY_FUNCTIONS: WeeklyFunctionName[] = [
  'savings_total', 'trade_pnl', 'habit_completion_rate', 'tasks_completed', 'mood_average', 'journal_entries'
]

export interface WeeklyLine {
  function: WeeklyFunctionName
  label: string // the shared label from the function table ("net savings", ...)
  unit: string // the shared unit ('money' | 'percent' | 'count' | 'score')
  value: number
  previous: number | null // the week before, when its range was computable
}

export interface WeeklySummary {
  weekStart: string
  weekEnd: string
  range: DateRange
  lines: WeeklyLine[]
  totalLogged: boolean // false = nothing at all was logged last week
}

// Last week is symbolic; resolveRange turns it into Monday-to-Sunday dates,
// so the summary can never disagree with an assistant answer about the week.
export function lastWeekSpec(): RangeSpec {
  return { kind: 'last_week' }
}

const runFunction = (
  name: WeeklyFunctionName,
  rows: AssistantRows,
  range: DateRange,
  today: string
): number => {
  const fn = functionByName(name)
  if (!fn) return 0
  const result = fn.run(rows, range, today, {}, undefined)
  return result.type === 'number' ? result.value : result.rows.reduce((sum, row) => sum + row.value, 0)
}

export function buildWeeklySummary(rows: AssistantRows, week: 'last_week', today: string): WeeklySummary {
  const range = resolveRange(lastWeekSpec(), today)
  const prev = previousRange(range)
  void week // kept in the signature so a future 'this_week' variant slots in

  const lines: WeeklyLine[] = WEEKLY_FUNCTIONS.map((name) => {
    const fn = functionByName(name)
    return {
      function: name,
      label: fn?.label ?? name,
      unit: fn?.unit ?? 'count',
      value: runFunction(name, rows, range, today),
      previous: runFunction(name, rows, prev, today)
    }
  })

  const totalLogged = lines.some((line) => line.value !== 0)
  return {
    weekStart: range.from,
    weekEnd: range.to,
    range,
    lines: lines.map((line) => ({ ...line, value: round8(line.value), previous: line.previous === null ? null : round8(line.previous) })),
    totalLogged
  }
}

// One plain sentence per line, for the briefing card and a saved entry body.
export function weeklyLineText(line: WeeklyLine): string {
  const fmt = (n: number): string => {
    if (line.unit === 'money') return n.toFixed(2)
    if (line.unit === 'percent') return `${String(Number(n.toFixed(2)))}%`
    if (line.unit === 'score') return `${String(Number(n.toFixed(2)))} of 5`
    return String(Number(n.toFixed(2)))
  }
  if (line.previous === null) return `${line.label}: ${fmt(line.value)}`
  const diff = round8(line.value - line.previous)
  if (diff === 0) return `${line.label}: ${fmt(line.value)} (same as the week before)`
  const direction = diff > 0 ? 'up' : 'down'
  return `${line.label}: ${fmt(line.value)} (${direction} ${fmt(Math.abs(diff))} from the week before)`
}

export const weeklySummaryText = (summary: WeeklySummary): string =>
  [`Last week (${summary.weekStart} to ${summary.weekEnd}):`,
  ...(summary.totalLogged ? summary.lines.map(weeklyLineText) : ['Nothing logged.'])].join('\n')
