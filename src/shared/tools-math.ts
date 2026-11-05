// Pure loan & amortization math for the Tools hub (Phase 5).
//
// Money is integer minor units (cents) everywhere it is stored or returned;
// rates are percentages per YEAR held as a number with up to 6 decimals.
// No floats for MONEY, but the interest computation itself needs multiplication
// — so the rule is: compute in exact floating point, ROUND ONCE to cents at the
// boundary, and never compare two floats for equality.
//
// Rounding policy (stated explicitly, as the plan requires):
// - monthlyRate = annualRate / 100 / 12 (not rounded)
// - payment = round-half-up(principal * r / (1 - (1+r)^-n)) to the nearest cent
// - every period's interest = round-half-up(balance * r) to the nearest cent
// - principal part = payment - interest (so a period never splits a cent)
// - the final period pays off the remaining balance exactly, absorbing any
//   accumulated rounding difference; total paid = sum of actual payments.
import { round8 } from './math'

export interface LoanInput {
  principalCents: number // > 0
  annualRatePercent: number // >= 0, e.g. 5.25
  termMonths: number // >= 1
  extraMonthlyCents?: number // >= 0, added to every payment
  extraOneTimeCents?: number // >= 0, applied to the first payment
}

export interface AmortizationRow {
  period: number // 1-based month
  paymentCents: number
  interestCents: number
  principalCents: number
  balanceCents: number // remaining AFTER this payment
}

export interface LoanResult {
  monthlyPaymentCents: number // the scheduled payment (no extra)
  totalInterestCents: number
  totalPaidCents: number
  payoffMonths: number // periods actually needed (<= termMonths, or the term if never paid off)
  payoffDate: string | null // YYYY-MM-DD, from startDate + payoffMonths (null when startDate was not given)
  schedule: AmortizationRow[]
  // What the extra payments saved, vs the same loan with no extra payments.
  savedInterestCents: number
  savedMonths: number
}

const HALF_UP = (value: number): number => Math.floor(value + 0.5)
export const toCents = (amount: number): number => HALF_UP(round8(amount))

// The constant monthly payment for a fully amortising loan.
// A 0% loan simply splits the principal across the term.
export function monthlyPayment(principalCents: number, annualRatePercent: number, termMonths: number): number {
  if (!Number.isFinite(principalCents) || principalCents <= 0) throw new Error('Principal must be above 0')
  if (!Number.isFinite(termMonths) || termMonths < 1) throw new Error('Term must be at least 1 month')
  if (!Number.isFinite(annualRatePercent) || annualRatePercent < 0) throw new Error('Interest rate cannot be negative')
  if (annualRatePercent === 0) return Math.ceil(principalCents / termMonths)
  const r = annualRatePercent / 100 / 12
  const factor = Math.pow(1 + r, -termMonths)
  return toCents(principalCents * r / (1 - factor))
}

// The whole schedule. `extraMonthlyCents`/`extraOneTimeCents` shorten the loan;
// the final payment is the remainder and is usually smaller than the rest.
export function amortize(
  principalCents: number,
  annualRatePercent: number,
  termMonths: number,
  extraMonthlyCents = 0,
  extraOneTimeCents = 0
): { schedule: AmortizationRow[]; monthlyPaymentCents: number } {
  const scheduled = monthlyPayment(principalCents, annualRatePercent, termMonths)
  const r = annualRatePercent / 100 / 12
  const schedule: AmortizationRow[] = []
  let balance = principalCents
  // The term bounds the loop; a normal loan ends in termMonths or sooner.
  for (let period = 1; period <= termMonths && balance > 0; period++) {
    const interest = r === 0 ? 0 : toCents(balance * r)
    let principal = scheduled - interest + extraMonthlyCents
    if (period === 1) principal += extraOneTimeCents
    // Clear the loan on the FINAL period of the term when only ROUNDING is left.
    // Rounding each period's interest to whole cents leaves a few cents owing
    // after the last scheduled payment ($1.04 on a 30-year loan). "Rounding
    // left" means the shortfall is smaller than one period's payment — a loan
    // whose payment is below its interest still owes far more, and is left as
    // is (the UI warns instead of inventing a phantom final payment).
    const roundingShortfall = period === termMonths && principal < balance && balance - principal < scheduled
    if (principal >= balance || roundingShortfall) principal = balance
    const payment = principal + interest
    balance -= principal
    schedule.push({ period, paymentCents: payment, interestCents: interest, principalCents: principal, balanceCents: balance })
  }
  return { schedule, monthlyPaymentCents: scheduled }
}

// Adds whole months to a local date ("YYYY-MM-DD"), clamping to month end
// (31 Jan + 1 month = 28/29 Feb), the same rule the rest of the app uses.
export function addMonthsClamped(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d, last))
  return first.toISOString().slice(0, 10)
}

