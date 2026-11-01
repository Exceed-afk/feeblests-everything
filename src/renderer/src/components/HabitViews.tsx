// Small visual pieces for habits: the 7-day strip on each card and the
// 12-week history grid in the editor.
//
// Every day is in exactly one state, and each state looks different in shape as well as colour:
//   done    filled circle with a tick       missed  ring with a cross (due, passed, not done)
//   rest    dashed ring with a dash (not scheduled)
//   skipped ring with a skip glyph (skipped on purpose)
//   future  dotted ring (has not happened yet)
//   pending plain ring (due today, not done yet - the day is not over)
import { Award, Check, Minus, SkipForward, Sparkles, X } from 'lucide-react'
import type { Habit } from '../../../shared/types'
import {
  addDays,
  getDayStatus,
  milestoneLabel,
  reachedMilestone,
  weekStart,
  weekdayOf,
  WEEKDAY_NAMES
} from '../../../shared/habits'
import type { DayStatus, HabitCompletion } from '../../../shared/habits'
import { formatDate } from '../lib/dates'

export type { DayStatus }

// The habit rows hold a list of completion records (done or skipped).
export function toCompletions(checkins: string[]) {
  return checkins.map((date) => ({ date, status: 'done' as const }))
}

// The completions of a habit, as the shared rules want them.
export function habitCompletions(habit: Pick<Habit, 'completions' | 'checkins'>): HabitCompletion[] {
  // Older data (or a habit loaded before completions existed) only has checkins.
  if (habit.completions && habit.completions.length > 0) return habit.completions
  return toCompletions(habit.checkins)
}

// `pending` = due today and not done yet (the day is not over, so it is not "missed").
// The shared helper owns the rules, so the dots and the streaks always agree.
// The effective start date is the earlier of the habit's start date and its
// first check-in, so a habit checked off before it was created still shows as done.
export function dayState(habit: Pick<Habit, 'days' | 'startDate'>, done: Set<string>, date: string, today: string): DayStatus {
  const completions = toCompletions([...done])
  const start = effectiveStart(habit.startDate, completions)
  return getDayStatus({ days: habit.days, startDate: habit.startDate }, date, completions, today, start)
}

// The day state of a habit that may have skipped days too.
export function completionState(
  habit: Pick<Habit, 'days' | 'startDate' | 'type' | 'target'>,
  completions: HabitCompletion[],
  date: string,
  today: string
): DayStatus {
  const start = effectiveStart(habit.startDate, completions)
  return getDayStatus(
    { days: habit.days, startDate: habit.startDate, type: habit.type, target: habit.target },
    date, completions, today, start
  )
}

// The day tracking really began: the habit's start date, or an earlier check-in.
export function effectiveStart(startDate: string | undefined, completions: HabitCompletion[]): string | undefined {
  const starts: string[] = []
  if (startDate) starts.push(startDate)
  for (const c of completions) starts.push(c.date)
  if (starts.length === 0) return undefined
  return starts.sort()[0]
}

const LABEL: Record<DayStatus, string> = {
  done: 'done',
  missed: 'missed',
  rest: 'rest day',
  skipped: 'skipped',
  future: 'not yet',
  pending: 'to do today'
}

interface Props {
  habit: Habit
  today: string
  // The Monday of the week being shown. Defaults to the week that holds today.
  weekStart?: string
  // Called when a day dot is clicked. Omit it and the dots are read-only history.
  // The element that was clicked is passed along, so a menu can open next to it.
  onDayClick?: (date: string, element: HTMLElement) => void
}

