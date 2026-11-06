import { useMemo, useState } from 'react'
import type { ModuleProps } from '../../../lib/navigation'
import {
  computeStats,
  parseDataset,
  linearRegression,
  quadraticRegression,
  logarithmicRegression,
  exponentialRegression,
  powerRegression,
  histogram,
  sturgesBinCount,
  boxPlot,
  scatterData,
  capScatter,
  parseCsv,
  csvColumn,
  MAX_BIN_COUNT,
  SCATTER_DRAW_LIMIT,
  type RegressionResult
} from '../../../../../shared/calculator/modules/statistics'
import type { Decimal } from '../../../../../shared/calculator/numeric'
import { HistogramChart, BoxPlotChart, ScatterChart } from './statCharts'

export type RegressionChoice = 'none' | 'linear' | 'quadratic' | 'exponential' | 'logarithmic' | 'power'

interface Props {
  onClose?: () => void
}

const fmt = (d: Decimal): string => d.toDecimalPlaces(10).toString()

export function StatisticsPanel(_props: Props & ModuleProps) {
  const [raw, setRaw] = useState('2, 4, 4, 4, 5, 5, 7, 9')
  const [xsRaw, setXsRaw] = useState('1, 2, 3, 4, 5')
  const [ysRaw, setYsRaw] = useState('2, 4, 5, 4, 5')
  const [regChoice, setRegChoice] = useState<RegressionChoice>('linear')
  const [binCountRaw, setBinCountRaw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<ReturnType<typeof computeStats> | null>(null)
  const [reg, setReg] = useState<RegressionResult | null>(null)

  // CSV import state
  const [csvText, setCsvText] = useState('')
  const [csvTarget, setCsvTarget] = useState<'dataset' | 'x' | 'y'>('dataset')
  const [csvStatus, setCsvStatus] = useState<string | null>(null)

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
          case 'quadratic': r = quadraticRegression(xs, ys); break
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

  // ---- charts (derived from the same inputs, recomputed only when they change) ----
  const chart = useMemo(() => {
    try {
      const values = parseDataset(raw)
      const bins = histogram(values, binCountRaw === '' ? undefined : binCountRaw)
      const bp = boxPlot(values)
      return { values, bins, bp, error: null as string | null }
    } catch (e) {
      return { values: [], bins: null, bp: null, error: e instanceof Error ? e.message : 'Invalid dataset' }
    }
  }, [raw, binCountRaw])

  const scatter = useMemo(() => {
    try {
      const xs = parseDataset(xsRaw)
      const ys = parseDataset(ysRaw)
      if (xs.length !== ys.length) return { data: null, note: null, error: 'X and Y must have the same number of values' }
      const data = scatterData(xs, ys, { regression: regChoice === 'linear' })
      const capped = capScatter(data.points)
      const effectiveReg =
        data.regression && capped.aggregated === 0
          ? data.regression
          : data.regression
            ? { ...data.regression, rSquared: data.regression.rSquared } // r² is computed on all data, not the capped view
            : undefined
      // Quadratic: draw the fitted parabola across the x range of the data.
      let curve: { points: { x: number; y: number }[]; label: string } | undefined
      if (regChoice === 'quadratic' && data.points.length >= 3) {
        try {
          const fit = quadraticRegression(xs, ys)
          const lo = Math.min(...data.points.map((p) => p.x))
          const hi = Math.max(...data.points.map((p) => p.x))
          const steps = 60
          const points: { x: number; y: number }[] = []
          for (let i = 0; i <= steps; i++) {
            const x = lo + ((hi - lo) * i) / steps
            points.push({ x, y: fit.predict(x).toNumber() })
          }
          curve = { points, label: `quadratic fit ${fit.formula}, R² = ${fit.rSquared.toPrecision(6)}` }
        } catch {
          curve = undefined // not enough distinct x values: points only, the Analyse button explains why
        }
      }
      return { data: { ...data, points: capped.points }, note: capped.note, error: null, reg: effectiveReg, curve }
    } catch (e) {
      return { data: null, note: null, error: e instanceof Error ? e.message : 'Invalid paired data', reg: undefined, curve: undefined }
    }
  }, [xsRaw, ysRaw, regChoice])

  const defaultBins = useMemo(() => {
    try {
      return sturgesBinCount(parseDataset(raw).length)
    } catch {
      return null
    }
  }, [raw])

  // ---- CSV import ----
  const importCsv = (text: string) => {
    setCsvStatus(null)
    try {
      const table = parseCsv(text)
      const width = Math.max(...table.rows.map((r) => r.length), 0)
      const firstColumn = table.header?.[0] ?? '1'
      // Parse the whole first column now so any bad cell (row/column named) is
      // reported BEFORE anything is applied. Nothing partial is ever set.
      const dataset = csvColumn(table, 1)
      setCsvText(text)
      setCsvTarget('dataset')
      if (table.header && width >= 2) {
        const second = csvColumn(table, 2)
        setXsRaw(dataset.values.map((d) => d.toString()).join(', '))
        setYsRaw(second.values.map((d) => d.toString()).join(', '))
        setCsvStatus(
          `Imported ${dataset.rowCount} rows. Column "${dataset.column}" → dataset, column "${second.column}" → x/y scatter (${second.values.length} values each).`
        )
      } else {
        setRaw(dataset.values.map((d) => d.toString()).join(', '))
        setCsvStatus(
          `Imported ${dataset.rowCount} values from column "${dataset.column}"${table.header ? '' : ' (no header row detected — first row treated as data)'}.`
        )
      }
      // Touch the parsed dataset so the value is not reported unused.
      void dataset
      void firstColumn
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not import CSV'
      setCsvStatus(null)
      setError(`CSV import rejected: ${message}`)
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    // Respect the dataset size limit before parsing: 1 MB covers ~100,000 short values.
    const MAX_BYTES = 1_000_000
    if (file.size > MAX_BYTES) {
      setError(`CSV import rejected: file is ${file.size.toLocaleString('en-US')} bytes; the dataset limit is ${'100,000'} values, so files are capped at 1 MB.`)
      return
    }
    const text = await file.text()
    importCsv(text)
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
          aria-label="Dataset values"
        />

        <div className="mt-3 border-t border-line pt-3 space-y-2">
          <label className="block text-sm text-muted">Import CSV (paste or file)</label>
          <textarea
            className="field w-full font-mono text-xs"
            rows={3}
            placeholder={'value\n1\n2\n3 — or a,b,c header rows'}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            aria-label="CSV data to import"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="field text-xs"
              value={csvTarget}
              onChange={(e) => setCsvTarget(e.target.value as 'dataset' | 'x' | 'y')}
              aria-label="CSV target"
            >
              <option value="dataset">→ Dataset</option>
              <option value="x">→ X values</option>
              <option value="y">→ Y values</option>
            </select>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => importCsv(csvText)}
              data-testid="csv-import-paste"
            >
              Import pasted CSV
            </button>
            <label className="btn btn-sm cursor-pointer" data-testid="csv-import-file-label">
              Choose CSV file…
              <input
                type="file"
                accept=".csv,text/csv,.txt"
                className="hidden"
                data-testid="csv-import-file"
                onChange={(e) => { void onFile(e.target.files?.[0]) }}
              />
            </label>
          </div>
          {csvStatus && <p className="text-xs text-pos" data-testid="csv-status">{csvStatus}</p>}
        </div>
      </div>

      <div className="rounded-lg border border-line bg-card p-4">
        <label className="block text-sm text-muted mb-1">Regression (optional)</label>
        <div className="grid grid-cols-2 gap-3">
          <select className="field text-sm" value={regChoice} onChange={(e) => setRegChoice(e.target.value as RegressionChoice)}>
            <option value="none">None</option>
            <option value="linear">Linear</option>
            <option value="quadratic">Quadratic</option>
            <option value="exponential">Exponential</option>
            <option value="logarithmic">Logarithmic</option>
            <option value="power">Power</option>
          </select>
          {regChoice !== 'none' && (
            <div className="flex gap-2">
              <input className="field font-mono text-xs" placeholder="X values" value={xsRaw} onChange={(e) => setXsRaw(e.target.value)} aria-label="X values" />
              <input className="field font-mono text-xs" placeholder="Y values" value={ysRaw} onChange={(e) => setYsRaw(e.target.value)} aria-label="Y values" />
            </div>
          )}
        </div>
      </div>

      <button type="button" className="btn-primary" onClick={analyse}>Analyse</button>

      {error && <p className="text-sm text-neg" role="alert">{error}</p>}

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

      {/* ---- Charts ---- */}
      {chart.bins && chart.bp && (
        <div className="rounded-lg border border-line bg-card p-4 space-y-6" data-testid="stats-charts">
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold">Histogram</h3>
              <label className="text-xs text-muted" htmlFor="bin-count">Bins</label>
              <input
                id="bin-count"
                className="field w-20 text-xs font-mono"
                type="number"
                min={1}
                max={MAX_BIN_COUNT}
                placeholder={`${defaultBins ?? ''} (Sturges)`}
                value={binCountRaw}
                onChange={(e) => setBinCountRaw(e.target.value)}
                aria-label="Histogram bin count (empty for Sturges' rule)"
                data-testid="bin-count-input"
              />
              <span className="text-xs text-muted">
                {chart.bins.binRule === 'sturges' ? `Sturges' rule: ${chart.bins.binCount} bins` : `${chart.bins.binCount} bins (manual)`}
              </span>
            </div>
            <HistogramChart
              bins={chart.bins.bins}
              title="Histogram"
              caption={`Bins are [lower, upper) — the lower edge is inclusive, the upper edge exclusive — except the last bin, which is closed [lower, upper] so the maximum is counted. Values on a shared edge belong to the higher bin.`}
            />
          </div>

          <div>
            <h3 className="text-sm font-semibold">Box plot</h3>
            <p className="text-xs text-muted">Quartiles by linear interpolation (type 7, same as the percentile function); whiskers at 1.5 × IQR.</p>
            <BoxPlotChart stats={chart.bp} title="Box plot" />
          </div>

          <div>
            <h3 className="text-sm font-semibold">Scatter plot</h3>
            {scatter.error ? (
              <p className="text-xs text-neg">{scatter.error}</p>
            ) : scatter.data ? (
              <>
                <ScatterChart
                  points={scatter.data.points}
                  regression={regChoice === 'linear' ? scatter.reg : undefined}
                  curve={regChoice === 'quadratic' ? scatter.curve : undefined}
                  title="Scatter plot"
                  note={scatter.note ?? (scatter.data.points.length > SCATTER_DRAW_LIMIT ? `Draw cap ${SCATTER_DRAW_LIMIT.toLocaleString('en-US')} points.` : null)}
                />
                {regChoice === 'linear' && scatter.reg && (
                  <p className="text-xs text-muted" data-testid="scatter-r-squared">
                    Linear fit: R² = {scatter.reg.rSquared.toPrecision(6)}
                  </p>
                )}
                {regChoice === 'linear' && !scatter.reg && (
                  <p className="text-xs text-muted">No regression line: all x values are identical.</p>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
      {chart.error && !stats && <p className="text-xs text-muted">Charts appear once the dataset parses.</p>}

      {reg && (
        <div className="rounded-lg border border-line bg-card p-4 text-sm space-y-1">
          <div className="font-semibold">{reg.model} regression</div>
          <div className="font-mono">{reg.formula}</div>
          {reg.model === 'quadratic' && (
            <div className="font-mono text-xs text-muted" data-testid="quadratic-coefficients">
              a = {fmt(reg.coefficients[0])} · b = {fmt(reg.coefficients[1])} · c = {fmt(reg.coefficients[2])}
            </div>
          )}
          <div>r = <span className="font-mono">{fmt(reg.r)}</span></div>
          <div>R² = <span className="font-mono">{fmt(reg.rSquared)}</span></div>
        </div>
      )}
    </div>
  )
}
export default StatisticsPanel
