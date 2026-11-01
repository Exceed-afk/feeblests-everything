// Habit rules as plain functions (no database, no Electron), used by the main
// process and the UI. Dates are "YYYY-MM-DD" text; the arithmetic below works
// on the calendar date itself, so time zones and daylight saving cannot shift it.
import { round8 } from './math'
import type { HabitStats, TimeOfDay } from './types'

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

// ---------- Phase 1: the due-day and streak rules ----------
//
// These are the single source of truth for "is this habit due on this day?"
// and "what state is this day in?". Both the Habits page and the Review
// page use them, so the two screens can never disagree.

// The minimum a habit needs for the due-day rules: when is it scheduled?
export interface HabitSchedule {
  days: number[] // the days it is scheduled: 0 = Monday ... 6 = Sunday
  startDate?: string // "YYYY-MM-DD"; days before this are not tracked at all
}

// The kinds of habit there are.
//   'check'    = a yes/no habit: you either did it or you did not
//   'count'    = you do it a number of times (3 sessions, 2 workouts, ...)
//   'duration' = you do it for a length of time (10 minutes, 30 minutes, ...)
export type HabitType = 'check' | 'count' | 'duration'

// One completion record for a habit on a day.
//   status 'done'    = the habit was completed
//   status 'skipped' = deliberately skipped (sick day, travel, ...)
// "missed" and "rest" are NEVER stored: they are derived from the rules below.
export interface HabitCompletion {
  date: string // "YYYY-MM-DD"
  status: 'done' | 'skipped'
  // How much was logged on this day (for 'count' and 'duration' habits).
  // Undefined for a plain 'check' habit, and for a 'done' day with no number.
  value?: number
}

// The state of one day for one habit.
export type DayStatus = 'done' | 'missed' | 'rest' | 'skipped' | 'future' | 'pending'

// Everything the rules need to know about a habit's KIND, not just its schedule.
// A plain 'check' habit has no target, so any recorded day counts as done.
export interface HabitRules extends HabitSchedule {
  type?: HabitType // 'check' (the default) | 'count' | 'duration'
  target?: number | null // how much is enough; only used by 'count' and 'duration'
  unit?: string // the label for that number ("sessions", "min", ...)
}

// How much was logged on one day. A day with no record has a value of 0.
export function loggedValue(completion: HabitCompletion | undefined): number {
  if (!completion) return 0
  return completion.value ?? 0
}

// Did this day reach the habit's target?
//
//   - a 'check' habit is done when there is a record at all
//   - a 'count' or 'duration' habit is done when the logged value is at least
//     the target. Below the target the day is NOT done, so it still counts as
//     a miss for a day that has passed.
//   - a habit with no target is treated as a 'check' habit, so nothing breaks.
export function reachedTarget(habit: HabitRules, completion: HabitCompletion | undefined): boolean {
  if (!completion) return false
  if (completion.status === 'skipped') return false
  const type = habit.type ?? 'check'
  if (type === 'check') return true
  if (!habit.target || habit.target <= 0) return true // no target set: a record is enough
  return loggedValue(completion) >= habit.target
}

// Is the habit supposed to happen on this date?
// Days before the habit's start date are not due (they are not tracked yet).
// `startDate` can be given explicitly; by default the habit's own start date
// is used. The streak helpers pass the EFFECTIVE start date here, which is the
// earlier of the habit's start date and its first completion - checking a
// habit in before it was created means tracking really started then.
export function isHabitDue(habit: HabitSchedule, date: string, startDate?: string): boolean {
  if (!isScheduled(habit.days, date)) return false
  const from = startDate ?? habit.startDate
  if (from && date < from) return false
  return true
}

