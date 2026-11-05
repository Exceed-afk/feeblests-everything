import assert from 'node:assert/strict'
import {
  addDateAmount, addMonthsClamped, amortize, calculateLoan, calculatePercent,
  daysBetween, monthlyPayment, monthsToTarget, splitBill, toCents
} from '../src/shared/tools-math'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

// ---------------------------------------------------------------------------
// Loan math
// ---------------------------------------------------------------------------

test('a 0% loan splits the principal with no interest', () => {
  assert.equal(monthlyPayment(120000, 0, 12), 10000)
  const loan = calculateLoan({ principalCents: 120000, annualRatePercent: 0, termMonths: 12 })
  assert.equal(loan.totalInterestCents, 0)
  assert.equal(loan.totalPaidCents, 120000)
  assert.equal(loan.payoffMonths, 12)
  assert.equal(loan.schedule.at(-1)!.balanceCents, 0)
})

test('the standard 200k loan at 6% over 30 years gives the known payment', () => {
  // $200,000 at 6% APR / 30 years = $1,199.10 per month (the textbook figure).
  assert.equal(monthlyPayment(20_000_000, 6, 360), 119910)
})

test('every period pays off exactly the remaining balance, totalling the principal', () => {
  const loan = calculateLoan({ principalCents: 20_000_000, annualRatePercent: 6, termMonths: 360 })
  const principalPaid = loan.schedule.reduce((sum, row) => sum + row.principalCents, 0)
  assert.equal(principalPaid, 20_000_000, 'principal parts add up to the loan exactly')
  assert.equal(loan.schedule.at(-1)!.balanceCents, 0)
  assert.equal(loan.totalPaidCents, loan.schedule.reduce((s, r) => s + r.paymentCents, 0))
  assert.equal(loan.totalPaidCents, 20_000_000 + loan.totalInterestCents)
})

test('interest is rounded to whole cents on every period, never fractional', () => {
  const loan = calculateLoan({ principalCents: 123457, annualRatePercent: 5.25, termMonths: 24 })
  for (const row of loan.schedule) {
    for (const key of ['paymentCents', 'interestCents', 'principalCents', 'balanceCents'] as const) {
      assert.ok(Number.isInteger(row[key]), `${key} must be an integer at period ${row.period}`)
    }
  }
})

test('extra monthly payments shorten the loan and save interest', () => {
  const base = calculateLoan({ principalCents: 20_000_000, annualRatePercent: 6, termMonths: 360 })
  const faster = calculateLoan({ principalCents: 20_000_000, annualRatePercent: 6, termMonths: 360, extraMonthlyCents: 20000 })
  assert.ok(faster.payoffMonths < base.payoffMonths)
  assert.ok(faster.totalInterestCents < base.totalInterestCents)
  assert.equal(faster.savedMonths, base.payoffMonths - faster.payoffMonths)
  assert.equal(faster.savedInterestCents, base.totalInterestCents - faster.totalInterestCents)
  assert.equal(base.savedInterestCents, 0, 'no extras means nothing saved')
})

test('a huge extra payment finishes in one period and pays no phantom interest', () => {
  const loan = calculateLoan({ principalCents: 100000, annualRatePercent: 12, termMonths: 24, extraOneTimeCents: 5_000_000 })
  assert.equal(loan.payoffMonths, 1)
  assert.equal(loan.schedule[0].balanceCents, 0)
  assert.equal(loan.schedule[0].principalCents, 100000, 'never pays more principal than owed')
})

test('the payoff date is the start date plus the months actually taken', () => {
  const loan = calculateLoan({ principalCents: 120000, annualRatePercent: 0, termMonths: 12 }, '2026-01-15')
  assert.equal(loan.payoffDate, '2027-01-15')
  assert.equal(calculateLoan({ principalCents: 120000, annualRatePercent: 0, termMonths: 12 }).payoffDate, null)
})

