// docs/calculator-testing-guide.md — Section 3: Statistics and probability.
// Run on its own:  npx tsx tests/calc-guide-section3.ts
import {
  computeStats, linearRegression, quadraticRegression, exponentialRegression,
  normal, binomial, poisson, studentT, chiSquare, uniform,
  histogram, boxPlot, scatterData, parseCsv, csvColumn, parseDataset
} from '../src/shared/calculator/modules/statistics'
import { Decimal } from '../src/shared/calculator/numeric'
import { GuideSuite, finish, expectText, expectClose, expectError, GuideMismatch } from './calc-guide-common'

export const suite = new GuideSuite('Section 3: Statistics and probability', 'Statistics')

const d = (n: number | string) => new Decimal(n)
const dataset = [2, 4, 4, 4, 5, 5, 7, 9].map(d)
const s = computeStats(dataset)

// ---------- Descriptive statistics ----------
suite.test('Count', '2, 4, 4, 4, 5, 5, 7, 9', '8', () => expectText(String(s.count), '8'))
suite.test('Sum', '2, 4, 4, 4, 5, 5, 7, 9', '40', () => expectText(s.sum.toString(), '40'))
suite.test('Mean', '2, 4, 4, 4, 5, 5, 7, 9', '5', () => expectText(s.mean.toString(), '5'))
suite.test('Median', '2, 4, 4, 4, 5, 5, 7, 9', '4.5', () => expectText(s.median.toString(), '4.5'))
suite.test('Mode', '2, 4, 4, 4, 5, 5, 7, 9', '4', () => expectText(s.mode.map(String).join(', '), '4'))
suite.test('Minimum / Maximum', '2, 4, 4, 4, 5, 5, 7, 9', '2 / 9', () => expectText(`${s.min} / ${s.max}`, '2 / 9'))
suite.test('Range', '2, 4, 4, 4, 5, 5, 7, 9', '7', () => expectText(s.range.toString(), '7'))
suite.test('Population variance', '2, 4, 4, 4, 5, 5, 7, 9', '4', () => expectText(s.variance.toString(), '4'))
suite.test('Population standard deviation', '2, 4, 4, 4, 5, 5, 7, 9', '2', () => expectText(s.stdDev.toString(), '2'))
suite.test('Sample variance', '2, 4, 4, 4, 5, 5, 7, 9', '4.5714', () => expectClose(s.varianceSample.toString(), 4.5714, 1e-4))
suite.test('Sample standard deviation', '2, 4, 4, 4, 5, 5, 7, 9', '2.1381', () => expectClose(s.stdDevSample.toString(), 2.1381, 1e-4))
suite.test('Q1 / Q3', '2, 4, 4, 4, 5, 5, 7, 9', '4 / 6 (other methods may differ slightly)', () => {
  // Type-7 (linear interpolation) quartiles: Q1 = 4, Q3 = 5.5. The guide allows other methods.
  const q1 = s.q1.toNumber()
  const q3 = s.q3.toNumber()
  if (Math.abs(q1 - 4) > 1e-9) throw new GuideMismatch(`Q1 = ${q1}`)
  if (Math.abs(q3 - 6) > 1e-9 && Math.abs(q3 - 5.5) > 1e-9) throw new GuideMismatch(`Q3 = ${q3}`)
  return { actual: `${q1} / ${q3}` }
})

// ---------- Edge cases for datasets ----------
suite.test('Empty dataset', '(empty)', 'A clear message, no crash', () => expectError(() => computeStats([]), /empty/i))
suite.test('One value (5)', '5', 'Mean 5, sample SD undefined (error or n/a), not 0 and not a crash', () => {
  const one = computeStats([d(5)])
  if (one.mean.toString() !== '5') throw new GuideMismatch(`mean ${one.mean}`)
  try {
    const s = one.stdDevSample
    if (s.isZero()) throw new GuideMismatch('sample SD = 0', 'sample SD of a single value must be undefined, not 0')
    return { actual: `mean 5, sample SD ${s}` }
  } catch (err) {
    return { actual: `mean 5, sample SD undefined (error: ${(err as Error).message})` }
  }
})
suite.test('All the same values (3, 3, 3, 3)', '3, 3, 3, 3', 'Standard deviation 0', () =>
  expectText(computeStats([3, 3, 3, 3].map(d)).stdDev.toString(), '0'))
