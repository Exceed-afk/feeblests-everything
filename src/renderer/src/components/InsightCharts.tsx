// Two tiny chart components for insight cards (I2). Plain SVG, no libraries:
// every colour comes through `currentColor`, which the card sets with theme
// token classes, so charts follow the palette automatically. Each has
// role="img" and an aria-label carrying the SAME numbers the text shows.
import type { GroupStats } from '../../../shared/insights'

// The two group averages of a comparison, side by side. Bar heights are
// proportional to the averages; the bigger one always fills the plot, so a
// tiny difference between big numbers still reads honestly via the label.
export function PairBars({ a, b, labelA, labelB, className = 'text-accent' }: {
  a: GroupStats
  b: GroupStats
  labelA: string
  labelB: string
  className?: string // token class setting currentColor, e.g. 'text-accent'
}) {
  const av = a.average ?? 0
  const bv = b.average ?? 0
  const max = Math.max(Math.abs(av), Math.abs(bv), 1e-9)
  const heightOf = (v: number): number => Math.max(2, Math.round((Math.abs(v) / max) * 100))
  const fmt = (s: GroupStats): string => s.average === null ? 'no data' : String(Math.round(s.average * 100) / 100)
  const aria = `Bar chart: ${labelA} averages ${fmt(a)} over ${a.n} days; ${labelB} averages ${fmt(b)} over ${b.n} days.`
  return (
    <figure className={`flex items-end gap-6 ${className}`} role="img" aria-label={aria}>
      <Bar value={av} height={heightOf(av)} n={a.n} label={labelA} text={fmt(a)} />
      <Bar value={bv} height={heightOf(bv)} n={b.n} label={labelB} text={fmt(b)} />
    </figure>
  )
}

function Bar({ value, height, n, label, text }: { value: number; height: number; n: number; label: string; text: string }) {
  const negative = value < 0
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="48" height="100" viewBox="0 0 48 100" aria-hidden="true" className="overflow-visible">
        {/* the plot floor line keeps zero visible even for a 2px bar */}
        <line x1="0" y1="99" x2="48" y2="99" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
        <rect x="8" y={100 - height} width="32" height={height} fill="currentColor"
          fillOpacity={negative ? 0.45 : 0.9} rx="2" />
      </svg>
      <span className="text-xs text-muted">{label} · {text} · {n}d</span>
    </div>
  )
}

// A small daily series line. Values may be negative; the drawing keeps zero on
// a fixed baseline and scales to the series' own min/max, honestly labelled.
export function Sparkline({ values, className = 'text-accent', ariaLabel }: {
  values: number[]
  className?: string
  ariaLabel: string
}) {
  const W = 240
  const H = 48
  if (values.length < 2) {
    return <p className={`text-xs text-muted ${className}`} role="img" aria-label={ariaLabel}>Not enough days for a chart yet.</p>
  }
  const max = Math.max(...values), min = Math.min(...values)
  const span = Math.max(max - min, 1e-9)
  const stepX = W / (values.length - 1)
  const points = values.map((v, i) => `${(i * stepX).toFixed(1)},${(H - ((v - min) / span) * (H - 4) - 2).toFixed(1)}`).join(' ')
  // where zero sits (or the bottom edge when the whole series is one-sided)
  const zeroY = min > 0 ? H : max < 0 ? 0 : H - ((0 - min) / span) * (H - 4) - 2
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}
      className={`${className} overflow-visible`}>
      <line x1="0" y1={zeroY.toFixed(1)} x2={String(W)} y2={zeroY.toFixed(1)}
        stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}
