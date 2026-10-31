// The arithmetic behind the small charts, as plain functions (no React, no DOM), so tests/charts.ts can check it.
// The components in components/Charts.tsx only draw what comes out of here.
import type { ReviewTrades, ReviewHabits, ReviewMood } from '../../../shared/types'
import { round8 } from '../../../shared/format'

// ---------- Trading chart ----------

// What the Trading card can draw from the SAME per-day figures the review already calculates:
//   pnl         that day's closed trades
//   cumulative  the running total up to and including that day (the period always starts at 0)
//   count       how many trades closed that day
export type TradeView = 'pnl' | 'cumulative' | 'count'

export interface Bar {
  date: string
  value: number
  // 0 = no closed trades that day. Kept apart from a zero result (a trade that broke even) so an empty day
  // is never drawn as a flat result and a flat result never looks like an empty day.
  closed: number
}

export function tradeBars(days: ReviewTrades['days'], view: TradeView): Bar[] {
  let running = 0
  return days.map((d) => {
    running = round8(running + d.pnl)
    const value = view === 'pnl' ? d.pnl : view === 'cumulative' ? running : d.closed
    return { date: d.date, value, closed: d.closed }
  })
}

// Cumulative P&L has nothing above or below zero on purpose: it shows a path, not gains against losses.
export const barTone = (b: Bar, view: TradeView): 'pos' | 'neg' | 'muted' => {
  if (b.value === 0) return 'muted'
  if (view === 'count') return b.value > 0 ? 'pos' : 'muted'
  return b.value > 0 ? 'pos' : 'neg'
}

// "Daily P&L", "Cumulative", "Trades"
export const TRADE_VIEW_LABEL: Record<TradeView, string> = { pnl: 'Daily P&L', cumulative: 'Cumulative', count: 'Trades' }

// ---------- Sparkline ----------

// A line through the values, normalised to a 0..1 box (y grows downward). A flat line sits in the middle.
// Returns an SVG path string. `values` shorter than 2 gives "".
export function sparkPath(values: (number | null)[], width: number, height: number): string {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null)
  if (pts.length < 2) return ''
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v))
  const span = hi - lo // 0 when every value is the same: then y() puts the line in the middle
  const x = (i: number) => (values.length === 1 ? width / 2 : (i / (values.length - 1)) * width)
  const y = (v: number) => (span === 0 ? height / 2 : height - ((v - lo) / span) * height)
  return pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')
}

// ---------- Mood trend ----------

// One point per logged day (null = nothing logged; the line simply does not pass through it, so a missing day is
// never treated as a bad one). Scaled to the fixed 1..5 mood scale so the height means the same every period.
export function moodPoints(days: ReviewMood['days'], width: number, height: number): { date: string; average: number; x: number; y: number }[] {
  const logged = days.map((d, i) => ({ ...d, i })).filter((d): d is (typeof days[number] & { average: number; i: number }) => d.average !== null)
  return logged.map((d) => ({
    date: d.date,
    average: d.average,
    x: days.length === 1 ? width / 2 : (d.i / (days.length - 1)) * width,
    y: height - ((d.average - 1) / 4) * height
  }))
}

// ---------- Habits strip ----------

// done / partial / missed / rest / future / today-pending, decided in one place so the Review card and any other
// page agree. `today` is the main process's date (the same one the review used).
export type DayState = 'done' | 'partial' | 'missed' | 'rest' | 'future' | 'pending'
export function habitDayState(d: ReviewHabits['days'][number], today: string): DayState {
  if (d.date > today) return 'future'
  if (d.due === 0) return 'rest'
  if (d.done === d.due) return 'done'
  if (d.date === today && d.done === 0) return 'pending'
  return d.done > 0 ? 'partial' : 'missed'
}