test('invalid loan inputs are refused', () => {
  assert.throws(() => monthlyPayment(0, 5, 12), /above 0/)
  assert.throws(() => monthlyPayment(1000, 5, 0), /at least 1 month/)
  assert.throws(() => monthlyPayment(1000, -1, 12), /negative/)
  assert.throws(() => calculateLoan({ principalCents: 10.5, annualRatePercent: 5, termMonths: 12 }), /whole number/)
  assert.throws(() => calculateLoan({ principalCents: 1000, annualRatePercent: 5, termMonths: 12, extraMonthlyCents: -1 }), /0 or more/)
})

test('a loan that cannot be paid inside the term stops at the term', () => {
  // 40% APR over 600 months: the constant payment equals the monthly interest
  // (principal part 0 every period), so the balance never falls. The loop must
  // stop at the term instead of running forever, and must NOT invent a final
  // payment that clears it.
  const { schedule } = amortize(100_000_000, 40, 600)
  assert.equal(schedule.length, 600)
  assert.ok(schedule.at(-1)!.balanceCents > 0, 'an unfinishable loan still owes money at the term')
})

// ---------------------------------------------------------------------------
// Percentages
// ---------------------------------------------------------------------------

test('percentage modes compute the expected values', () => {
  assert.equal(calculatePercent('of', 15, 200).value, 30)
  assert.equal(calculatePercent('is-what-percent', 30, 200).value, 15)
  assert.equal(calculatePercent('change', 200, 250).value, 25)
  assert.equal(calculatePercent('change', 200, 150).value, -25)
  assert.equal(calculatePercent('add', 100, 10).value, 110)
  assert.equal(calculatePercent('subtract', 100, 10).value, 90)
})

test('percentage operations that divide by zero are refused', () => {
  assert.throws(() => calculatePercent('is-what-percent', 5, 0), /cannot be 0/)
  assert.throws(() => calculatePercent('change', 0, 10), /cannot be 0/)
})

// ---------------------------------------------------------------------------
// Bill split
// ---------------------------------------------------------------------------

test('a bill split always adds back up to the total', () => {
  const r = splitBill(10000, 15, 3) // $100, 15% tip, 3 people
  assert.equal(r.tipCents, 1500)
  assert.equal(r.totalCents, 11500)
  assert.equal(r.perPersonCents, 3834)
  assert.equal(r.perPersonCents * 2 + r.lastPersonCents, r.totalCents, 'the parts must sum exactly')
})

test('a single person pays the whole bill', () => {
  const r = splitBill(999, 0, 1)
  assert.equal(r.perPersonCents, 999)
  assert.equal(r.lastPersonCents, 999)
  assert.throws(() => splitBill(100, 10, 0), /one person/)
})

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

test('days between dates ignores time of day', () => {
  assert.equal(daysBetween('2026-11-01', '2026-11-30'), 29)
  assert.equal(daysBetween('2026-11-30', '2026-11-01'), -29)
  assert.equal(daysBetween('2026-11-03', '2026-11-03'), 0)
})

test('adding days, weeks, months and years clamps to month ends', () => {
  assert.equal(addDateAmount('2026-11-03', 10, 'days'), '2026-11-13')
  assert.equal(addDateAmount('2026-11-03', 2, 'weeks'), '2026-11-17')
  assert.equal(addMonthsClamped('2026-01-31', 1), '2026-02-28', 'non-leap February')
  assert.equal(addMonthsClamped('2024-01-31', 1), '2024-02-29', 'leap February')
  assert.equal(addDateAmount('2026-11-03', 1, 'years'), '2027-11-03')
})

// ---------------------------------------------------------------------------
// Savings projection
// ---------------------------------------------------------------------------

test('months to a savings target rounds up, and never invents a number', () => {
  assert.equal(monthsToTarget(0, 100000, 10000), 10)
  assert.equal(monthsToTarget(0, 105000, 10000), 11)
  assert.equal(monthsToTarget(100000, 100000, 10000), 0)
  assert.equal(monthsToTarget(0, 100000, 0), null, 'no contribution never arrives')
})

test('toCents rounds half up', () => {
  assert.equal(toCents(0.5), 1)
  assert.equal(toCents(0.49), 0)
  assert.equal(toCents(1199.1), 1199)
})

console.log(`\n${n} tools math checks passed`)
