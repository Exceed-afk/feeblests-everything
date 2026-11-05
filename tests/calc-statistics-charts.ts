// Known-answer tests for the chart geometry and CSV import in
// src/shared/calculator/modules/statistics/charts.ts. Pure, no DOM:
//   tsx tests/calc-statistics-charts.ts
import assert from 'node:assert/strict'
import {
  histogram, sturgesBinCount, boxPlot, scatterData, capScatter, SCATTER_DRAW_LIMIT,
  parseCsv, csvColumn, isNumericCell, MAX_BIN_COUNT
} from '../src/shared/calculator/modules/statistics'

let count = 0
const ok = () => { count++ }
const messageOf = (fn: () => unknown): string => {
  try {
    fn()
    return ''
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

// ---------- Sturges' rule ----------
assert.equal(sturgesBinCount(1), 1); ok()
assert.equal(sturgesBinCount(8), 4); ok() // ceil(1 + log2 8) = 4
assert.equal(sturgesBinCount(10), 5); ok()
assert.equal(sturgesBinCount(100), 8); ok()
assert.equal(sturgesBinCount(100_000), 18); ok()

// ---------- Histogram ----------
// Even data 0..9: min 0, max 9, 3 bins => width 3, edges 0/3/6/9.
{
  const h = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ n })).map((o) => o.n).map((v) => v), 3)
  assert.equal(h.binCount, 3); ok()
  assert.deepEqual(h.bins.map((b) => b.count), [3, 3, 4]); ok()
  // Edge convention: lower edge inclusive, upper exclusive, last bin closed.
  assert.equal(h.bins[2].hi, 9); ok()
}
// Value exactly on an edge belongs to the higher bin: 3 goes into [3,6), not [0,3).
{
  const h = histogram([0, 3, 6, 9], 3)
  assert.deepEqual(h.bins.map((b) => b.count), [1, 1, 2]); ok()
}
// Default bins by Sturges' rule
{
  const h = histogram([2, 4, 4, 4, 5, 5, 7, 9])
  assert.equal(h.binCount, 4); ok()
  assert.equal(h.binRule, 'sturges'); ok()
  assert.equal(h.total, 8); ok()
}
// Empty data
assert.match(messageOf(() => histogram([])), /Dataset is empty/); ok()
// One value: 1 bin holding it
{
  const h = histogram([7])
  assert.equal(h.binCount, 1); ok()
  assert.deepEqual(h.bins.map((b) => b.count), [1]); ok()
  assert.equal(h.bins[0].lo, 7); ok()
  assert.equal(h.bins[0].hi, 7); ok()
}
// All-equal values: single bin, zero width
{
  const h = histogram([5, 5, 5])
  assert.equal(h.bins.length, 1); ok()
  assert.equal(h.bins[0].count, 3); ok()
  assert.equal(h.bins[0].lo, 5); ok()
  assert.equal(h.bins[0].hi, 5); ok()
}
// Negative values
{
  const h = histogram([-5, -3, -1], 2)
  assert.equal(h.min, -5); ok()
  assert.equal(h.max, -1); ok()
  assert.equal(h.bins[0].lo, -5); ok()
}
// Outlier with manual bins: bins span the data (1..100, width 24.75), so
// 1..4 all land in the first bin and 100 in the last (closed) bin.
{
  const h = histogram([1, 2, 3, 4, 100], 4)
  assert.equal(h.bins[0].count, 4); ok()
  assert.equal(h.bins[3].count, 1); ok() // 100 in the last (closed) bin
}
// Manual bin count bounds
assert.match(messageOf(() => histogram([1], 0)), /Bin count must be between/); ok()
assert.match(messageOf(() => histogram([1], MAX_BIN_COUNT + 1)), /Bin count must be between/); ok()

