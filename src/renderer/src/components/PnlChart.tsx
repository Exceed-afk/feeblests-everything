import { useState } from 'react'
import type { PnlPoint } from '../../../shared/types'
import { formatDate } from '../lib/dates'
import { fmtPnl, pnlColor } from '../lib/format'

// Line chart of the running P&L: one point per closed trade, oldest to newest.
// Point 0 is the starting line (0). Hover (or move the mouse) to read any trade.
const W = 720, H = 220
const PAD = { l: 64, r: 12, t: 12, b: 12 }

// Axis values: "1.2k", "-350", "0.5"
const axis = (n: number): string => {
  const a = Math.abs(n)
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${+(n / 1e3).toFixed(0)}k`
  if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}k`
  return String(+n.toFixed(a >= 10 ? 0 : a >= 1 ? 1 : 3))
}

export function PnlChart({ points }: { points: PnlPoint[] }) {
  const [hover, setHover] = useState<number | null>(null)

  const values = [0, ...points.map((p) => p.cumulative)]
  const lo = Math.min(...values), hi = Math.max(...values)
  const pad = (hi - lo || 1) * 0.1
  const yMin = lo - pad, yMax = hi + pad
  const n = values.length - 1 // number of trades

  // Guard: no trades to display
  if (n <= 0) {
    return (
      <div>
        <div className="flex min-h-[2.5rem] flex-wrap items-baseline justify-between gap-x-4 text-sm" aria-live="polite">
          <span className="text-muted">No closed trades</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full text-muted"
          aria-label="No closed trades to display"
        />
        <p className="mt-1 text-xs text-muted">Closed trades only, in date order.</p>
      </div>
    )
  }

  const x = (i: number) => PAD.l + (i / n) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b)

  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L${x(n).toFixed(1)} ${y(0).toFixed(1)} L${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`
  const last = values[n]
  const up = last >= 0
  const color = up ? 'text-pos' : 'text-neg'

  // Which point is shown in the readout: the hovered one, otherwise the latest.
  const shown = hover ?? n
  const p = shown === 0 ? null : points[shown - 1]
  // Labels at the best and worst running total (skipped when too close to the 0 line to read).
  const ticks = [hi, lo].filter((t) => Math.abs(y(t) - y(0)) >= 16)

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    setHover(Math.max(0, Math.min(n, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * n))))
  }

  return (
    <div>
      <div className="flex min-h-[2.5rem] flex-wrap items-baseline justify-between gap-x-4 text-sm" aria-live="polite" aria-label={`Running P&L chart, ${n} closed ${n === 1 ? 'trade' : 'trades'}`}>
        <span className="text-muted">
          {p ? <>{formatDate(p.date)} · {p.asset} · <span className={pnlColor(p.pnl)}>{fmtPnl(p.pnl)}</span></>
              : 'Start'}
        </span>
        <span>Running total <span className={`font-semibold tabular-nums ${pnlColor(values[shown])}`}>{fmtPnl(values[shown])}</span>
          <span className="text-muted"> after {shown} {shown === 1 ? 'trade' : 'trades'}</span></span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className={`mt-1 w-full ${color}`} role="img"
        aria-label={`Running P&L over ${n} closed ${n === 1 ? 'trade' : 'trades'}, now ${fmtPnl(last)}`}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth="1" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" className="fill-muted">{axis(t)}</text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="stroke-muted" strokeWidth="1" strokeDasharray="4 4" />
        <text x={PAD.l - 8} y={y(0) + 4} textAnchor="end" fontSize="11" className="fill-fg">0</text>
        <path d={area} fill="currentColor" opacity="0.12" />
        <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {n <= 40 && values.slice(1).map((v, i) => <circle key={i} cx={x(i + 1)} cy={y(v)} r="2.5" fill="currentColor" />)}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="stroke-muted" strokeWidth="1" />
            <circle cx={x(hover)} cy={y(values[hover])} r="5" fill="currentColor" className="stroke-card" strokeWidth="2" />
          </g>
        )}
      </svg>
      <p className="mt-1 text-xs text-muted">Closed trades only, in date order.</p>
    </div>
  )
}