// What state is this day in?
//   future  = the day has not happened yet
//   done    = completed (and, for a count/duration habit, the target was reached)
//   skipped = deliberately skipped (does not break a streak)
//   rest    = not scheduled (does not break a streak)
//   pending = due today, not done yet (the day is not over)
//   missed  = due, in the past, and not done
export function getDayStatus(
  habit: HabitRules,
  date: string,
  completions: HabitCompletion[],
  today: string,
  startDate?: string // the EFFECTIVE start date; defaults to the habit's own one
): DayStatus {
  if (date > today) return 'future'

  // A day that was not due is a rest day, whatever was recorded for it.
  // A check-in on a rest day is a bonus: it counts in the total, but never
  // in a streak or a rate, because the habit was not supposed to happen.
  if (!isHabitDue(habit, date, startDate)) return 'rest'

  const completion = completions.find((c) => c.date === date)
  if (completion) {
    if (completion.status === 'skipped') return 'skipped'
    // For a count/duration habit, a value below the target is not a done day.
    if (reachedTarget(habit, completion)) return 'done'
    // Below the target: the day is still open if it is today, otherwise it missed.
    if (date === today) return 'pending'
    return 'missed'
  }

  if (date === today) return 'pending'
  return 'missed'
}

// The first day we need to look at: the habit's start date, or an earlier
// completion (some habits were checked off before they were created).
// This is the EFFECTIVE start: tracking really began on the earlier day.
function trackingStart(habit: HabitSchedule, completions: HabitCompletion[]): string | null {
  const starts: string[] = []
  if (habit.startDate) starts.push(habit.startDate)
  for (const c of completions) starts.push(c.date)
  if (starts.length === 0) return null
  return starts.sort()[0]
}

// Walk the days from today back to the start, newest first.
// This is the shared engine behind the current streak, the best streak and
// the completion rate, so all three always use exactly the same rules.
//
// Walking BACKWARDS from today is deliberate: it always includes today, and it
// cannot be thrown off by a habit that was created a very long time ago.
// The look-back is capped so an old habit cannot make the app slow.
function walkDays(
  habit: HabitRules,
  completions: HabitCompletion[],
  today: string,
  onDay: (status: DayStatus, date: string) => void
): void {
  const start = trackingStart(habit, completions)
  if (!start) return
  if (start > today) return

  const MAX_DAYS = 3660 // look back at most ten years
  const effectiveStart = start
  let cursor = today
  let guard = 0
  while (cursor >= effectiveStart && guard < MAX_DAYS) {
    const status = getDayStatus(habit, cursor, completions, today, effectiveStart)
    onDay(status, cursor)
    cursor = addDays(cursor, -1)
    guard++
  }
}

// The current streak: the run of completed due days that reaches today.
// A rest day or a skipped day in the middle does not break the run.
// Today being not done yet does not break it either (the day is not over).
export function calculateCurrentStreak(
  habit: HabitRules,
  completions: HabitCompletion[],
  today: string
): number {
  let streak = 0
  let stopped = false
  // walkDays goes newest first, so the first days we meet are the ones that
  // matter most. The first 'missed' due day ends the streak.
  walkDays(habit, completions, today, (status) => {
    if (stopped) return
    if (status === 'done') {
      streak++
      return
    }
    // A rest day, a skipped day and today still being open all leave the
    // run untouched.
    if (status === 'rest' || status === 'skipped' || status === 'pending' || status === 'future') return
    stopped = true // 'missed' ends the run
  })
  return streak
}

// The longest run of completed due days ever.
// `today` is the day to measure up to; days after it cannot have happened.
export function calculateBestStreak(
  habit: HabitRules,
  completions: HabitCompletion[],
  today: string
): number {
  let run = 0
  let best = 0
  // walkDays goes newest first, so a run is built up as we walk back and it
  // ends when we meet a missed due day.
  walkDays(habit, completions, today, (status) => {
    if (status === 'done') {
      run++
      if (run > best) best = run
    } else if (status === 'missed') {
      run = 0
    }
    // rest, skipped and future do not change the run
  })
  return best
}