// ---------- Box plot ----------
// Textbook set 2,4,4,4,5,5,7,9: type-7 quartiles q1=4, median=4.5, q3=5.5, IQR=1.5.
// Fences: 4 - 2.25 = 1.75 and 5.5 + 2.25 = 7.75. Whiskers: low 2, high 7; outliers [9].
{
  const b = boxPlot([2, 4, 4, 4, 5, 5, 7, 9])
  assert.equal(b.n, 8); ok()
  assert.equal(b.q1, 4); ok()
  assert.equal(b.median, 4.5); ok()
  assert.equal(b.q3, 5.5); ok()
  assert.equal(b.iqr, 1.5); ok()
  assert.equal(b.whiskerLow, 2); ok()
  assert.equal(b.whiskerHigh, 7); ok()
  assert.deepEqual(b.outliers, [9]); ok()
}
// Empty
assert.match(messageOf(() => boxPlot([])), /Dataset is empty/); ok()
// One value: quartiles and whiskers all the value, no outliers
{
  const b = boxPlot([7])
  assert.equal(b.q1, 7); ok()
  assert.equal(b.median, 7); ok()
  assert.equal(b.q3, 7); ok()
  assert.equal(b.whiskerLow, 7); ok()
  assert.equal(b.whiskerHigh, 7); ok()
  assert.deepEqual(b.outliers, []); ok()
}
// All-equal: IQR 0, fences at the value, no outliers
{
  const b = boxPlot([5, 5, 5])
  assert.equal(b.iqr, 0); ok()
  assert.deepEqual(b.outliers, []); ok()
}
// Negative values
{
  const b = boxPlot([-10, -2, -1, 0, 1, 2, 10])
  // sorted, n=7: q1 idx 1.5 => -1.5; median (idx 3) => 0; q3 idx 4.5 => 1.5; IQR 3;
  // fences -6 / 6 => whiskers -2 / 2, outliers [-10, 10]
  assert.equal(b.q1, -1.5); ok()
  assert.equal(b.median, 0); ok()
  assert.equal(b.q3, 1.5); ok()
  assert.deepEqual(b.outliers, [-10, 10]); ok()
  assert.equal(b.whiskerLow, -2); ok()
  assert.equal(b.whiskerHigh, 2); ok()
}
// Symmetric data has no outliers even with a wide spread
{
  const b = boxPlot([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  assert.deepEqual(b.outliers, []); ok()
}

// ---------- Scatter ----------
{
  const s = scatterData([1, 2, 3], [2, 4, 6], { regression: true })
  assert.equal(s.points.length, 3); ok()
  assert.equal(s.regression?.slope, 2); ok()
  assert.equal(s.regression?.intercept, 0); ok()
  assert.equal(s.regression?.rSquared, 1); ok()
}
// Perfect fit with intercept
{
  const s = scatterData([0, 1, 2, 3], [1, 3, 5, 7], { regression: true })
  assert.equal(s.regression?.slope, 2); ok()
  assert.equal(s.regression?.intercept, 1); ok()
  assert.equal(s.regression?.rSquared, 1); ok()
}
// Regression computed on ALL data even when the draw cap kicks in
{
  const big = Array.from({ length: SCATTER_DRAW_LIMIT + 500 }, (_, i) => i)
  const s = scatterData(big, big.map((x) => 2 * x + 1), { regression: true })
  const capped = capScatter(s.points)
  assert.ok(capped.aggregated > 0); ok()
  assert.ok(capped.points.length <= SCATTER_DRAW_LIMIT * 1.1, `capped draw count ${capped.points.length}`); ok()
  assert.ok(capped.note && capped.note.includes('aggregated'), `note mentions aggregation: ${capped.note}`); ok()
  assert.equal(s.regression?.rSquared, 1); ok() // exact fit over the full dataset
}
// Mismatched lengths, empty, non-numeric
assert.match(messageOf(() => scatterData([1, 2], [1])), /same length/); ok()
assert.match(messageOf(() => scatterData([], [])), /Dataset is empty/); ok()
assert.match(messageOf(() => scatterData(['a', 2], [1, 2])), /x\[0\]/); ok()

// ---------- CSV ----------
// Header detection: a non-numeric first row is a header, an all-numeric one is data.
{
  const t = parseCsv('value\n1\n2')
  assert.deepEqual(t.header, ['value']); ok()
  assert.equal(t.rows.length, 2); ok()
}
{
  const t = parseCsv('1,2\n3,4')
  assert.equal(t.header, null); ok()
  assert.equal(t.rows.length, 2); ok()
}
// Quoted cells and semicolons
{
  const t = parseCsv('a,b\n"x, y",3')
  assert.deepEqual(t.rows[0], ['x, y', '3']); ok()
}
{
  const t = parseCsv('a;b\n1;2')
  assert.deepEqual(t.rows[0], ['1', '2']); ok()
}
// Empty input
assert.match(messageOf(() => parseCsv('')), /CSV is empty/); ok()

// Column extraction by name and by number
{
  const t = parseCsv('name,value\na,1\nb,2')
  const col = csvColumn(t, 'value')
  assert.equal(col.values.length, 2); ok()
  assert.equal(col.column, 'value'); ok()
  assert.equal(col.hadHeader, true); ok()
}
{
  const t = parseCsv('1,2\n3,4')
  const col = csvColumn(t, 1)
  assert.equal(col.column, '1'); ok()
  assert.equal(col.hadHeader, false); ok()
}
// Non-numeric cell names row and column (1-based row, header name when present)
{
  const t = parseCsv('value\n1\noops\n3')
  const msg = messageOf(() => csvColumn(t, 'value'))
  assert.match(msg, /Row 2, column 1 \(value\)/); ok()
  assert.match(msg, /oops/); ok()
}
{
  // Mixed header row ('1' numeric, 'x' not) => header detected; column 2 is all numbers.
  const t = parseCsv('1,x\n2,3')
  assert.equal(t.header !== null, true); ok()
  const good = csvColumn(t, 2)
  assert.equal(good.values.length, 1); ok()
  // A fully numeric first row is data, not a header.
  const noHdr = parseCsv('1,2\n3,4')
  assert.equal(noHdr.header, null); ok()
  const msg2 = messageOf(() => csvColumn(parseCsv('1,x\n2,bad'), 2))
  assert.match(msg2, /Row 1, column 2 \(x\): "bad"/); ok()
}
// Unknown column name / out-of-range index
{
  const t = parseCsv('a\n1')
  assert.match(messageOf(() => csvColumn(t, 'b')), /No column named "b"/); ok()
  assert.match(messageOf(() => csvColumn(t, 5)), /not in range/); ok()
  assert.match(messageOf(() => csvColumn(parseCsv('a\n1'), 99)), /not in range/); ok()
}
// Empty cell in the chosen column
{
  const t = parseCsv('a,b\n1,\n2,3')
  assert.match(messageOf(() => csvColumn(t, 'b')), /Row 1, column 2 \(b\): "\(empty\)"/); ok()
}
// isNumericCell
assert.equal(isNumericCell(' 3.5 '), true); ok()
assert.equal(isNumericCell('-2e3'), true); ok()
assert.equal(isNumericCell(''), false); ok()
assert.equal(isNumericCell('oops'), false); ok()
assert.equal(isNumericCell('1,5'), false); ok()

// Size limit respected: a CSV over the dataset cap is rejected, not truncated
{
  const rows = Array.from({ length: 100_001 }, (_, i) => String(i)).join('\n')
  const t = parseCsv(`v\n${rows}`)
  const msg = messageOf(() => csvColumn(t, 'v'))
  assert.match(msg, /dataset size is limited to 100,000/); ok()
  assert.match(msg, /100,001/); ok()
}

// ---------- never apply partial data silently ----------
// The API contract: csvColumn either returns ALL rows of the column or throws.
// Verify a mixed-good/bad CSV yields no values at all.
{
  const t = parseCsv('v\n1\n2\nbad')
  let thrown = false
  try {
    csvColumn(t, 'v')
  } catch {
    thrown = true
  }
  assert.ok(thrown, 'a CSV with one bad cell must fail the whole import'); ok()
}

console.log(`ok   ${count} statistics chart and CSV reference checks passed`)


