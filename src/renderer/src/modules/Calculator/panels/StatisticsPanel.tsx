import { useState } from 'react'
import type { ModuleProps } from '../../../lib/navigation'
import {
  computeStats,
  parseDataset,
  linearRegression,
  logarithmicRegression,
  exponentialRegression,
  powerRegression,
  type RegressionResult
} from '../../../../../shared/calculator/modules/statistics'
import type { Decimal } from '../../../../../shared/calculator/numeric'

export type RegressionChoice = 'none' | 'linear' | 'exponential' | 'logarithmic' | 'power'

interface Props {
  onClose?: () => void
}

const fmt = (d: Decimal): string => d.toDecimalPlaces(10).toString()

export function StatisticsPanel(_props: Props & ModuleProps) {
  const [raw, setRaw] = useState('2, 4, 4, 4, 5, 5, 7, 9')
  const [xsRaw, setXsRaw] = useState('1, 2, 3, 4, 5')
  const [ysRaw, setYsRaw] = useState('2, 4, 5, 4, 5')
  const [regChoice, setRegChoice] = useState<RegressionChoice>('linear')
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<ReturnType<typeof computeStats> | null>(null)
  const [reg, setReg] = useState<RegressionResult | null>(null)

  const analyse = () => {
    setError(null)
    setReg(null)
    try {
      const values = parseDataset(raw)
      const computed = computeStats(values)
      setStats(computed)

      if (regChoice !== 'none') {
        const xs = parseDataset(xsRaw)
        const ys = parseDataset(ysRaw)
        if (xs.length !== ys.length) throw new Error('X and Y must have the same number of values')
        let r: RegressionResult
        switch (regChoice) {
          case 'linear': r = linearRegression(xs, ys); break
          case 'exponential': r = exponentialRegression(xs, ys); break
          case 'logarithmic': r = logarithmicRegression(xs, ys); break
          case 'power': r = powerRegression(xs, ys); break
        }
        setReg(r)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid dataset')
      setStats(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-card p-4">
        <label className="block text-sm text-muted mb-1">Dataset (comma or space separated)</label>
        <textarea
          className="field w-full font-mono text-sm"
          rows={3}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
      </div>

      <div className="rounded-lg border border-line bg-card p-4">
        <label className="block text-sm text-muted mb-1">Regression (optional)</label>
        <div className="grid grid-cols-2 gap-3">
          <select className="field text-sm" value={regChoice} onChange={(e) => setRegChoice(e.target.value as RegressionChoice)}>
            <option value="none">None</option>
            <option value="linear">Linear</option>
            <option value="exponential">Exponential</option>
            <option value="logarithmic">Logarithmic</option>
            <option value="power">Power</option>
          </select>
          {regChoice !== 'none' && (
            <div className="flex gap-2">
              <input className="field font-mono text-xs" placeholder="X values" value={xsRaw} onChange={(e) => setXsRaw(e.target.value)} />
              <input className="field font-mono text-xs" placeholder="Y values" value={ysRaw} onChange={(e) => setYsRaw(e.target.value)} />
            </div>
          )}
        </div>
      </div>

      <button type="button" className="btn-primary" onClick={analyse}>Analyse</button>

      {error && <p className="text-sm text-neg">{error}</p>}

      {stats && (
        <div className="rounded-lg border border-line bg-card p-4 grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          {[
            ['Count', String(stats.count)],
            ['Sum', fmt(stats.sum)],
            ['Mean', fmt(stats.mean)],
            ['Median', fmt(stats.median)],
            ['Mode', stats.mode.length ? stats.mode.map(fmt).join(', ') : '—'],
            ['Min', fmt(stats.min)],
            ['Max', fmt(stats.max)],
            ['Range', fmt(stats.range)],
            ['Population σ', fmt(stats.stdDev)],
            ['Sample s', fmt(stats.stdDevSample)],
            ['Q1', fmt(stats.q1)],
            ['Q3', fmt(stats.q3)],
            ['IQR', fmt(stats.iqr)]
          ].map(([label, value]) => (
            <div key={label}>
              <div className="text-xs text-muted">{label}</div>
              <div className="font-mono font-semibold">{value}</div>
            </div>
          ))}
        </div>
      )}

      {reg && (
        <div className="rounded-lg border border-line bg-card p-4 text-sm space-y-1">
          <div className="font-semibold">{reg.model} regression</div>
          <div className="font-mono">{reg.formula}</div>
          <div>r = <span className="font-mono">{fmt(reg.r)}</span></div>
          <div>R² = <span className="font-mono">{fmt(reg.rSquared)}</span></div>
        </div>
      )}
    </div>
  )
}
export default StatisticsPanel