suite.test('Negative numbers and decimals (-1.5, 2.25, 0)', '-1.5, 2.25, 0', 'Works', () => {
  const neg = computeStats([-1.5, 2.25, 0].map(d))
  if (neg.count !== 3) throw new GuideMismatch(`count ${neg.count}`)
  return expectText(neg.mean.toString(), '0.25')
})
suite.test('Text in the data (2, abc, 4)', '2, abc, 4', 'Rejected or skipped with a visible warning', () =>
  expectError(() => computeStats(['2', 'abc', '4'] as unknown as Decimal[]), /must be a number/i))
suite.test('Pasting from a spreadsheet column', '2\n4\n4\n4\n5\n5\n7\n9', 'Works', () => {
  // The panel's text-dataset entry point accepts a pasted column (newline separated).
  const pasted = computeStats(parseDataset('2\n4\n4\n4\n5\n5\n7\n9'))
  return expectText(pasted.mean.toString(), '5')
})
suite.test('Importing a CSV', 'value\n2\n4\n4\n4\n5\n5\n7\n9', 'Works', () => {
  const table = parseCsv('value\n2\n4\n4\n4\n5\n5\n7\n9')
  const col = csvColumn(table, 'value')
  return expectText(computeStats(col.values).mean.toString(), '5')
})
suite.test('A bad CSV gives a clear error', 'value\n2\nabc\n4', 'Clear error', () =>
  expectError(() => csvColumn(parseCsv('value\n2\nabc\n4'), 'value'), /not a number/i))
suite.test('10,000 values', '1..10000', 'Stays responsive', () => {
  const big = Array.from({ length: 10_000 }, (_, i) => d(i + 1))
  const started = Date.now()
  const stats = computeStats(big)
  const ms = Date.now() - started
  if (stats.count !== 10_000) throw new GuideMismatch(`count ${stats.count}`)
  if (ms > 5000) throw new GuideMismatch(`${ms} ms`, 'took too long')
  return { actual: `mean ${stats.mean}, ${ms} ms` }
})
suite.test('Change one value: all statistics update', '2, 4, 4, 4, 5, 5, 7, 9 -> 2, 4, 4, 4, 5, 5, 7, 10', 'Mean 5.125', () => {
  const changed = computeStats([2, 4, 4, 4, 5, 5, 7, 10].map(d))
  return expectText(changed.mean.toString(), '5.125')
})

// ---------- Regression ----------
const lin = linearRegression([1, 2, 3, 4, 5].map(d), [2, 3, 5, 4, 6].map(d))
suite.test('Linear regression: slope', '(1,2), (2,3), (3,5), (4,4), (5,6)', '0.9', () => expectText(lin.coefficients[1].toString(), '0.9'))
suite.test('Linear regression: intercept', '(1,2), (2,3), (3,5), (4,4), (5,6)', '1.3', () => expectText(lin.coefficients[0].toString(), '1.3'))
suite.test('Linear regression: r', '(1,2), (2,3), (3,5), (4,4), (5,6)', '0.9', () => expectClose(lin.r.toString(), 0.9, 1e-9))
suite.test('Linear regression: R squared', '(1,2), (2,3), (3,5), (4,4), (5,6)', '0.81', () => expectClose(lin.rSquared.toString(), 0.81, 1e-9))
suite.test('Perfect line', '(1,2), (2,4), (3,6), (4,8)', 'y = 2x, r = 1', () => {
  const p = linearRegression([1, 2, 3, 4].map(d), [2, 4, 6, 8].map(d))
  if (p.coefficients[1].toString() !== '2' || p.coefficients[0].toString() !== '0' || p.r.toString() !== '1') {
    throw new GuideMismatch(`y = ${p.coefficients[1]}x + ${p.coefficients[0]}, r = ${p.r}`)
  }
  return { actual: 'y = 2x + 0, r = 1' }
})
suite.test('Quadratic regression', '(0,1), (1,2), (2,5), (3,10)', 'y = x^2 + 1 (a = 1, b = 0, c = 1)', () => {
  const q = quadraticRegression([0, 1, 2, 3].map(d), [1, 2, 5, 10].map(d))
  const [a, b, c] = q.coefficients.map(String)
  if (a !== '1' || b !== '0' || c !== '1') throw new GuideMismatch(`a=${a}, b=${b}, c=${c}`)
  return { actual: `a=${a}, b=${b}, c=${c}` }
})
suite.test('Exponential regression', '(0,1), (1,2), (2,4), (3,8)', 'a = 1, b = 0.6931 (y = a * e^(b*x))', () => {
  const e = exponentialRegression([0, 1, 2, 3].map(d), [1, 2, 4, 8].map(d))
  const [a, b] = e.coefficients
  // a is exp(ln(1)) through the Decimal path, so it can land a few ulps off 1.
  if (Math.abs(a.toNumber() - 1) > 1e-9) throw new GuideMismatch(`a = ${a}`)
  return expectClose(b.toString(), 0.6931, 1e-4)
})
suite.test('Regression edge: all x the same (vertical line)', 'x = 2, 2, 2', 'A clear error', () =>
  expectError(() => linearRegression([2, 2, 2].map(d), [1, 2, 3].map(d)), /identical/i))
