// The calendar as plain functions (no database, no Electron, no React), so every number on it can be tested.
// The main process only FETCHES rows (src/main/calendar.ts); buildCalendar() lays them out on a month grid.
// Weeks run Monday to Sunday, like the Habits page and the Review. Dates are "YYYY-MM-DD" text and all the arithmetic
// is on the calendar date itself, so time zones and daylight saving cannot move a day.
import { addDays, isScheduled, weekdayOf, WEEKDAY_NAMES } from './habits'
import { isAutomationEntry } from './automations'
import { round8 } from './math'
import { MOOD_SCORE } from './review'
import { signedAmount } from './savings'
import { MOODS } from './types'
import type {
  CalendarData, CalendarDay, CalendarHabitItem, CalendarSummary, Habit, LogEntry, Mood, SavingsTxHit, Trade
} from './types'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3))

// ---------- Months ----------

export const isMonth = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)

const ymd = (y: number, m: number, d: number): string => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)
const partsOf = (month: string): [number, number] => { const [y, m] = month.split('-').map(Number); return [y, m] }

export const monthOf = (date: string): string => date.slice(0, 7)
export const monthLabel = (month: string): string => { const [y, m] = partsOf(month); return `${MONTHS[m - 1]} ${y}` }

// The month `delta` steps away; rolls over the year in both directions.
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = partsOf(month)
  return ymd(y, m + delta, 1).slice(0, 7)
}

export function monthRange(month: string): { first: string; last: string } {
  const [y, m] = partsOf(month)
  return { first: ymd(y, m, 1), last: ymd(y, m + 1, 0) } // day 0 of the next month is the last day of this one
}

// The first Monday on or before the 1st, and the last Sunday on or after the last day: the whole grid.
export function gridRange(month: string): { start: string; end: string } {
  const { first, last } = monthRange(month)
  return { start: addDays(first, -weekdayOf(first)), end: addDays(last, 6 - weekdayOf(last)) }
}

// ---------- Words ----------

const two = (n: number): string => n.toFixed(2)
const signed = (n: number): string => `${n > 0 ? '+' : n < 0 ? '-' : ''}${two(Math.abs(n))}`
const plural = (n: number, word: string, many = `${word}s`): string => `${n} ${n === 1 ? word : many}`

// "Tue 27 Oct"
export function dayName(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return `${WEEKDAY_NAMES[weekdayOf(date)]} ${d} ${MONTHS_SHORT[m - 1]}`
}

export const moodFromAverage = (average: number): Mood => MOODS.find((m) => MOOD_SCORE[m] === Math.round(average)) ?? 'okay'

// One line for a screen reader or a tooltip: "Tue 27 Oct: 2 entries, 1 closed trade (+39.00), savings +50.00, habits 3 of 4 done".
export function describeDay(d: CalendarDay): string {
  const bits: string[] = []
  if (d.entries.length) bits.push(plural(d.entries.length, 'entry', 'entries'))
  if (d.closed) bits.push(`${plural(d.closed, 'closed trade')} (${signed(d.pnl)})`)
  if (d.open) bits.push(`${d.open} open`)
  if (d.txs.length) bits.push(`savings ${signed(d.savingsNet)}`)
  const h = d.habits
  const counted = h.done + h.missed + h.pending
  if (counted) bits.push(`habits ${h.done} of ${counted} done`)
  if (d.mood) bits.push(`mood ${d.mood}`)
  return `${dayName(d.date)}${d.isToday ? ' (today)' : ''}: ${bits.length ? bits.join(', ') : 'nothing logged'}`
}

// ---------- The grid ----------

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

// What each habit did on each day. The same rules as the Habits page and the Review: only scheduled days count, days before the
// habit existed are not missed, today is "pending" (not missed) until it is done, a check-in on a rest day is a "bonus",
// archived habits are ignored, and days that have not happened yet show nothing.
function habitItems(habits: Habit[], date: string, today: string): CalendarHabitItem[] {
  if (date > today) return []
  const items: CalendarHabitItem[] = []
  for (const h of habits) {
    if (h.archived) continue
    const first = [h.startDate, ...h.checkins].sort()[0]
    if (date < first) continue
    const done = h.checkins.includes(date)
    const scheduled = isScheduled(h.days, date)
    if (done) items.push({ id: h.id, name: h.name, status: scheduled ? 'done' : 'bonus' })
    else if (scheduled) items.push({ id: h.id, name: h.name, status: date === today ? 'pending' : 'missed' })
  }
  return items.sort((a, b) => a.name.localeCompare(b.name))
}

