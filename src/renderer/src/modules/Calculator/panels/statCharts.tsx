// SVG chart components for the Statistics panel.
//
// All colours come from theme tokens / classes (text-muted, stroke-line,
// fill-accent...). No hard-coded colours: the same SVG works in light and dark.
// Each chart has an accessible label (role="img", aria-label) and a data-table
// fallback rendered as a collapsible <details> element next to it.
import { useId, useState } from 'react'

export interface ChartTableColumn {
  label: string
  /** Values already formatted for display. */
  values: string[]
}

/** A collapsible text/table fallback below each chart. */
export function ChartDataTable({ label, columns }: { label: string; columns: ChartTableColumn[] }) {
  const rows = Math.max(...columns.map((c) => c.values.length), 0)
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted hover:text-fg">Data table for {label.toLowerCase()}</summary>
      <div className="overflow-x-auto mt-1" data-testid="chart-data-table">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.label} className="text-left text-muted font-semibold px-2 py-1 border-b border-line">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                {columns.map((c) => (
                  <td key={c.label} className="px-2 py-1 font-mono border-b border-line">{c.values[r] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

const AXIS = 'stroke-line'
const FILL = 'fill-accent'
const TEXT = 'text-muted'

/** Shared scale helpers. */
const nice = (v: number): number => {
  const abs = Math.abs(v)
  if (abs === 0) return 0
  const mag = Math.pow(10, Math.floor(Math.log10(abs)))
  return Math.ceil(v / mag) * mag
}

export interface HistogramChartProps {
  bins: { lo: number; hi: number; count: number }[]
  title: string
  caption?: string
}

/** Bar-per-bin SVG histogram. Bins are already aggregated (MAX 100), so the node count stays small. */
export function HistogramChart({ bins, title, caption }: HistogramChartProps) {
  const id = useId()
  const W = 420
  const H = 200
  const PAD = { l: 8, r: 8, t: 12, b: 20 }
  const maxCount = Math.max(...bins.map((b) => b.count), 1)
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const bw = innerW / bins.length
  const yTop = nice(maxCount)
  return (
    <figure className="mt-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`${title}: histogram with ${bins.length} bins, tallest bin has ${maxCount} values`}
        data-testid="chart-histogram"
      >
        {/* baseline */}
        <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} className={AXIS} strokeWidth="1" />
        {/* y top tick */}
        <text x={PAD.l} y={PAD.t + 8} className={TEXT} fontSize="9" fill="currentColor">{yTop}</text>
        {bins.map((b, i) => {
          const h = (b.count / yTop) * innerH
          const x = PAD.l + i * bw
          return (
            <rect
              key={i}
              x={x + 0.5}
              y={H - PAD.b - h}
              width={Math.max(bw - 1, 1)}
              height={Math.max(h, b.count > 0 ? 1 : 0)}
              className={FILL}
              opacity="0.85"
            ><title>{`[${b.lo} – ${b.hi}${i === bins.length - 1 ? ' inclusive' : ''}): ${b.count}`}</title></rect>
          )
        })}
        <text x={PAD.l} y={H - 6} className={TEXT} fontSize="9" fill="currentColor">{bins[0]?.lo ?? ''}</text>
        <text x={W - PAD.r} y={H - 6} className={`${TEXT} text-right`} fontSize="9" fill="currentColor" textAnchor="end">{bins[bins.length - 1]?.hi ?? ''}</text>
      </svg>
      {caption && <figcaption className="text-xs text-muted mt-1">{caption}</figcaption>}
      <ChartDataTable
        label={title}
        columns={[
          { label: 'Bin', values: bins.map((b, i) => `[${b.lo} – ${b.hi}${i === bins.length - 1 ? ']' : ')'} `) },
          { label: 'Count', values: bins.map((b) => String(b.count)) }
        ]}
      />
    </figure>
  )
}

export interface BoxPlotChartProps {
  stats: {
    min: number
    q1: number
    median: number
    q3: number
    max: number
    whiskerLow: number
    whiskerHigh: number
    outliers: number[]
  }
  title: string
}

/** Horizontal box-and-whisker; outliers drawn as individual circles. */
export function BoxPlotChart({ stats, title }: BoxPlotChartProps) {
  const W = 420
  const H = 90
  const PAD = 24
  const lo = Math.min(stats.min, ...stats.outliers)
  const hi = Math.max(stats.max, ...stats.outliers)
  const span = hi - lo || 1
  const x = (v: number) => PAD + ((v - lo) / span) * (W - 2 * PAD)
  const mid = H / 2
  const boxTop = mid - 14
  const boxBottom = mid + 14
  return (
    <figure className="mt-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`${title}: box plot with median ${stats.median}, IQR from ${stats.q1} to ${stats.q3}, whiskers ${stats.whiskerLow} to ${stats.whiskerHigh}, ${stats.outliers.length} outliers`}
        data-testid="chart-boxplot"
      >
        {/* whiskers */}
        <line x1={x(stats.whiskerLow)} y1={mid} x2={x(stats.q1)} y2={mid} className={AXIS} strokeWidth="1" />
        <line x1={x(stats.q3)} y1={mid} x2={x(stats.whiskerHigh)} y2={mid} className={AXIS} strokeWidth="1" />
        <line x1={x(stats.whiskerLow)} y1={boxTop} x2={x(stats.whiskerLow)} y2={boxBottom} className={AXIS} strokeWidth="1" />
        <line x1={x(stats.whiskerHigh)} y1={boxTop} x2={x(stats.whiskerHigh)} y2={boxBottom} className={AXIS} strokeWidth="1" />
        {/* box */}
        <rect x={x(stats.q1)} y={boxTop} width={Math.max(x(stats.q3) - x(stats.q1), 1)} height={boxBottom - boxTop} className={`${FILL}`} opacity="0.35" rx="2" />
        {/* median */}
        <line x1={x(stats.median)} y1={boxTop} x2={x(stats.median)} y2={boxBottom} className={AXIS} strokeWidth="2" />
        {/* outliers as points */}
        {stats.outliers.map((v, i) => (
          <circle key={i} cx={x(v)} cy={mid} r="3" className={FILL}><title>{`Outlier: ${v}`}</title></circle>
        ))}
        <text x={PAD} y={H - 2} className={TEXT} fontSize="9" fill="currentColor">{lo}</text>
        <text x={W - PAD} y={H - 2} className={TEXT} fontSize="9" fill="currentColor" textAnchor="end">{hi}</text>
      </svg>
      <ChartDataTable
        label={title}
        columns={[{
          label: 'Min / Q1 / Median / Q3 / Max / Whiskers / Outliers',
          values: [
            `min ${stats.min}, q1 ${stats.q1}, median ${stats.median}, q3 ${stats.q3}, max ${stats.max}`,
            `whiskers ${stats.whiskerLow} – ${stats.whiskerHigh}`,
            stats.outliers.length ? `outliers ${stats.outliers.join(', ')}` : 'no outliers'
          ]
        }]}
      />
    </figure>
  )
}

export interface ScatterChartProps {
  points: { x: number; y: number }[]
  regression?: { slope: number; intercept: number; rSquared: number }
  /** A fitted curve drawn as a polyline (quadratic regression). */
  curve?: { points: { x: number; y: number }[]; label: string }
  title: string
  note?: string | null
}

/** Scatter with optional least-squares line. Points are capped before reaching this component. */
export function ScatterChart({ points, regression, curve, title, note }: ScatterChartProps) {
  const W = 420
  const H = 240
  const PAD = 28
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1
  const px = (v: number) => PAD + ((v - minX) / spanX) * (W - 2 * PAD)
  const py = (v: number) => H - PAD - ((v - minY) / spanY) * (H - 2 * PAD)
  return (
    <figure className="mt-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`${title}: scatter plot of ${points.length} points${regression ? `, linear regression y = ${regression.slope}x + ${regression.intercept}, R² = ${regression.rSquared}` : ''}${curve ? `, ${curve.label}` : ''}`}
        data-testid="chart-scatter"
      >
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} className={AXIS} strokeWidth="1" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} className={AXIS} strokeWidth="1" />
        {regression && (
          <line
            x1={px(minX)} y1={py(regression.slope * minX + regression.intercept)}
            x2={px(maxX)} y2={py(regression.slope * maxX + regression.intercept)}
            className={AXIS} strokeWidth="1.5" strokeDasharray="4 3"
          />
        )}
        {curve && curve.points.length > 1 && (
          <polyline
            points={curve.points.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')}
            fill="none"
            className={AXIS}
            strokeWidth="1.5"
            data-testid="chart-scatter-curve"
          />
        )}
        {points.map((p, i) => (
          <circle key={i} cx={px(p.x)} cy={py(p.y)} r="2.5" className={FILL} opacity="0.75"><title>{`(${p.x}, ${p.y})`}</title></circle>
        ))}
        <text x={PAD} y={H - 8} className={TEXT} fontSize="9" fill="currentColor">{minX}</text>
        <text x={W - PAD} y={H - 8} className={TEXT} fontSize="9" fill="currentColor" textAnchor="end">{maxX}</text>
      </svg>
      {note && <figcaption className="text-xs text-muted mt-1">{note}</figcaption>}
      <ChartDataTable
        label={title}
        columns={[
          { label: 'x', values: points.slice(0, 200).map((p) => String(p.x)) },
          { label: 'y', values: points.slice(0, 200).map((p) => String(p.y)) }
        ]}
      />
    </figure>
  )
}