suite.test('Regression edge: only one point', '(1, 2)', 'An error', () =>
  expectError(() => linearRegression([1].map(d), [2].map(d)), /at least 2/i))
suite.test('Regression edge: two points', '(1, 2), (2, 4)', 'An exact line', () => {
  const two = linearRegression([1, 2].map(d), [2, 4].map(d))
  return expectText(`y = ${two.coefficients[1]}x + ${two.coefficients[0]}`, 'y = 2x + 0')
})

// ---------- Distributions ----------
suite.test('Normal CDF at 0 (mean 0, SD 1)', 'x=0, mean=0, sd=1', '0.5', () => expectClose(normal.cdf(0, 0, 1), 0.5, 1e-6))
suite.test('Normal CDF at 1', 'x=1, mean=0, sd=1', '0.8413', () => expectClose(normal.cdf(1, 0, 1), 0.8413, 1e-4))
suite.test('Normal CDF at 1.96', 'x=1.96, mean=0, sd=1', '0.9750', () => expectClose(normal.cdf(1.96, 0, 1), 0.975, 1e-4))
suite.test('Normal inverse CDF at 0.975', 'p=0.975, mean=0, sd=1', '1.9600', () => expectClose(normal.inv(0.975, 0, 1), 1.96, 1e-4))
suite.test('Normal with mean 100, SD 15: CDF at 115', 'x=115, mean=100, sd=15', '0.8413', () => expectClose(normal.cdf(115, 100, 15), 0.8413, 1e-4))
suite.test('Binomial (n=10, p=0.5): exactly 5', 'k=5, n=10, p=0.5', '0.2461', () => expectClose(binomial.pdf(5, 10, 0.5), 0.2461, 1e-4))
suite.test('Binomial (n=10, p=0.5): 5 or fewer', 'k=5, n=10, p=0.5', '0.6230', () => expectClose(binomial.cdf(5, 10, 0.5), 0.623, 1e-4))
suite.test('Poisson (lambda=3): exactly 2', 'k=2, lambda=3', '0.2240', () => expectClose(poisson.pdf(2, 3), 0.224, 1e-4))
suite.test('Poisson (lambda=3): exactly 0', 'k=0, lambda=3', '0.0498', () => expectClose(poisson.pdf(0, 3), 0.0498, 1e-4))
suite.test('t distribution CDF at 0', 't=0, df=10', '0.5', () => expectText(String(studentT.cdf(0, 10)), '0.5'))
suite.test('t critical value, 95% two-sided, df = 10', 'p=0.975, df=10', '2.228', () => expectClose(studentT.inv(0.975, 10), 2.228, 1e-3))
suite.test('Chi-square critical value, 95%, df = 1', 'p=0.95, df=1', '3.841', () => expectClose(chiSquare.inv(0.95, 1), 3.841, 1e-3))
suite.test('Chi-square critical value, 95%, df = 2', 'p=0.95, df=2', '5.991', () => expectClose(chiSquare.inv(0.95, 2), 5.991, 1e-3))
suite.test('Uniform (0 to 10): below 2.5', 'x=2.5, a=0, b=10', '0.25', () => expectText(String(uniform.cdf(2.5, 0, 10)), '0.25'))