// The share of due days that were completed, as a percentage (0-100).
// Only days the habit was DUE on are counted; rest days are ignored.
// `days` is how many calendar days back to look (30 for the 30-day rate).
export function calculateCompletionRate(
  habit: HabitRules,
  completions: HabitCompletion[],
  days: number,
  today: string
): number {
  const windowStart = addDays(today, -(days - 1))
  let due = 0
  let hit = 0
  walkDays(habit, completions, today, (status, date) => {
    if (date < windowStart) return
    // Only due days count towards the rate. A skipped day was due, so it is
    // in the denominator but not in the numerator.
    if (status === 'done') { due++; hit++ }
    else if (status === 'missed' || status === 'skipped') { due++ }
    // 'rest' was never due, so it is left out entirely.
  })
  if (due === 0) return 0
  return round8((hit / due) * 100)
}

export function scheduleLabel(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b)
  if (sorted.length === 7) return 'Every day'
  if (sorted.join() === WEEKDAYS_ONLY.join()) return 'Weekdays'
  if (sorted.join() === '5,6') return 'Weekends'
  return sorted.map((d) => WEEKDAY_NAMES[d]).join(', ')
}

// ---------- Phase 4: habit types (check, count, duration) ----------

// The label that goes with each kind of habit, and the word used for it.
export const HABIT_TYPE_LABELS: Record<HabitType, string> = {
  check: 'Check off',
  count: 'Count',
  duration: 'Duration'
}

// What a number means for each kind of habit.
export const HABIT_TYPE_UNITS: Record<HabitType, string> = {
  check: '',
  count: 'times',
  duration: 'min'
}

// The default unit for a kind of habit. A duration habit reads best in
// minutes, a count habit in "times".
export function defaultUnit(type: HabitType): string {
  return HABIT_TYPE_UNITS[type]
}

// A sensible default target for each kind of habit.
export function defaultTarget(type: HabitType): number | null {
  if (type === 'duration') return 10
  if (type === 'count') return 1
  return null // a check habit has no target
}

// Works out what kind of habit a name suggests, so "Read for 10mn" starts life
// as a duration habit instead of a plain check.
// The patterns are deliberately simple and only look for a NUMBER next to a
// time word, which is the common case.
export function guessHabitType(name: string): HabitType {
  const text = name.toLowerCase()
  // "10 minutes", "30 min", "1 hour" -> a duration habit.
  const hasTime = /\b(\d+(?:\.\d+)?)\s*(min|mins|minute|minutes|mn|hour|hours|hr|hrs)\b/.test(text)
  if (hasTime) return 'duration'
  // "3 times", "2 sessions", "4 reps" -> a count habit.
  const hasCount = /\b(\d+)\s*(times|sessions?|reps?|sets?|cups?|glasses?|pages?)\b/.test(text)
  if (hasCount) return 'count'
  return 'check'
}

// Works out the target and unit from a habit name, when the name says so.
// "Read for 10mn" -> target 10, unit "min".
// "3 sessions"    -> target 3, unit "sessions".
// Returns nulls when the name does not say.
export function guessHabitTarget(name: string): { target: number | null; unit: string } {
  const text = name.toLowerCase()
  const time = text.match(/\b(\d+(?:\.\d+)?)\s*(min|mins|minute|minutes|mn|hour|hours|hr|hrs)\b/)
  if (time) {
    const amount = Number(time[1])
    const word = time[2]
    // Hours become minutes, so the number is always in the same unit.
    const isHour = word.startsWith('h')
    return { target: isHour ? amount * 60 : amount, unit: 'min' }
  }
  const count = text.match(/\b(\d+)\s*(times|sessions?|reps?|sets?|cups?|glasses?|pages?)\b/)
  if (count) {
    return { target: Number(count[1]), unit: singularUnit(count[2]) }
  }
  return { target: null, unit: '' }
}

// Turns a plural word into its singular form, so "8 glasses" reads as
// "8 glass" rather than "8 glasse".
function singularUnit(word: string): string {
  if (word === 'times') return 'time'
  if (word.endsWith('ses')) return word.slice(0, -2) // sessions -> session
  if (word.endsWith('s')) return word.slice(0, -1) // cups -> cup, pages -> page
  return word
}

