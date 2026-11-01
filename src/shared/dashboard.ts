import { getDayStatus, isHabitDue } from './habits'
import type { Habit, HabitCompletion, HabitsToday } from './types'

// A habit's recorded days. Older data (and the test fixtures) may only have
// the list of done dates; the rules fall back to that, so nothing breaks.
const completionsOf = (h: Habit): HabitCompletion[] =>
  h.completions ?? h.checkins.map((date) => ({ date, status: 'done' as const }))

// Dashboard math that does not touch the database, so it is easy to test.

// "2026-03-01" -> "2026-02-28". Works in UTC so daylight-saving changes never matter.
export function prevDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

// How many days in a row have a logbook entry, counting back from today.
// If today has no entry yet, the streak is still alive: it counts back from
// yesterday, so it does not show 0 first thing in the morning.
export function logStreak(entryDates: string[], today: string): number {
  const days = new Set(entryDates)
  let day = days.has(today) ? today : prevDay(today)
  let streak = 0
  while (days.has(day)) { streak++; day = prevDay(day) }
  return streak
}

// The "Habits today" tile. Archived habits are ignored. Habits not scheduled today are not
// listed or counted as due, but their running streak still counts toward the longest streak.
// Unfinished habits come first so the tile shows what is left to do.
export function habitsToday(habits: Habit[], today: string): HabitsToday {
  const active = habits.filter((h) => !h.archived)
  const items = active
    // The same due-day rule as the Habits page, so the two never disagree.
    .filter((h) => isHabitDue(h, today))
    // "Done" also follows the shared rules, so a count or duration habit
    // ("read 10 minutes") only counts when the target was reached.
    .map((h) => ({
      id: h.id, name: h.name,
      done: getDayStatus({ days: h.days, startDate: h.startDate, type: h.type, target: h.target },
        today, completionsOf(h), today) === 'done',
      streak: h.stats.current
    }))
    .sort((a, b) => Number(a.done) - Number(b.done))
  // The three best current streaks, biggest first. The streak itself comes
  // from habit.stats, computed by the SAME helpers the Habits page uses, so
  // the two places can never disagree about a number.
  const topStreaks = active
    .filter((h) => h.stats.current > 0)
    .sort((a, b) => b.stats.current - a.stats.current || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((h) => ({ id: h.id, name: h.name, current: h.stats.current }))
  return {
    total: active.length,
    due: items.length,
    done: items.filter((i) => i.done).length,
    longestStreak: Math.max(0, ...topStreaks.map((s) => s.current)),
    topStreaks,
    items
  }
}
