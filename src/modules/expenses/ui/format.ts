// Money and month helpers for the Expenses pages (Phase 1 UI).
//
// The service stores every amount as integer minor units (cents). The UI never
// does money maths in floats: amounts are parsed from text straight into integer
// cents, and rendered cents are divided only for display.
import { fmtAmount } from '../../../renderer/src/lib/format'

// Renders integer cents as a plain amount with two decimals ("1,234.50").
export const fmtCents = (cents: number): string => fmtAmount(Math.abs(cents) / 100)

// Renders integer cents with an explicit sign ("+1,234.50" / "-80.00").
export const fmtCentsSigned = (cents: number): string =>
  `${cents > 0 ? '+' : cents < 0 ? '-' : ''}${fmtAmount(Math.abs(cents) / 100)}`

export const centsToInput = (cents: number): string => (Math.abs(cents) / 100).toFixed(2)

// Parses typed money into integer cents. Accepts "1,234.50", "12.5", "12", with
// an optional leading sign. Returns null when the text is not a finite amount
// with at most two decimals, so callers can show a clear message instead of
// silently rounding a typo.
export function parseCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/,/g, '')
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  const cents = Math.round(value * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

// --------------------------- dates and months ---------------------------

export const monthOf = (date: string): string => date.slice(0, 7)
export const todayMonth = (today: string): string => today.slice(0, 7)

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function previousMonth(month: string): string {
  return addMonths(month, -1)
}

// "November 2026" for a "2026-11" month key.
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

// "Mon 2 Nov" for a "YYYY-MM-DD" day.
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

// "2 Nov 2026" for a "YYYY-MM-DD" day.
export function fullDayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// Whole days from `from` to `to` (both "YYYY-MM-DD"), counted on the calendar
// so a daylight-saving change cannot shift the answer.
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

// --------------------------- display helpers ---------------------------

export const CADENCE_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
  custom: 'Custom'
}

export const TX_TYPE_LABEL: Record<string, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer'
}

// A month's budget usage in percent, for the progress bars. 0 budget with no
// spending reads as 0%; a budget of 0 with spending reads as 100% (over).
export function usagePercent(spent: number, budget: number): number {
  if (budget <= 0) return spent > 0 ? 100 : 0
  return Math.round((spent / budget) * 100)
}
