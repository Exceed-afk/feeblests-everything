import { isScheduled } from './habits'
import type { Habit, HabitsToday } from './types'

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
    .filter((h) => isScheduled(h.days, today))
    .map((h) => ({ id: h.id, name: h.name, done: h.checkins.includes(today), streak: h.stats.current }))
    .sort((a, b) => Number(a.done) - Number(b.done))
  return {
    total: active.length,
    due: items.length,
    done: items.filter((i) => i.done).length,
    longestStreak: active.reduce((m, h) => Math.max(m, h.stats.current), 0),
    items
  }
}
