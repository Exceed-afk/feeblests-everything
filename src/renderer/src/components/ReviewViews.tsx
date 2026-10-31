// Small visual pieces for the Review page: the day strips and the per-habit rows.
// The bigger charts (trading bars, mood trend, sparklines) live in components/Charts.tsx; their arithmetic is in
// lib/chartData.ts. Everything here is plain SVG / CSS and theme colours only, and every day is also readable as
// text: hover (or tab to) a day for its date and numbers, and each strip carries a one-line summary for screen readers.
import type { ReviewHabit, ReviewHabitDay, ReviewHabits, ReviewKind, ReviewMood } from '../../../shared/types'
import { WEEKDAY_NAMES, weekdayOf } from '../../../shared/habits'
import { MOOD_STYLE, wordNear } from '../lib/moods'
import { habitDayState } from '../lib/chartData'
import { formatDate } from '../lib/dates'

// The label under each day: Mon, Tue... for a week; the day number on the 1st, 8th, 15th... for a month.
const dayLabel = (kind: ReviewKind, date: string): string =>
  kind === 'week' ? WEEKDAY_NAMES[weekdayOf(date)] : Number(date.slice(8, 10)) % 7 === 1 ? String(Number(date.slice(8, 10))) : ''

const TODAY = 'font-semibold text-fg'
const OTHER = 'text-muted'

// ---------- Habits per day (summary card: a compact seven-day strip) ----------
// Each day is a small tile filled from the bottom by the share of that day's scheduled habits done:
// full = every one done, part = some, empty = none, dashed = nothing scheduled, dotted = has not happened yet.
// The fill says it as well as the colour.
export function WeekStrip({ days, today }: { days: ReviewHabits['days']; today: string }) {
  const full = days.filter((d) => d.due > 0 && d.done === d.due).length
  const counted = days.filter((d) => d.due > 0).length
  return (
    <div role="img" aria-label={`Habits by day: every habit done on ${full} of ${counted} ${counted === 1 ? 'day' : 'days'}`} className="flex gap-1.5">
      {days.map((d) => {
        const state = habitDayState(d, today)
        const pct = d.due > 0 ? (d.done / d.due) * 100 : 0
        const text = state === 'future' ? `${formatDate(d.date)}: not yet`
          : d.due === 0 ? `${formatDate(d.date)}: nothing scheduled`
            : `${formatDate(d.date)}: ${d.done} of ${d.due} done`
        return (
          <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={text}>
            <div className={`relative h-7 w-full overflow-hidden rounded ${state === 'future' ? 'border border-dotted border-line' : state === 'rest' ? 'border border-dashed border-line' : state === 'pending' ? 'border border-line bg-transparent' : 'bg-fg/[0.06]'}`}>
              {pct > 0 && <div className={`absolute inset-x-0 bottom-0 ${d.done === d.due ? 'bg-pos' : 'bg-pos/45'}`} style={{ height: `${pct}%` }} />}
            </div>
            <span className={`h-3 text-[10px] leading-3 ${d.date === today ? TODAY : OTHER}`}>{dayLabel('week', d.date)}</span>
          </div>
        )
      })}
    </div>
  )
}

// ---------- Habits card: one row per habit ----------
// A week gets a dot for every day (done = filled, missed = ring with a cross, rest = dashed, future = dotted),
// so "which habit slipped, and when" is one glance. A month is too long for that, so it shows the bar only.
export function HabitWeekRow({ habit, days, today }: { habit: ReviewHabit; days: ReviewHabitDay[]; today: string }) {
  const missed = new Set(habit.missed)
  return (
    <div className="flex items-center gap-1" role="img" aria-label={`${habit.name}: ${habit.done} done, ${habit.missed.length} missed of ${habit.due} scheduled days`}>
      {days.map((d) => {
        const future = d.date > today
        // A day that is neither missed nor in the future: done if the habit existed, a rest day if it was not scheduled.
        const isMissed = missed.has(d.date)
        const state = future ? 'future' : isMissed ? 'missed' : d.date === today && habit.done < habit.due ? 'pending' : 'done'
        const word = state === 'future' ? 'not yet' : state === 'missed' ? 'missed' : state === 'pending' ? 'not done yet' : 'done'
        return <span key={d.date} className="hd h-4 w-4" data-state={state} data-today={d.date === today} title={`${formatDate(d.date)}: ${word}`} />
      })}
    </div>
  )
}

// ---------- Mood per day ----------
// A week shows a circle with the day's score (1 rough to 5 great), so the number says it as well as the colour.
// A month is too narrow for numbers, so it shows plain dots; hover for the details.
export function MoodDays({ days, kind, today }: { days: ReviewMood['days']; kind: ReviewKind; today: string }) {
  const logged = days.filter((d) => d.average !== null).length
  return (
    <div role="img" aria-label={`Mood by day: logged on ${logged} of ${days.length} days`} className="flex gap-1">
      {days.map((d) => {
        const mood = d.average === null ? null : wordNear(d.average)
        const text = mood === null ? `${formatDate(d.date)}: no mood logged` : `${formatDate(d.date)}: ${MOOD_STYLE[mood].label} (${(d.average as number).toFixed(1)} of 5)`
        return (
          <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={text}>
            <div className="grid h-7 place-items-center">
              {kind === 'week'
                ? mood === null
                  ? <span className="h-6 w-6 rounded-full border border-dashed border-line" />
                  : <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold text-black/80 ${MOOD_STYLE[mood].dot}`}>{Math.round(d.average as number)}</span>
                : mood === null
                  ? <span className="h-2 w-2 rounded-full border border-dashed border-line" />
                  : <span className={`h-2.5 w-2.5 rounded-full ${MOOD_STYLE[mood].dot}`} />}
            </div>
            <span className={`h-3 text-[10px] leading-3 ${d.date === today ? TODAY : OTHER}`}>{dayLabel(kind, d.date)}</span>
          </div>
        )
      })}
    </div>
  )
}


