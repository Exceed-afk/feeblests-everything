// Small visual pieces for habits: the 7-day strip on each card and the
// 12-week history grid in the editor. Both are clickable, so a missed day can be fixed.
//
// Every day is in exactly one state, and each state looks different in shape as well as colour:
//   done    filled circle with a tick       missed  ring with a cross (scheduled, passed, not done)
//   rest    dashed ring (not scheduled)     future  dotted ring (has not happened)
import { Check, X } from 'lucide-react'
import type { Habit } from '../../../shared/types'
import { addDays, isScheduled, weekdayOf, WEEKDAY_NAMES } from '../../../shared/habits'
import { formatDate } from '../lib/dates'

export type DayState = 'done' | 'missed' | 'rest' | 'future' | 'pending'

// `pending` = scheduled today and not done yet (the day is not over, so it is not "missed").
export function dayState(habit: Pick<Habit, 'days'>, done: Set<string>, date: string, today: string): DayState {
  if (date > today) return 'future'
  if (done.has(date)) return 'done'
  if (!isScheduled(habit.days, date)) return 'rest'
  return date === today ? 'pending' : 'missed'
}

const LABEL: Record<DayState, string> = { done: 'done', missed: 'missed', rest: 'rest day', future: 'not yet', pending: 'to do today' }

interface Props {
  habit: Habit
  today: string
  onToggle: (date: string) => void
}

export function WeekStrip({ habit, today, onToggle }: Props) {
  const done = new Set(habit.checkins)
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  return (
    <div className="flex gap-1.5" role="group" aria-label={`Last 7 days for ${habit.name}`}>
      {days.map((d) => {
        const state = dayState(habit, done, d, today)
        const label = `${formatDate(d)}: ${LABEL[state]}`
        return (
          <div key={d} className="flex flex-col items-center gap-1">
            <span className={`text-[10px] ${d === today ? 'font-semibold text-fg' : 'text-muted'}`}>{WEEKDAY_NAMES[weekdayOf(d)][0]}</span>
            <button onClick={() => onToggle(d)} aria-pressed={state === 'done'} title={label} aria-label={label}
              data-state={state === 'pending' ? 'rest' : state} data-today={d === today} className="hd h-5 w-5">
              {state === 'done' ? <Check size={12} strokeWidth={3} /> : state === 'missed' ? <X size={11} strokeWidth={2.5} /> : null}
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
      {item('done', 'Done')}{item('missed', 'Missed')}{item('rest', 'Rest day')}{item('pending', 'Today, to do')}{item('future', 'Not yet')}
    </div>
  )
}

export function HabitHeatmap({ habit, today, onToggle }: Props) {
  const done = new Set(habit.checkins)
  const weeks = 12
  // Columns are weeks (Monday to Sunday), oldest on the left, ending with this week.
  const start = addDays(today, -weekdayOf(today) - 7 * (weeks - 1))
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i))
  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <div className="grid grid-rows-7 gap-1 text-[10px] leading-4 text-muted">
          {WEEKDAY_NAMES.map((n, i) => <span key={n} className="h-4">{i % 2 === 0 ? n : ''}</span>)}
        </div>
        <div className="grid grid-flow-col grid-rows-7 gap-1">
          {cells.map((d) => {
            const state = dayState(habit, done, d, today)
            if (state === 'future') return <span key={d} className="hc h-4 w-4" data-state="future" aria-hidden="true" />
            const label = `${formatDate(d)}: ${LABEL[state]}`
            return <button key={d} onClick={() => onToggle(d)} aria-pressed={state === 'done'} title={label} aria-label={label} data-state={state} className="hc h-4 w-4" />
          })}
        </div>
      </div>
      <HabitLegend />
    </div>
  )
}
