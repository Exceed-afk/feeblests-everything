// Chart geometry and CSV import for the Statistics panel (Phase 3 charts).
//
// Pure numeric code: no DOM, no colours. The renderer turns these results into
// SVG using theme tokens. Everything here follows the module's input gates
// (toDecimalInput / CalcError) and the dataset size cap (section 11).
import { Decimal, registry } from '../../index'
// Direct import from the statistics module: linearRegression is a hoisted
// function declaration, so the (index -> charts -> index) re-export cycle is safe.
import { linearRegression, quadraticRegression } from './index'
import { CALC_LIMITS, limitMessage } from '../../limits'
import { CalcError } from '../../errors'
import { toDecimalInput, describe } from '../../inputs'

// ---------- Histogram ----------

export interface Bin {
  /** Inclusive lower edge. */
  lo: number
  /** Upper edge: inclusive only for the LAST bin, exclusive for all others. */
  hi: number
  count: number
}

export interface Histogram {
  bins: Bin[]
  binCount: number
  /** How the bin count was chosen: 'sturges' (default rule) or 'manual'. */
  binRule: 'sturges' | 'manual'
  min: number
  max: number
  /** Values strictly above the last upper edge (only possible with manual bins). */
  overflow: number
  total: number
}

/**
 * Sturges' rule: bins = ceil(1 + log2(n)), at least 1 and at most the
 * MAX_BIN_COUNT drawing cap. With n = 1 this gives 1 bin.
 */
export function sturgesBinCount(n: number): number {
  return Math.max(1, Math.min(MAX_BIN_COUNT, Math.ceil(Math.log2(Math.max(n, 1)) + 1)))
}

export const MAX_BIN_COUNT = 100

/**
 * Bin values into `binCount` equal-width bins spanning [min, max].
 *
 * Edge convention (documented for users): each bin is [lo, hi) — the lower edge
 * is inclusive and the upper edge exclusive — EXCEPT the last bin, which is
 * [lo, hi] so the maximum value is always counted. A value exactly on a shared
 * edge therefore belongs to the higher bin.
 *
 * Empty data, and data where min === max, are handled: the latter produces one
 * bin [min, min] holding all values.
 */
export function histogram(values: readonly unknown[], binCount?: number | string): Histogram {
  const nums = values.map((v, i) => toDecimalInput(v, `dataset[${i}]`).toNumber())
  if (nums.length > CALC_LIMITS.datasetSize) {
    throw new CalcError(`${limitMessage('datasetSize', 'values')} (this one has ${nums.length.toLocaleString('en-US')})`)
  }
  if (nums.length === 0) throw new CalcError('Dataset is empty')

  let bins = 0
  let rule: 'sturges' | 'manual' = 'sturges'
  if (binCount === undefined || binCount === null || binCount === '') {
    bins = sturgesBinCount(nums.length)
  } else {
    bins = toDecimalInput(binCount, 'bin count').toNumber()
    if (!Number.isInteger(bins)) throw new CalcError('Bin count must be a whole number')
    if (bins < 1 || bins > MAX_BIN_COUNT) {
      throw new CalcError(`Bin count must be between 1 and ${MAX_BIN_COUNT}`)
    }
    rule = 'manual'
  }

  const min = Math.min(...nums)
  const max = Math.max(...nums)
  // All-equal data: collapse to a single closed bin instead of zero-width edges.
  if (min === max) bins = 1
  const width = bins === 1 || min === max ? 0 : (max - min) / bins
  const counts = new Array<number>(bins).fill(0)
  for (const v of nums) {
    // Zero-width domain (all values equal): everything lands in the single bin.
    let idx = width === 0 ? 0 : Math.floor((v - min) / width)
    if (idx >= bins) idx = bins - 1 // the max value goes into the last bin
    if (idx < 0) idx = 0
    counts[idx]++
  }

  const out: Bin[] = []
  let overflow = 0
  for (let i = 0; i < bins; i++) {
    const lo = min + i * width
    const hi = i === bins - 1 ? max : min + (i + 1) * width
    out.push({ lo, hi, count: counts[i] })
  }
  if (binCount !== undefined && binCount !== null && binCount !== '' && min !== max) {
    // With manual bins narrower than the range nothing can overflow (bins span
    // the full range), but keep the field honest for callers.
    overflow = 0
  }
  return { bins: out, binCount: bins, binRule: rule, min, max, overflow, total: nums.length }
}

