// docs/calculator-testing-guide.md — "Ambiguous cases to decide on once".
//
// These rows have more than one valid answer, so there is nothing to pass or fail:
// this file only reports what the calculator does today, so the convention can be
// chosen deliberately (and then written into the help text).
//
// Run on its own:  npx tsx tests/calc-guide-ambiguous.ts
import { CalculatorEngine } from '../src/shared/calculator'
import { computeStats } from '../src/shared/calculator/modules/statistics'
import { Decimal } from '../src/shared/calculator/numeric'

const eng = new CalculatorEngine()
const show = (expr: string) => {
  const r = eng.calculate(expr)
  return r.error ? `error: ${r.error}` : r.formatted
}

const rows: Array<{ case: string; input: string; conventions: string; actual: string }> = [
  { case: '2^3^2', input: '2^3^2', conventions: '512 (right to left, standard) or 64 (left to right, Excel)', actual: show('2^3^2') },
  { case: '-2^2', input: '-2^2', conventions: '-4 (standard math) or 4', actual: show('-2^2') },
  { case: 'mod(-7, 3)', input: 'mod(-7, 3)', conventions: '2 (always positive) or -1 (sign follows the first number)', actual: show('mod(-7, 3)') },
  { case: 'round(2.5)', input: 'round(2.5)', conventions: '3 (half up) or 2 (banker\'s rounding)', actual: show('round(2.5)') },
  { case: 'round(3.5)', input: 'round(3.5)', conventions: '4 (half up) or 4 (banker\'s: even)', actual: show('round(3.5)') },
  { case: 'round(-2.5)', input: 'round(-2.5)', conventions: '-2 (half up, away from zero) or -2 (banker\'s)', actual: show('round(-2.5)') },
  {
    case: 'Quartiles (Q1 / Q3 of 2, 4, 4, 4, 5, 5, 7, 9)',
    input: '2, 4, 4, 4, 5, 5, 7, 9',
    conventions: '4 / 6 (Tukey hinges) or 4 / 5.5 (type 7, Excel/NumPy default)',
    actual: (() => {
      const s = computeStats([2, 4, 4, 4, 5, 5, 7, 9].map((n) => new Decimal(n)))
      return `${s.q1} / ${s.q3}`
    })()
  },
  { case: 'Percent: 200 * 50%', input: '200 * 50%', conventions: '100 (percent is a fraction)', actual: show('200 * 50%') },
  { case: 'Percent: 200 + 10%', input: '200 + 10%', conventions: '220 (percent of 200) or 200.1 (percent is 0.1)', actual: show('200 + 10%') },
  { case: '5P2 and 5C2 infix', input: '5P2, 5C2', conventions: 'decided: not supported (use nPr(5,2), nCr(5,2), P(5,2), C(5,2))', actual: `${show('5P2')} / ${show('5C2')}` }
]

console.log('\n=== Ambiguous cases: what the calculator does today ===')
for (const r of rows) {
  console.log(`  ${r.case}`)
  console.log(`    input:       ${r.input}`)
  console.log(`    conventions: ${r.conventions}`)
  console.log(`    current:     ${r.actual}`)
}
console.log('\nNo pass/fail: these need a decision, then the help text should state it.')
