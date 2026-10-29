// Small visual pieces for the Review page: daily P&L bars, the habit day strip and the mood day strip.
// Drawn with plain SVG / CSS and the theme colours only (no chart library). Every day is also readable as text:
// hover (or tab to) a day for its date and numbers, and each strip carries a one-line summary for screen readers.
import { MOODS, type Mood, type ReviewHabits, type ReviewKind, type ReviewMood, type ReviewTrades } from '../../../shared/types'
import { WEEKDAY_NAMES, weekdayOf } from '../../../shared/habits'
import { MOOD_SCORE } from '../../../shared/review'
import { MOOD_STYLE } from '../lib/moods'
import { formatDate } from '../lib/dates'
import { fmtPnl } from '../lib/format'

// The label under each day: Mon, Tue... for a week; the day number on the 1st, 8th, 15th... for a month.
const dayLabel = (kind: ReviewKind, date: string): string =>
  kind === 'week' ? WEEKDAY_NAMES[weekdayOf(date)] : Number(date.slice(8)) % 7 === 1 ? String(Number(date.slice(8))) : ''

// The mood word closest to an average (3.6 -> good).
export const moodNear = (average: number): Mood => MOODS.find((m) => MOOD_SCORE[m] === Math.round(average)) ?? 'okay'

// ---------- P&L per day ----------
const W = 720, H = 150
const PAD = { l: 8, r: 8, t: 14, b: 22 }

export function DayBars({ days, kind, today }: { days: ReviewTrades['days']; kind: ReviewKind; today: string }) {
  const n = days.length
  const hi = Math.max(0, ...days.map((d) => d.pnl)), lo = Math.min(0, ...days.map((d) => d.pnl))
  const span = hi - lo || 1
  const y = (v: number) => PAD.t + ((hi - v) / span) * (H - PAD.t - PAD.b)
  const slot = (W - PAD.l - PAD.r) / n
  const bar = slot * (kind === 'week' ? 0.55 : 0.7)
  const total = days.reduce((a, d) => a + d.pnl, 0)
  const active = days.filter((d) => d.closed > 0).length
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
      aria-label={`Profit and loss per day: ${active} ${active === 1 ? 'day' : 'days'} with closed trades, ${fmtPnl(Math.round(total * 1e8) / 1e8)} in total`}>
      <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="stroke-muted" strokeWidth="1" strokeDasharray="4 4" />
      {days.map((d, i) => {
        const cx = PAD.l + slot * (i + 0.5)
        const top = Math.min(y(d.pnl), y(0))
        const label = dayLabel(kind, d.date)
        return (
          <g key={d.date}>
            <title>{d.closed === 0 ? `${formatDate(d.date)}: no closed trades` : `${formatDate(d.date)}: ${fmtPnl(d.pnl)} from ${d.closed} closed ${d.closed === 1 ? 'trade' : 'trades'}`}</title>
            {d.pnl !== 0
              ? <rect x={cx - bar / 2} y={top} width={bar} height={Math.max(2, Math.abs(y(d.pnl) - y(0)))} rx="2" className={d.pnl > 0 ? 'fill-pos' : 'fill-neg'} />
              : <circle cx={cx} cy={y(0)} r={d.closed > 0 ? 3 : 1.5} className="fill-muted" />}
            {label && <text x={cx} y={H - 6} textAnchor="middle" fontSize="11" className={d.date === today ? 'fill-fg' : 'fill-muted'} fontWeight={d.date === today ? 600 : 400}>{label}</text>}
          </g>
        )
      })}
    </svg>
  )
}

// ---------- Habits per day ----------
// Each day is a box filled from the bottom by the share of that day's scheduled habits that were done.
// Full = every one done, empty box = none done, dashed = nothing was scheduled, dotted = has not happened yet.
export function HabitDays({ days, kind, today }: { days: ReviewHabits['days']; kind: ReviewKind; today: string }) {
  const full = days.filter((d) => d.due > 0 && d.done === d.due).length
  const counted = days.filter((d) => d.due > 0).length
  return (
    <div role="img" aria-label={`Habits by day: every habit done on ${full} of ${counted} ${counted === 1 ? 'day' : 'days'}`} className="flex gap-1">
      {days.map((d) => {
        const future = d.date > today
        const pct = d.due > 0 ? (d.done / d.due) * 100 : 0
        const text = future ? `${formatDate(d.date)}: not yet` : d.due === 0 ? `${formatDate(d.date)}: nothing to do` : `${formatDate(d.date)}: ${d.done} of ${d.due} done`
        return (
          <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={text}>
            <div className={`relative h-9 w-full overflow-hidden rounded-md border ${future ? 'border-dotted border-line/60' : d.due === 0 ? 'border-dashed border-line' : 'border-line'}`}>
              {pct > 0 && <div className="absolute inset-x-0 bottom-0 bg-accent" style={{ height: `${pct}%` }} />}
            </div>
            <span className={`h-3 text-[10px] leading-3 ${d.date === today ? 'font-semibold text-fg' : 'text-muted'}`}>{dayLabel(kind, d.date)}</span>
          </div>
        )
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
        const mood = d.average === null ? null : moodNear(d.average)
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
            <span className={`h-3 text-[10px] leading-3 ${d.date === today ? 'font-semibold text-fg' : 'text-muted'}`}>{dayLabel(kind, d.date)}</span>
          </div>
        )
      })}
    </div>
  )
}