// ---------- Box plot ----------

export interface BoxPlot {
  n: number
  min: number
  max: number
  q1: number
  median: number
  q3: number
  iqr: number
  /** Lower/upper whisker: the most extreme data point within the 1.5×IQR fences. */
  whiskerLow: number
  whiskerHigh: number
  /** Data points strictly outside the fences, sorted. */
  outliers: number[]
}

/**
 * Quartiles use the SAME method as the exported `percentile` function:
 * linear interpolation on the (n-1)*p index (the "inclusive" / Tukey-hybrid
 * type-7 definition used by Excel and NumPy's default). See statistics/index.ts.
 */
function percentileOf(sorted: number[], n: number, p: number): number {
  if (n === 1) return sorted[0]
  const idx = (n - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

/**
 * Box plot with Tukey whiskers: fences at q1 - 1.5*IQR and q3 + 1.5*IQR;
 * whiskers reach the most extreme data point inside each fence, everything
 * beyond is listed as an outlier point.
 */
export function boxPlot(values: readonly unknown[]): BoxPlot {
  const nums = values.map((v, i) => toDecimalInput(v, `dataset[${i}]`).toNumber())
  if (nums.length > CALC_LIMITS.datasetSize) {
    throw new CalcError(`${limitMessage('datasetSize', 'values')} (this one has ${nums.length.toLocaleString('en-US')})`)
  }
  if (nums.length === 0) throw new CalcError('Dataset is empty')
  const sorted = [...nums].sort((a, b) => a - b)
  const n = sorted.length
  const q1 = percentileOf(sorted, n, 0.25)
  const median = percentileOf(sorted, n, 0.5)
  const q3 = percentileOf(sorted, n, 0.75)
  const iqr = q3 - q1
  const lowerFence = q1 - 1.5 * iqr
  const upperFence = q3 + 1.5 * iqr

  let whiskerLow = sorted[0]
  let whiskerHigh = sorted[n - 1]
  const outliers: number[] = []
  for (const v of sorted) {
    if (v < lowerFence) outliers.push(v)
    else {
      whiskerLow = v
      break
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    const v = sorted[i]
    if (v > upperFence) outliers.push(v)
    else {
      whiskerHigh = v
      break
    }
  }
  outliers.sort((a, b) => a - b)
  return { n, min: sorted[0], max: sorted[n - 1], q1, median, q3, iqr, whiskerLow, whiskerHigh, outliers }
}

// ---------- Scatter ----------

export interface ScatterPoint {
  x: number
  y: number
}

export interface ScatterData {
  points: ScatterPoint[]
  /** Set when the renderer asked for a cap and the dataset was larger. */
  capped: boolean
  totalCount: number
  /** Present when a regression line was requested. */
  regression?: { slope: number; intercept: number; rSquared: number; model: string }
}

/** Maximum points the SVG scatter draws; beyond this it aggregates (see capScatter). */
export const SCATTER_DRAW_LIMIT = 2_000

/**
 * Prepare paired points for the scatter plot. Optionally attaches the linear
 * regression (slope/intercept/r²) computed from the same data.
 */
export function scatterData(
  xs: readonly unknown[],
  ys: readonly unknown[],
  opts: { regression?: boolean } = {}
): ScatterData {
  if (!Array.isArray(xs) || !Array.isArray(ys)) {
    throw new CalcError(`x and y must be lists of numbers (got ${describe(xs)} and ${describe(ys)})`)
  }
  if (xs.length > CALC_LIMITS.datasetSize || ys.length > CALC_LIMITS.datasetSize) {
    throw new CalcError(limitMessage('datasetSize', 'values'))
  }
  if (xs.length !== ys.length) {
    throw new CalcError(`x and y must have the same length (got ${xs.length} and ${ys.length})`)
  }
  if (xs.length === 0) throw new CalcError('Dataset is empty')
  const points: ScatterPoint[] = xs.map((v, i) => ({
    x: toDecimalInput(v, `x[${i}]`).toNumber(),
    y: toDecimalInput(ys[i], `y[${i}]`).toNumber()
  }))
  const out: ScatterData = { points, capped: false, totalCount: points.length }
  if (opts.regression) {
    // Reuse the module's linear regression for slope/intercept/r².
    const dec = points.map((p) => new Decimal(p.x))
    const decY = points.map((p) => new Decimal(p.y))
    try {
      const r = linearRegression(dec, decY)
      out.regression = {
        slope: r.coefficients[1].toNumber(),
        intercept: r.coefficients[0].toNumber(),
        rSquared: r.rSquared.toNumber(),
        model: 'linear'
      }
    } catch {
      // All x identical: no line can be fitted; draw the points without one.
      out.regression = undefined
    }
  }
  return out
}

/**
 * Reduce points for drawing: keep the first `limit` points as-is, then bin the
 * remainder into a coarse grid so density survives the cap. Returns the points
 * to draw plus a note for the UI.
 */
export function capScatter(points: readonly ScatterPoint[], limit = SCATTER_DRAW_LIMIT): { points: ScatterPoint[]; aggregated: number; note: string | null } {
  if (points.length <= limit) return { points: [...points], aggregated: 0, note: null }
  const kept = points.slice(0, limit)
  const rest = points.slice(limit)
  // Aggregate the tail into a grid so shape is preserved without 98,000 nodes.
  const xs = kept.map((p) => p.x)
  const ys = kept.map((p) => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const cells = new Map<string, { x: number; y: number; n: number }>()
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1
  for (const p of rest) {
    const key = `${Math.round(((p.x - minX) / spanX) * 60)},${Math.round(((p.y - minY) / spanY) * 60)}`
    const cell = cells.get(key)
    if (cell) {
      cell.x = (cell.x * cell.n + p.x) / (cell.n + 1)
      cell.y = (cell.y * cell.n + p.y) / (cell.n + 1)
      cell.n++
    } else cells.set(key, { x: p.x, y: p.y, n: 1 })
  }
  const agg: ScatterPoint[] = [...cells.values()].map((c) => ({ x: c.x, y: c.y }))
  // The grid itself is bounded (60×60), but sparse tails could still exceed the
  // remaining budget: thin the aggregated cells if needed, keeping a spread.
  const budget = Math.max(limit - kept.length, 1)
  const finalAgg = agg.length <= budget ? agg : agg.filter((_, i) => i % Math.ceil(agg.length / budget) === 0)
  return {
    points: [...kept, ...finalAgg],
    aggregated: rest.length,
    note: `Showing ${kept.length.toLocaleString('en-US')} points plus ${finalAgg.length.toLocaleString('en-US')} aggregated cells for the remaining ${rest.length.toLocaleString('en-US')} (draw cap ${limit.toLocaleString('en-US')}).`
  }
}

// ---------- CSV import ----------

export interface CsvTable {
  /** Column names when a header row was detected, otherwise null. */
  header: string[] | null
  rows: string[][]
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = false
      } else cur += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',' || ch === ';') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

const NUMERIC = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

/** A cell that can be parsed as a number (empty cells are NOT numeric). */
export function isNumericCell(text: string): boolean {
  return NUMERIC.test(text.trim())
}

/**
 * Parse CSV text (comma or semicolon separated, quoted cells allowed) and
 * detect whether the first row is a header: it is a header when it contains at
 * least one cell that is not numeric. Fully numeric first rows are data.
 */
export function parseCsv(text: string): CsvTable {
  if (typeof text !== 'string') throw new CalcError(`CSV must be text (got ${describe(text)})`)
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) throw new CalcError('CSV is empty')
  const rows = lines.map(splitCsvLine)
  const first = rows[0]
  const header = first.some((cell) => !isNumericCell(cell)) ? first : null
  return { header, rows: header ? rows.slice(1) : rows }
}

export interface CsvDataset {
  values: Decimal[]
  /** Column name or 1-based column index the values came from. */
  column: string
  rowCount: number
  hadHeader: boolean
}

/**
 * Extract one numeric column from parsed CSV. Every non-numeric cell is
 * rejected with a CalcError naming its 1-based row and column (and the header
 * name when one was detected) — partial data is never applied silently.
 */
export function csvColumn(table: CsvTable, column: number | string): CsvDataset {
  if (!table.rows.length) throw new CalcError('CSV has no data rows')
  const width = Math.max(...table.rows.map((r) => r.length))
  let col: number // 0-based column index
  if (typeof column === 'number') {
    col = column - 1
  } else {
    const name = column.trim()
    if (!table.header) {
      const parsed = Number.parseInt(name, 10)
      if (!Number.isInteger(parsed)) throw new CalcError(`This CSV has no header row: pick a column by number (1-${width})`)
      col = parsed - 1
    } else {
      col = table.header.findIndex((h) => h.toLowerCase() === name.toLowerCase())
      if (col === -1) throw new CalcError(`No column named "${name}" (columns: ${table.header.join(', ')})`)
    }
  }
  const index = col + 1 // 1-based, for messages
  if (!Number.isInteger(col) || col < 0 || index > width) {
    throw new CalcError(`Column ${typeof column === 'number' ? column : `"${column}"`} is not in range (this CSV has ${width} column${width === 1 ? '' : 's'})`)
  }
  if (table.rows.length > CALC_LIMITS.datasetSize) {
    throw new CalcError(`${limitMessage('datasetSize', 'rows')} (this one has ${table.rows.length.toLocaleString('en-US')})`)
  }
  const values: Decimal[] = []
  for (let r = 0; r < table.rows.length; r++) {
    const row = table.rows[r]
    const cell = row[col] ?? ''
    if (!isNumericCell(cell)) {
      const label = table.header?.[col] ? ` (${table.header[col]})` : ''
      throw new CalcError(`Row ${r + 1}, column ${index}${label}: "${cell || '(empty)'}" is not a number`)
    }
    values.push(toDecimalInput(cell, `row ${r + 1}, column ${index}`))
  }
  return {
    values,
    column: table.header?.[col] ?? String(index),
    rowCount: table.rows.length,
    hadHeader: table.header !== null
  }
}

/** Register `stats_histogram` etc. so the values are reachable from expressions too. */
export function registerChartFunctions(): void {
  const numericList = (input: unknown, what: string): number[] => {
    if (!Array.isArray(input)) throw new CalcError(`${what} must be a list of numbers (got ${describe(input)})`)
    return input.map((v, i) => toDecimalInput(v, `${what}[${i}]`).toNumber())
  }

  registry.registerFunction({
    name: 'stats_boxplot',
    category: 'stats',
    description: 'Box plot statistics (type-7 quartiles, 1.5×IQR whiskers) as text',
    examples: ['stats_boxplot(2, 4, 4, 4, 5, 5, 7, 9)'],
    minArity: 1,
    maxArity: 999,
    impl: (args) => {
      const bp = boxPlot(args.map((a) => a))
      return new Decimal(bp.median)
    }
  })
  registry.registerFunction({
    name: 'stats_scatter_r2',
    category: 'stats',
    description: 'R² of the linear fit through paired x/y arguments (x1, y1, x2, y2, ...)',
    examples: ['stats_scatter_r2(1, 2, 2, 4, 3, 6)'],
    minArity: 4,
    maxArity: 999,
    impl: (args) => {
      if (args.length % 2 !== 0) throw new CalcError('stats_scatter_r2 needs pairs of x/y arguments')
      const xs = numericList(args.filter((_, i) => i % 2 === 0), 'x')
      const ys = numericList(args.filter((_, i) => i % 2 === 1), 'y')
      return linearRegression(xs.map((x) => new Decimal(x)), ys.map((y) => new Decimal(y))).rSquared
    }
  })
  registry.registerFunction({
    name: 'stats_quadratic_r2',
    category: 'stats',
    description: 'R² of the least-squares parabola y = ax² + bx + c through paired x/y arguments (x1, y1, x2, y2, ...)',
    examples: ['stats_quadratic_r2(0, 1, 1, 0, 2, 3)'],
    minArity: 6,
    maxArity: 999,
    impl: (args) => {
      if (args.length % 2 !== 0) throw new CalcError('stats_quadratic_r2 needs pairs of x/y arguments')
      const xs = numericList(args.filter((_, i) => i % 2 === 0), 'x')
      const ys = numericList(args.filter((_, i) => i % 2 === 1), 'y')
      return quadraticRegression(xs.map((x) => new Decimal(x)), ys.map((y) => new Decimal(y))).rSquared
    }
  })
}

registerChartFunctions()