// The 7 dots of one habit, one for each day of the shown week.
export function WeekStrip({ habit, today, weekStart, onDayClick }: Props) {
  const completions = habitCompletions(habit)
  // The week runs Monday to Sunday. Without a weekStart we show the current week.
  const monday = weekStart ?? addDays(today, -weekdayOf(today))
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  return (
    <div className="flex gap-1.5" role="group" aria-label={`Week of ${formatDate(monday)} for ${habit.name}`}>
      {days.map((d) => {
        const state = completionState(habit, completions, d, today)
        const label = `${formatDate(d)}: ${LABEL[state]}`
        const isToday = d === today
        // A day in the future has not happened, so it cannot be changed.
        const editable = state !== 'future' && state !== 'rest'
        const glyph = state === 'done' ? <Check size={12} strokeWidth={3} />
          : state === 'missed' ? <X size={11} strokeWidth={2.5} />
            : state === 'rest' ? <Minus size={11} strokeWidth={2.5} />
              : state === 'skipped' ? <SkipForward size={11} strokeWidth={2.5} />
                : null
        const weekday = (
          <span className={`text-[10px] ${isToday ? 'font-semibold text-fg' : 'text-muted'}`}>
            {WEEKDAY_NAMES[weekdayOf(d)][0]}
          </span>
        )
        // Without a click handler, or on a day that cannot change, the dot is
        // a plain span: history, not a control.
        if (!onDayClick || !editable) {
          return (
            <div key={d} className="flex flex-col items-center gap-1">
              {weekday}
              <span title={label} aria-label={label} role="img"
                data-state={state} data-today={isToday} className="hd h-5 w-5">
                {glyph}
              </span>
            </div>
          )
        }
        return (
          <div key={d} className="flex flex-col items-center gap-1">
            {weekday}
            <button onClick={(e) => onDayClick(d, e.currentTarget)} aria-pressed={state === 'done'} title={label} aria-label={label}
              data-state={state} data-today={isToday} className="hd h-5 w-5">
              {glyph}
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function HabitLegend() {
  const item = (state: string, text: string) => (
    <span className="inline-flex items-center gap-1.5"><span className="hc h-3 w-3" data-state={state} />{text}</span>
  )
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-hidden="true">
      {item('done', 'Done')}{item('missed', 'Missed')}{item('rest', 'Rest day')}{item('skipped', 'Skipped')}{item('pending', 'Today, to do')}{item('future', 'Not yet')}
    </div>
  )
}

// The last 12 months of history, GitHub-style: one column per week
// (Monday to Sunday), oldest on the left, ending with this week. Every cell
// is clickable so a past day can be fixed. The row above shows which month
// each part of the year is.
export function HabitHeatmap({ habit, today, onToggle }: { habit: Habit; today: string; onToggle: (date: string) => void }) {
  const completions = habitCompletions(habit)
  // 53 week columns covers any 12-month stretch (a year is 52 weeks and one
  // or two days), ending with the week that holds today.
  const weeks = 53
  const start = addDays(weekStart(today), -7 * (weeks - 1))
  const daysOfWeeks = Array.from({ length: weeks }, (_, w) => addDays(start, w * 7))
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i))
  // A month's label sits on the column that CONTAINS the 1st of that month
  // (GitHub's rule), so the ruler always matches the squares underneath.
  const monthLabel = (monday: string): string => {
    for (let i = 0; i < 7; i++) {
      const day = addDays(monday, i)
      if (day.endsWith('-01')) return MONTH_SHORT[Number(day.slice(5, 7)) - 1]
    }
    return '' // no month starts in this column
  }
  const monthLabels = daysOfWeeks.map(monthLabel)
  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <div className="grid grid-rows-7 gap-1 text-[10px] leading-4 text-muted">
          {WEEKDAY_NAMES.map((n, i) => <span key={n} className="h-4">{i % 2 === 0 ? n : ''}</span>)}
        </div>
        <div className="flex min-w-fit flex-col gap-1">
          {/* The month label row, so the squares can be dated by eye. */}
          <div className="flex gap-1 text-[10px] leading-3 text-muted" aria-hidden="true">
            {monthLabels.map((label, i) => <span key={i} className="h-3 w-4 overflow-visible whitespace-nowrap">{label}</span>)}
          </div>
          {/* The year's squares: every week a column of 7 days. */}
          <div className="grid grid-flow-col grid-rows-7 gap-1">
            {cells.map((d) => {
              const state = completionState(habit, completions, d, today)
              if (state === 'future') return <span key={d} className="hc h-4 w-4" data-state="future" aria-hidden="true" />
              const label = `${formatDate(d)}: ${LABEL[state]}`
              return <button key={d} onClick={() => onToggle(d)} aria-pressed={state === 'done'} title={label} aria-label={label} data-state={state} className="hc h-4 w-4" />
            })}
          </div>
        </div>
      </div>
      <HabitLegend />
    </div>
  )
}

// The three-letter month names for the heatmap's ruler. Fixed on purpose:
// the same words everywhere, in every mode.
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ---------- Phase 3: the stats on a habit row ----------

// The little badge for a streak milestone (7, 30 or 100 days).
// It is deliberately quiet: a soft outline, not a bright trophy, so a list of
// habits does not turn into a wall of badges.
export function MilestoneBadge({ streak }: { streak: number }) {
  const milestone = reachedMilestone(streak)
  if (!milestone) return null
  return (
    <span className="habit-milestone" title={`You reached a ${milestoneLabel(milestone)}!`}>
      <Award size={12} strokeWidth={2.2} aria-hidden="true" />
      <span>{milestoneLabel(milestone)}</span>
    </span>
  )
}

// The small mark that says every due day of the visible week was done.
// It carries a star icon as well as the words, so the meaning never depends
// on colour alone.
export function PerfectWeekMark({ label }: { label: string }) {
  return (
    <span className="habit-perfect" title={`Every scheduled day of this week was done (${label})`}>
      <Sparkles size={12} strokeWidth={2.2} aria-hidden="true" />
      <span>Perfect week</span>
      <span className="text-muted">{label}</span>
    </span>
  )
}