// How much of a habit is done today, as a short text like "6 / 10 min".
// For a plain check habit there is nothing to show, so it returns null.
export function progressText(
  habit: HabitRules,
  completion: HabitCompletion | undefined,
  unit?: string
): string | null {
  const type = habit.type ?? 'check'
  if (type === 'check') return null
  const label = unit ?? habit.unit ?? defaultUnit(type)
  const value = loggedValue(completion)
  if (!habit.target) {
    // No target yet: just show what was logged.
    return label ? `${value} ${label}` : String(value)
  }
  return label ? `${value} / ${habit.target} ${label}` : `${value} / ${habit.target}`
}

// The quick + and - buttons around the value input. They step by a sensible
// amount for the habit's type.
export function stepSize(habit: HabitRules): number {
  const type = habit.type ?? 'check'
  if (type === 'duration') return 5 // five minutes at a time
  return 1 // one session at a time
}

// The old entry point, still used by the main process and the Review page.
// It now simply calls the helpers above, so the Habits page, the Review page
// and the Dashboard can never disagree about a streak.
//
// Note the small differences to the old version:
//  - a check-in on a rest day no longer counts as a "missed" day, and
//  - the 30-day rate counts only days the habit was actually due.
//
// This version only knows about the DONE days, so a skipped day is invisible
// to it. Use computeHabitStatsFromCompletions when the skipped days are known.
export function computeHabitStats(habit: HabitRules & { startDate: string }, checkins: string[], today: string): HabitStats {
  const completions: HabitCompletion[] = checkins.map((date) => ({ date, status: 'done' }))
  return computeHabitStatsFromCompletions(habit, completions, today)
}

// The same, but with the full list of recorded days, so a SKIPPED day is
// known and does not look like a missed one.
export function computeHabitStatsFromCompletions(
  habit: HabitRules & { startDate: string },
  completions: HabitCompletion[],
  today: string
): HabitStats {
  const current = calculateCurrentStreak(habit, completions, today)
  const best = calculateBestStreak(habit, completions, today)

  // The rate is null until at least one day was due in the last 30 days.
  const rate30 = completionRateOrNull(habit, completions, 30, today)

  // "total" is every DONE day, which is what the old code counted.
  const total = completions.filter((c) => c.status === 'done').length
  return { current, best, rate30, total }
}

// Like calculateCompletionRate, but returns null when nothing was due
// (the old stats shape used null for "not enough data yet").
export function completionRateOrNull(
  habit: HabitRules,
  completions: HabitCompletion[],
  days: number,
  today: string
): number | null {
  const windowStart = addDays(today, -(days - 1))
  let due = 0
  walkDays(habit, completions, today, (status, date) => {
    if (date < windowStart) return
    // A skipped day was due, so it counts as a due day that was not done.
    if (status === 'done' || status === 'missed' || status === 'skipped') due++
  })
  if (due === 0) return null
  return calculateCompletionRate(habit, completions, days, today)
}
// ---------- Phase 2: week navigation and editing a day by hand ----------

// The Monday of the week that `date` falls in. Weeks always run Monday to
// Sunday, like the app's calendar and the Review page.
export function weekStart(date: string): string {
  return addDays(date, -weekdayOf(date))
}

// The seven days of the week that starts on `monday`, Monday first.
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

// Move a week forwards (1) or backwards (-1).
export function shiftWeek(monday: string, weeks: number): string {
  return addDays(monday, weeks * 7)
}

// A short label for the week, like "26 Oct - 1 Nov".
// The year is only shown when the week spans two years, so the common case
// stays short and readable.
export function weekLabel(monday: string): string {
  const sunday = addDays(monday, 6)
  const start = shortDay(monday)
  const end = shortDay(sunday)
  if (monday.slice(0, 4) === sunday.slice(0, 4)) return `${start} - ${end}`
  return `${start} ${monday.slice(0, 4)} - ${end} ${sunday.slice(0, 4)}`
}

