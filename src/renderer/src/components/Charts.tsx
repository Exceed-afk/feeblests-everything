// The small charts of the Review page: the trading bars, a sparkline and the mood trend.
// Drawn with plain SVG and the theme variables only (no chart library, nothing to download), and every figure is
// also plain text next to the chart, so nothing depends on hover alone. Each chart is a single focusable element:
// arrow keys move from day to day, a tooltip shows the same numbers as text.
import { useId, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type { ReviewMood, ReviewTrades } from '../../../shared/types'
import { MOOD_STYLE, wordNear } from '../lib/moods'
import { formatDate } from '../lib/dates'
import { fmtPnl } from '../lib/format'
import { barTone, moodPoints, sparkPath, tradeBars, type TradeView } from '../lib/chartData'

// Chart ink, as hsl() so it reaches an SVG presentation attribute reliably. The hue/saturation/lightness are the
// design tokens' own (see src/shared/design.ts); the lightness matches the charts' meaning colours exactly.
const POS = 'hsl(154 92% 25%)' // --pos in light mode
const NEG = 'hsl(347 76% 44%)' // --neg in light mode
const MUTED = 'hsl(217 19% 26% / 0.45)' // --fg at low strength
const INK = 'hsl(120 8% 10%)' // --fg
const AXIS = 'hsl(0 0% 45%)' // secondary axis labels
const GRID = 'hsl(0 0% 50% / 0.14)' // the quiet grid line
const ZERO = 'hsl(0 0% 40% / 0.3)' // the zero baseline

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// Monday = 0, like src/shared/habits.ts. Computed from the calendar date itself (UTC), so a time zone cannot move it.
const weekdayOf = (iso: string): number => (new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay() + 6) % 7

// The label under each day: Mon, Tue... for a week; the day number on the 1st, 8th... for a month.
const dayLabel = (kind: 'week' | 'month', date: string): string =>
  kind === 'week' ? WEEKDAY[weekdayOf(date)] : Number(date.slice(8, 10)) % 7 === 1 ? String(Number(date.slice(8, 10))) : ''

export interface DayBarProps {
  days: ReviewTrades['days']
  kind: 'week' | 'month'
  today: string
  view: TradeView
}

// There is nothing to point at when no day closed a trade: a flat, quiet line and a sentence, not an empty chart.
const NO_TRADES = (
  <div className="chart" style={{ minHeight: 'var(--chart-h)' }}>
    <svg viewBox="0 0 600 172" role="img" aria-label="No closed trades in this period" />
    <p className="meta">No closed trades in this period.</p>
  </div>
)

// Green above the line, red below, a clear zero baseline. A day without closed trades keeps its slot (so the
// spacing still means "a day") but shows only a small neutral dot.
export function TradeBars({ days, kind, today, view }: DayBarProps) {
  const [hover, setHover] = useState<number | null>(null)
  const bars = tradeBars(days, view)
  const W = 600, H = 172
  const pad = { l: 4, r: 4, t: 16, b: 26 }
  const hi = Math.max(0, ...bars.map((b) => b.value)), lo = Math.min(0, ...bars.map((b) => b.value))
  const span = hi - lo || 1
  const y = (v: number) => pad.t + ((hi - v) / span) * (H - pad.t - pad.b)
  const slot = (W - pad.l - pad.r) / bars.length
  const width = Math.max(4, slot * (kind === 'week' ? 0.5 : 0.68))
  const zero = y(0)

  const summary = (b: (typeof bars)[number], date: string): [string, string] => [
    b.closed === 0 ? 'No closed trades'
      : view === 'pnl' ? `${fmtPnl(b.value)} from ${b.closed} closed ${b.closed === 1 ? 'trade' : 'trades'}`
        : view === 'cumulative' ? `Running total ${fmtPnl(b.value)}`
          : `${b.closed} closed ${b.closed === 1 ? 'trade' : 'trades'}`,
    formatDate(date)
  ]

  // Arrow keys walk the days; Home / End jump to the first / last.
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const last = bars.length - 1
    const now = hover ?? (bars.findIndex((b) => b.date === today) >= 0 ? bars.findIndex((b) => b.date === today) : last)
    const go = (i: number) => { e.preventDefault(); setHover(Math.max(0, Math.min(last, i))) }
    if (e.key === 'ArrowRight') go(now + 1)
    else if (e.key === 'ArrowLeft') go(now - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(last)
    else if (e.key === 'Escape') setHover(null)
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    setHover(Math.max(0, Math.min(bars.length - 1, Math.floor((px - pad.l) / slot))))
  }
  const active = hover !== null ? bars[hover] : null
  const tip = active && hover !== null ? summary(active, active.date) : null
  // "Closed trades per day" for a count; the money views only make sense with at least one closed trade.
  if (view !== 'count' && !bars.some((b) => b.closed > 0)) return NO_TRADES

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0} aria-label={view === 'count' ? 'Closed trades per day' : 'Profit and loss per day'}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)} onKeyDown={onKey}>
        {/* Colours are hsl() built in the component, not var(): a var() inside an SVG presentation attribute can fall
            back to black, which is what a chart must never do. Same tokens as the rest of the page. */}
        <line x1={pad.l} x2={W - pad.r} y1={zero} y2={zero} stroke={ZERO} strokeWidth="1" />
        {hi > 0 && <line x1={pad.l} x2={W - pad.r} y1={y(hi)} y2={y(hi)} stroke={GRID} strokeWidth="1" />}
        {lo < 0 && <line x1={pad.l} x2={W - pad.r} y1={y(lo)} y2={y(lo)} stroke={GRID} strokeWidth="1" />}
        {bars.map((b, i) => {
          const cx = pad.l + slot * (i + 0.5)
          const tone = barTone(b, view)
          const label = dayLabel(kind, b.date)
          const top = Math.min(y(b.value), zero)
          const h = Math.max(2, Math.abs(y(b.value) - zero))
          const color = tone === 'pos' ? POS : tone === 'neg' ? NEG : MUTED
          return (
            <g key={b.date}>
              {b.closed === 0
                ? <circle cx={cx} cy={zero} r={2} fill={MUTED} opacity={0.45} />
                : <rect className="chart-hit" x={cx - width / 2} y={view === 'count' ? y(b.value) : top} width={width}
                  height={view === 'count' ? Math.max(2, H - pad.b - y(b.value)) : h} rx={3}
                  fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />}
              {hover === i && <rect x={pad.l + slot * i} y={pad.t - 6} width={slot} height={H - pad.t - pad.b + 6} fill="transparent" />}
              {label && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill={b.date === today ? INK : AXIS} fontWeight={b.date === today ? 600 : 400}>{label}</text>
              )}
            </g>
          )
        })}
      </svg>
      {tip && hover !== null && (
        <div className="chart-tip" role="status" style={{ left: `${((pad.l + slot * (hover + 0.5)) / W) * 100}%`, top: `${(pad.t / H) * 100}%` }}>
          <div className="chart-tip-title">{tip[1]}</div>
          <div className="chart-tip-row">{tip[0]}</div>
        </div>
      )}
    </div>
  )
}