export function calculateLoan(input: LoanInput, startDate?: string | null): LoanResult {
  if (!Number.isInteger(input.principalCents) || input.principalCents <= 0) {
    throw new Error('Principal must be a positive whole number of cents')
  }
  if (input.extraMonthlyCents !== undefined && (!Number.isInteger(input.extraMonthlyCents) || input.extraMonthlyCents < 0)) {
    throw new Error('The extra monthly payment must be 0 or more whole cents')
  }
  if (input.extraOneTimeCents !== undefined && (!Number.isInteger(input.extraOneTimeCents) || input.extraOneTimeCents < 0)) {
    throw new Error('The one-time extra payment must be 0 or more whole cents')
  }

  const extraMonthly = input.extraMonthlyCents ?? 0
  const extraOnce = input.extraOneTimeCents ?? 0

  const withExtras = amortize(input.principalCents, input.annualRatePercent, input.termMonths, extraMonthly, extraOnce)
  const baseline = amortize(input.principalCents, input.annualRatePercent, input.termMonths, 0, 0)

  const sum = (rows: AmortizationRow[], pick: (row: AmortizationRow) => number): number =>
    rows.reduce((total, row) => total + pick(row), 0)

  const totalInterestCents = sum(withExtras.schedule, (row) => row.interestCents)
  const totalPaidCents = sum(withExtras.schedule, (row) => row.paymentCents)
  const baselineInterest = sum(baseline.schedule, (row) => row.interestCents)
  const payoffMonths = withExtras.schedule.length

  return {
    monthlyPaymentCents: withExtras.monthlyPaymentCents,
    totalInterestCents,
    totalPaidCents,
    payoffMonths,
    payoffDate: startDate ? addMonthsClamped(startDate, payoffMonths) : null,
    schedule: withExtras.schedule,
    savedInterestCents: Math.max(0, baselineInterest - totalInterestCents),
    savedMonths: Math.max(0, baseline.schedule.length - payoffMonths)
  }
}

// ---------- percentage helpers ----------

export type PercentMode = 'of' | 'is-what-percent' | 'change' | 'add' | 'subtract'

export interface PercentResult { value: number; label: string }

// Results are rounded to 6 decimals so binary floating point artefacts
// (100 * 1.1 = 110.00000000000001) never reach the screen.
const clean = (value: number): number => Math.round(value * 1e6) / 1e6

export function calculatePercent(mode: PercentMode, a: number, b: number): PercentResult {
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('Enter two numbers')
  switch (mode) {
    case 'of':
      return { value: clean((a / 100) * b), label: `${a}% of ${b}` }
    case 'is-what-percent':
      if (b === 0) throw new Error('The second number cannot be 0')
      return { value: clean((a / b) * 100), label: `${a} as a percentage of ${b}` }
    case 'change':
      if (a === 0) throw new Error('The starting value cannot be 0')
      return { value: clean(((b - a) / a) * 100), label: `Change from ${a} to ${b}` }
    case 'add':
      return { value: clean(a * (1 + b / 100)), label: `${a} plus ${b}%` }
    case 'subtract':
      return { value: clean(a * (1 - b / 100)), label: `${a} minus ${b}%` }
    default:
      throw new Error('Unknown percentage mode')
  }
}

// ---------- tip & bill split ----------

export interface BillSplitResult {
  tipCents: number
  totalCents: number
  perPersonCents: number // rounded up, so the bill is always covered
  lastPersonCents: number // the remainder, so the parts add up exactly
}

export function splitBill(subtotalCents: number, tipPercent: number, people: number): BillSplitResult {
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) throw new Error('Subtotal must be 0 or more cents')
  if (!Number.isFinite(tipPercent) || tipPercent < 0) throw new Error('Tip cannot be negative')
  if (!Number.isInteger(people) || people < 1) throw new Error('At least one person is needed')
  const tipCents = toCents(subtotalCents * (tipPercent / 100))
  const totalCents = subtotalCents + tipCents
  const perPersonCents = Math.ceil(totalCents / people)
  const lastPersonCents = totalCents - perPersonCents * (people - 1)
  return { tipCents, totalCents, perPersonCents, lastPersonCents }
}

// ---------- dates ----------

// Whole days from `from` to `to` (calendar days, so DST cannot shift it).
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

// `date` plus N days / weeks / months / years. Months and years clamp.
export type DateUnit = 'days' | 'weeks' | 'months' | 'years'

export function addDateAmount(date: string, amount: number, unit: DateUnit): string {
  if (!Number.isFinite(amount)) throw new Error('Enter a number')
  if (unit === 'days' || unit === 'weeks') {
    const days = unit === 'weeks' ? amount * 7 : amount
    const [y, m, d] = date.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
  }
  return addMonthsClamped(date, unit === 'years' ? amount * 12 : amount)
}

// ---------- savings projection ----------

// How long to reach a target at a steady monthly contribution.
// Simple, honest arithmetic: current balance grows by `monthly`, no interest
// (the plan's v2 idea, kept simple until rates are shared with Expenses).
export function monthsToTarget(currentCents: number, targetCents: number, monthlyCents: number, maxMonths = 1200): number | null {
  if (monthlyCents <= 0) return null
  if (currentCents >= targetCents) return 0
  const months = Math.ceil((targetCents - currentCents) / monthlyCents)
  return months > maxMonths ? null : months
}
