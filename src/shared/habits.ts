// Habit rules as plain functions (no database, no Electron), used by the main
// process and the UI. Dates are "YYYY-MM-DD" text; the arithmetic below works
// on the calendar date itself, so time zones and daylight saving cannot shift it.
import type { HabitStats } from './types'

export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
export const WEEKDAYS_ONLY = [0, 1, 2, 3, 4]

const DAY_MS = 86_400_000
const toUtc = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export const addDays = (iso: string, n: number): string => new Date(toUtc(iso) + n * DAY_MS).toISOString().slice(0, 10)

// Monday = 0 ... Sunday = 6
export const weekdayOf = (iso: string): number => (new Date(toUtc(iso)).getUTCDay() + 6) % 7

export const isScheduled = (days: number[], iso: string): boolean => days.includes(weekdayOf(iso))

export function scheduleLabel(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b)
  if (sorted.length === 7) return 'Every day'
  if (sorted.join() === WEEKDAYS_ONLY.join()) return 'Weekdays'
  if (sorted.join() === '5,6') return 'Weekends'
  return sorted.map((d) => WEEKDAY_NAMES[d]).join(', ')
}

const MAX_DAYS = 3660 // look back at most ten years

// Rules:
//  - Only scheduled days count. Rest days never break a streak.
//  - A scheduled day that has passed without a check-in breaks it.
//  - Today, if still unchecked, does NOT break it (the day is not over).
//  - A check-in on a rest day is a bonus: it counts in the total only.
//  - Days before the habit existed are not counted as missed.
export function computeHabitStats(habit: { days: number[]; startDate: string }, checkins: string[], today: string): HabitStats {
  const done = new Set(checkins)
  const first = [habit.startDate, ...checkins].sort()[0]
  const span = Math.min(MAX_DAYS, Math.round((toUtc(today) - toUtc(first)) / DAY_MS))
  const windowStart = addDays(today, -29)

  let run = 0, best = 0, due = 0, hit = 0
  for (let i = span; i >= 0; i--) { // oldest day first, ending today
    const d = addDays(today, -i)
    if (!isScheduled(habit.days, d)) continue
    if (done.has(d)) {
      run++
      best = Math.max(best, run)
      if (d >= windowStart) { due++; hit++ }
    } else if (d !== today) {
      run = 0
      if (d >= windowStart) due++
    }
  }
  return { current: run, best, rate30: due > 0 ? (hit / due) * 100 : null, total: done.size }
}