// The running P&L of the period: below zero dips under the dashed zero line, above it rises. The line takes the sign of
// the latest figure, so the card's colour story and its shape agree.
export function TrendSpark({ values, height = 36 }: { values: number[]; height?: number }) {
  const W = 100, H = height
  const path = sparkPath(values, W, H - 6)
  if (!path) return null
  const last = values[values.length - 1] ?? 0
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" preserveAspectRatio="none">
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} strokeDasharray="3 3" style={{ stroke: 'var(--chart-grid)' }} strokeWidth="1" />
      <path d={path} transform="translate(0 3)" fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" style={{ stroke: `rgb(var(--${last >= 0 ? 'pos' : 'neg'}))` }} />
    </svg>
  )
}

// Mood day by day on the fixed 1..5 scale. Logged days are joined; a day with no entry is simply not on the line.
// Below it there is always a text summary, so a missing day is never read as a low one.
export function MoodTrend({ days, kind, today }: { days: ReviewMood['days']; kind: 'week' | 'month'; today: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 600, H = 140
  const pad = { l: 4, r: 4, t: 10, b: 24 }
  const innerH = H - pad.t - pad.b
  const pts = moodPoints(days, W - pad.l - pad.r, innerH).map((p) => ({ ...p, x: p.x + pad.l, y: p.y + pad.t }))
  const gradientId = useId()
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const slot = (W - pad.l - pad.r) / days.length
  const logged = days.filter((d) => d.average !== null).length
  const active = hover !== null ? pts.find((p) => p.date === days[hover].date) : null
  const cell = hover !== null ? days[hover] : null

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    setHover(Math.max(0, Math.min(days.length - 1, Math.floor((px - pad.l) / slot))))
  }
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const last = days.length - 1
    const start = hover ?? Math.max(0, days.findIndex((d) => d.average !== null))
    const go = (i: number) => { e.preventDefault(); setHover(Math.max(0, Math.min(last, i))) }
    if (e.key === 'ArrowRight') go(start + 1)
    else if (e.key === 'ArrowLeft') go(start - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(last)
  }

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0}
        aria-label={pts.length === 0 ? 'No mood logged in this period' : `Mood by day, logged on ${logged} of ${days.length} days`}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)} onKeyDown={onKey}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--mood)', stopOpacity: 0.2 }} />
            <stop offset="100%" style={{ stopColor: 'var(--mood)', stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        {/* 1, 3 and 5 of 5 as guides, so a point's height can be read without hovering. */}
        {[5, 3, 1].map((v) => {
          const yy = pad.t + innerH - ((v - 1) / 4) * innerH
          return <line key={v} x1={pad.l} x2={W - pad.r} y1={yy} y2={yy} style={{ stroke: v === 3 ? 'rgb(var(--fg) / 0.14)' : 'var(--chart-grid)' }} strokeWidth="1" strokeDasharray={v === 3 ? '3 4' : undefined} />
        })}
        {pts.length > 1 && <path d={`${line} L${pts[pts.length - 1].x} ${pad.t + innerH} L${pts[0].x} ${pad.t + innerH} Z`} fill={`url(#${gradientId})`} />}
        {pts.length > 1 && <path d={line} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" style={{ stroke: 'var(--mood)' }} />}
        {pts.map((p) => (
          <circle key={p.date} cx={p.x} cy={p.y} r={hover !== null && days[hover].date === p.date ? 4.5 : 3}
            style={{ fill: 'var(--mood)', stroke: 'rgb(var(--card))' }} strokeWidth="2" />
        ))}
        {days.map((d, i) => {
          const label = dayLabel(kind, d.date)
          if (!label) return null
          return <text key={d.date} x={pad.l + slot * (i + 0.5)} y={H - 6} textAnchor="middle" fontSize="11"
            style={{ fill: d.date === today ? 'rgb(var(--fg))' : 'var(--chart-axis)' }} fontWeight={d.date === today ? 600 : 400}>{label}</text>
        })}
      </svg>
      {cell && (
        <div className="chart-tip" role="status" style={{ left: `${((cell.average === null ? pad.l + slot * ((hover as number) + 0.5) : active?.x ?? 0) / W) * 100}%`, top: `${((active?.y ?? pad.t) / H) * 100}%` }}>
          <div className="chart-tip-title">{formatDate(cell.date)}</div>
          <div className="chart-tip-row">{cell.average === null ? 'No mood logged' : `${MOOD_STYLE[wordNear(cell.average)].label} (${cell.average.toFixed(1)} of 5)`}</div>
        </div>
      )}
    </div>
  )
}