export interface CalendarInput {
  month: string // "YYYY-MM"
  today: string
  entries: LogEntry[] // any superset: only those dated on the grid are used
  trades: Trade[]
  txs: SavingsTxHit[]
  habits: Habit[] // with every check-in
}

export function buildCalendar(i: CalendarInput): CalendarData {
  const { first, last } = monthRange(i.month)
  const grid = gridRange(i.month)

  const group = <T extends { date: string }>(rows: T[]): Map<string, T[]> => {
    const m = new Map<string, T[]>()
    for (const r of rows) if (r.date >= grid.start && r.date <= grid.end) m.set(r.date, [...(m.get(r.date) ?? []), r])
    return m
  }
  const entriesBy = group(i.entries), tradesBy = group(i.trades), txsBy = group(i.txs)

  const days: CalendarDay[] = []
  for (let date = grid.start; date <= grid.end; date = addDays(date, 1)) {
    const entries = (entriesBy.get(date) ?? []).sort((a, b) => b.id - a.id)
    const writtenEntries = entries.filter((e) => !isAutomationEntry(e))
    const scores = writtenEntries.filter((e) => e.mood !== null && e.mood in MOOD_SCORE).map((e) => MOOD_SCORE[e.mood as Mood])
    const moodAverage = scores.length ? mean(scores) : null
    const trades = (tradesBy.get(date) ?? []).sort((a, b) => a.id - b.id)
    const closed = trades.filter((t) => t.pnl !== null)
    const txs = (txsBy.get(date) ?? []).sort((a, b) => a.id - b.id)
    const items = habitItems(i.habits, date, i.today)
    const count = (s: CalendarHabitItem['status']): number => items.filter((x) => x.status === s).length
    days.push({
      date, inMonth: date >= first && date <= last, isToday: date === i.today, isFuture: date > i.today,
      entries, mood: moodAverage === null ? null : moodFromAverage(moodAverage), moodAverage,
      trades, closed: closed.length, open: trades.length - closed.length,
      pnl: round8(closed.reduce((a, t) => a + (t.pnl as number), 0)),
      txs, savingsNet: round8(txs.reduce((a, t) => a + signedAmount(t.kind, t.amount), 0)),
      habits: { done: count('done'), missed: count('missed'), pending: count('pending'), bonus: count('bonus'), items }
    })
  }

  const weeks: CalendarDay[][] = []
  for (let k = 0; k < days.length; k += 7) weeks.push(days.slice(k, k + 7))

  return {
    month: i.month, label: monthLabel(i.month), prevMonth: shiftMonth(i.month, -1), nextMonth: shiftMonth(i.month, 1),
    first, last, weeks, summary: summarize(days.filter((d) => d.inMonth))
  }
}

function summarize(days: CalendarDay[]): CalendarSummary {
  let done = 0, missed = 0
  const scores: number[] = []
  for (const d of days) {
    done += d.habits.done; missed += d.habits.missed
    for (const e of d.entries) if (!isAutomationEntry(e) && e.mood !== null && e.mood in MOOD_SCORE) scores.push(MOOD_SCORE[e.mood])
  }
  return {
    entries: days.reduce((a, d) => a + d.entries.filter((e) => !isAutomationEntry(e)).length, 0),
    daysWritten: days.filter((d) => d.entries.some((e) => !isAutomationEntry(e))).length,
    closed: days.reduce((a, d) => a + d.closed, 0),
    open: days.reduce((a, d) => a + d.open, 0),
    pnl: round8(days.reduce((a, d) => a + d.pnl, 0)),
    savingsNet: round8(days.reduce((a, d) => a + d.savingsNet, 0)),
    habitRate: done + missed > 0 ? (done / (done + missed)) * 100 : null,
    moodAverage: scores.length ? mean(scores) : null
  }
}