// "26 Oct" from "2026-10-26". The month names are fixed so the label is the
// same everywhere in the app (and in tests).
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function shortDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTH_NAMES[m - 1]}`
}

// What a user can choose for one day of a habit.
//   'done'    = the habit was completed
//   'missed'  = it was due and was not done (this is DERIVED, so it is stored
//               as "nothing" - a missed day is simply a day with no record)
//   'skipped' = deliberately skipped (sick day, travel, ...)
//   'clear'   = remove whatever was recorded, so the day goes back to normal
export type DayChoice = 'done' | 'missed' | 'skipped' | 'clear'

// The choices the popover offers, in the order they are shown.
export const DAY_CHOICES: DayChoice[] = ['done', 'missed', 'skipped', 'clear']

// What a choice means for the stored data.
// 'missed' and 'clear' both store nothing, so the day simply has no record.
// 'clear' also removes a record that is already there.
export function storedStatusFor(choice: DayChoice): 'done' | 'skipped' | null {
  if (choice === 'done') return 'done'
  if (choice === 'skipped') return 'skipped'
  return null // 'missed' and 'clear'
}

// Can this day be changed at all?
// A day that has not happened yet cannot be edited, and a day that was never
// tracked (before the habit existed) cannot either.
export function canEditDay(
  habit: HabitRules,
  completions: HabitCompletion[],
  date: string,
  today: string
): boolean {
  if (date > today) return false // the future has not happened
  return isHabitDue(habit, date, effectiveStart(habit, completions))
}

// The effective start date: the earlier of the habit's start date and its
// first record. A habit checked off before it was created really started then.
export function effectiveStart(habit: HabitSchedule, completions: HabitCompletion[]): string | undefined {
  const starts: string[] = []
  if (habit.startDate) starts.push(habit.startDate)
  for (const c of completions) starts.push(c.date)
  if (starts.length === 0) return undefined
  return starts.sort()[0]
}

// ---------- Phase 5: organisation (ordering and time of day) ----------

// The order the time-of-day groups are shown in, top to bottom. 'anytime' is
// last because it is the "no particular time" bucket.
export const TIME_OF_DAY_ORDER = ['morning', 'afternoon', 'evening', 'anytime'] as const

// The word for each time of day, as the group headings show it.
export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  anytime: 'Anytime'
}

// Turns whatever was stored (or typed) into a valid time of day.
// Anything unknown or missing is 'anytime', so old data and old backups keep
// working without a migration of their own.
export function cleanTimeOfDay(value: unknown): TimeOfDay {
  return TIME_OF_DAY_ORDER.includes(value as TimeOfDay) ? (value as TimeOfDay) : 'anytime'
}

// Groups habits by their time of day, in TIME_OF_DAY_ORDER order.
// Groups with no habits are left out, so an empty heading is never shown.
// The habits inside a group keep the order they arrived in (the list order).
export interface TimeGroup<T> {
  timeOfDay: TimeOfDay
  label: string
  habits: T[]
}

export function groupByTimeOfDay<T extends { timeOfDay?: TimeOfDay }>(habits: T[]): TimeGroup<T>[] {
  const buckets = new Map<TimeOfDay, T[]>()
  for (const habit of habits) {
    const time = cleanTimeOfDay(habit.timeOfDay)
    const list = buckets.get(time) ?? []
    list.push(habit)
    buckets.set(time, list)
  }
  return TIME_OF_DAY_ORDER
    .filter((time) => buckets.has(time))
    .map((time) => ({ timeOfDay: time, label: TIME_OF_DAY_LABELS[time], habits: buckets.get(time)! }))
}

// ---------- Phase 6: reminders and the Logbook link ----------

// Cleans up a reminder time. "HH:MM" (24-hour), or null when there is no
// reminder. A few forgiving inputs are accepted ("9:05" becomes "09:05")
// so a hand-typed time is not fussy about leading zeros.
export function cleanReminderTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

// A time of day as minutes since midnight, e.g. "09:05" -> 545.
export function minutesOfDay(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

// Should a reminder fire NOW? True when the current time is inside a small
// window after the reminder time, so a check that runs once a minute still
// catches it (and the app being started a couple of minutes late still works).
// Before the reminder time, or long after it, nothing fires.
export const REMINDER_CATCHUP_MINUTES = 10

export function isReminderDue(reminderTime: string, nowTime: string): boolean {
  const lateBy = minutesOfDay(nowTime) - minutesOfDay(reminderTime)
  // Late on the previous day or not yet time: no.
  return lateBy >= 0 && lateBy <= REMINDER_CATCHUP_MINUTES
}

// ---------- Phase 3: milestones and the perfect week ----------

// The streak lengths that earn a badge. They are the numbers people tend to
// tell others about, so they are worth marking.
export const MILESTONES = [7, 30, 100]

// Which milestone a streak has reached, if any.
// The streak must be AT LEAST the milestone, so a streak of 30 also has the
// 7-day badge. The highest milestone is the one that gets shown.
export function reachedMilestone(streak: number): number | null {
  let best: number | null = null
  for (const m of MILESTONES) {
    if (streak >= m) best = m
  }
  return best
}

// A short word for a milestone, used in the badge's label.
export function milestoneLabel(milestone: number): string {
  if (milestone >= 100) return '100-day streak'
  if (milestone >= 30) return '30-day streak'
  return '7-day streak'
}

// How many days of a week were due, and how many of them were done.
//
// The counting rules, in one place, so the perfect-week mark and the little
// "3 of 3 days done" text can never disagree:
//   - a day in the future is not counted (it has not happened yet)
//   - a rest day is not counted (the habit was not supposed to happen)
//   - today IS counted, because it is a real due day that is still open
//   - a skipped day WAS due, so it counts as due but not done
export function weekProgress(
  habit: HabitRules,
  completions: HabitCompletion[],
  weekStart: string,
  today: string
): { due: number; done: number } {
  const start = effectiveStart(habit, completions)
  let due = 0
  let done = 0
  for (const date of weekDays(weekStart)) {
    if (date > today) continue // the future has not happened yet
    if (!isHabitDue(habit, date, start)) continue // a rest day does not count
    due++
    const completion = completions.find((c) => c.date === date)
    // reachedTarget knows about the habit's type, so a count/duration habit
    // only counts as done when the target was reached.
    if (reachedTarget(habit, completion)) done++
  }
  return { due, done }
}

// Was every day that was DUE in this week done?
//
// "Perfect week" means the habit was not missed once this week.
//   - a rest day does not count against it (the habit was not due)
//   - a skipped day DOES count against it (it was due, but not done)
//   - a day in the future does not count (it has not happened yet)
//   - TODAY is left out of the judgement entirely, because the day is not over:
//     it can neither spoil the mark nor earn it yet
//
// `weekStart` is the Monday of the week to look at.
export function isPerfectWeek(
  habit: HabitRules,
  completions: HabitCompletion[],
  weekStart: string,
  today: string
): boolean {
  const start = effectiveStart(habit, completions)
  let judged = 0
  let doneCount = 0
  for (const date of weekDays(weekStart)) {
    if (date > today) continue // the future has not happened yet
    if (date === today) continue // today is still open, so it is not judged yet
    if (!isHabitDue(habit, date, start)) continue // a rest day does not count
    judged++
    const completion = completions.find((c) => c.date === date)
    if (reachedTarget(habit, completion)) doneCount++
    // A missed or skipped day was due and was not done: the week is spoiled.
    else return false
  }
  // Nothing was judged this week, so there is nothing to be perfect about.
  if (judged === 0) return false
  return doneCount === judged
}