// Invalid inputs
suite.test('Invalid: probability of 1.5', 'p=1.5', 'A clear error', () => expectError(() => normal.inv(1.5), /between 0 and 1/i))
suite.test('Invalid: negative standard deviation', 'sd=-1', 'A clear error', () => expectError(() => normal.cdf(0, 0, -1), /greater than 0/i))
suite.test('Invalid: n = -3', 'n=-3', 'A clear error', () => expectError(() => binomial.cdf(1, -3, 0.5), /greater than 0/i))
suite.test('Invalid: p = 2', 'p=2', 'A clear error', () => expectError(() => binomial.cdf(1, 10, 2), /between 0 and 1/i))
suite.test('Invalid: k larger than n', 'k=12, n=10', 'A clear error', () => {
  // A probability of 0 is a defensible answer for "exactly 12 successes in 10 trials".
  const v = binomial.pdf(12, 10, 0.5)
  if (v !== 0) throw new GuideMismatch(String(v))
  return { actual: '0' }
})

// ---------- Confidence intervals ----------
suite.test('z interval: mean 50, SD 10, n = 25, 95%', 'mean 50, sd 10, n 25, 95%', '46.08 to 53.92', () => {
  const se = 10 / Math.sqrt(25)
  const margin = normal.inv(0.975) * se
  const lower = 50 - margin
  const upper = 50 + margin
  if (Math.abs(lower - 46.08) > 0.01 || Math.abs(upper - 53.92) > 0.01) throw new GuideMismatch(`${lower.toFixed(2)} to ${upper.toFixed(2)}`)
  return { actual: `${lower.toFixed(2)} to ${upper.toFixed(2)}` }
})
suite.test('99% confidence makes the interval wider', '95% vs 99%', 'Wider', () => {
  const se = 10 / Math.sqrt(25)
  const m95 = normal.inv(0.975) * se
  const m99 = normal.inv(0.995) * se
  if (!(m99 > m95)) throw new GuideMismatch(`95%: ${m95}, 99%: ${m99}`)
  return { actual: `95%: ${m95.toFixed(2)}, 99%: ${m99.toFixed(2)}` }
})
suite.test('Larger n makes the interval narrower', 'n = 25 vs n = 100', 'Narrower', () => {
  const z = normal.inv(0.975)
  const m25 = z * (10 / Math.sqrt(25))
  const m100 = z * (10 / Math.sqrt(100))
  if (!(m100 < m25)) throw new GuideMismatch(`n=25: ${m25}, n=100: ${m100}`)
  return { actual: `n=25: ${m25.toFixed(2)}, n=100: ${m100.toFixed(2)}` }
})

// ---------- Charts (the data behind them; the drawing itself is UI) ----------
suite.test('Histogram: the value 4 has the tallest bar (3 items)', '2, 4, 4, 4, 5, 5, 7, 9', 'Tallest bar = 3', () => {
  // The guide's claim only holds for one bin per value; the default Sturges rule
  // (4 bins over 2..9) groups 4, 4, 4, 5, 5 into one bar of 5.
  const h = histogram([2, 4, 4, 4, 5, 5, 7, 9], 8)
  const tallest = Math.max(...h.bins.map((b) => b.count))
  if (tallest !== 3) throw new GuideMismatch(`tallest bar = ${tallest}`)
  return { actual: `tallest bar = ${tallest} (${h.binCount} bins)` }
}, 'With the default Sturges bin count the tallest bar is 5, not 3: the guide assumes one bin per value')
suite.test('Scatter plot with regression line', '(1,2), (2,3), (3,5), (4,4), (5,6)', 'Line through the middle of the points', () => {
  const sc = scatterData([1, 2, 3, 4, 5], [2, 3, 5, 4, 6], { regression: true })
  if (!sc.regression) throw new GuideMismatch('no regression line')
  return expectClose(sc.regression.slope, 0.9, 1e-9)
})
suite.test('Box plot: median line matches the median', '2, 4, 4, 4, 5, 5, 7, 9', '4.5', () => expectText(String(boxPlot([2, 4, 4, 4, 5, 5, 7, 9]).median), '4.5'))
suite.test('Empty and single-value data do not crash the charts', '[] and [5]', 'No crash', () => {
  expectError(() => histogram([]), /empty/i)
  const one = histogram([5])
  if (one.total !== 1) throw new GuideMismatch(`total ${one.total}`)
  return { actual: 'empty rejected with a message; [5] gives one bin' }
})
suite.skip('Histogram / scatter / box plot drawing on screen', 'rendered charts', 'Bars, line and median look right', 'Needs the rendered SVG in the panel')

finish(suite)
