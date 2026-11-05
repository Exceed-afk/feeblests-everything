// Shared input coercion for the calculator's public module APIs.
//
// Every exported function in finance / statistics / linear-algebra / complex /
// conversions / datetime goes through these helpers first, so callers can pass
// decimal strings, plain numbers, Decimals or arrays of them. Anything else
// (null, undefined, NaN, Infinity, "", "abc", booleans, objects) throws a
// CalcError with a message that names the argument, never a raw TypeError.
//
// One helper implementation instead of the same checks pasted into 60 functions.

import { Decimal } from './numeric'
import { CalcError } from './errors'

const NUMBER_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

/** True when the value is something we accept as a number (not an array / object / boolean). */
export function isNumericInput(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'bigint') return true
  if (typeof value === 'string') return NUMBER_PATTERN.test(value.trim())
  return value instanceof Decimal && value.isFinite()
}

/**
 * Coerce one value to a finite Decimal, or throw a CalcError.
 * `what` names the argument in the message: "amount", "rate", "n", ...
 */
export function toDecimalInput(value: unknown, what = 'value'): Decimal {
  if (value instanceof Decimal) {
    if (!value.isFinite()) throw new CalcError(`${what} must be a finite number`)
    return value
  }
  if (typeof value === 'bigint') {
    return new Decimal(value.toString())
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CalcError(`${what} must be a finite number`)
    return new Decimal(value)
  }
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) throw new CalcError(`${what} cannot be empty`)
    if (!NUMBER_PATTERN.test(text)) {
      throw new CalcError(`${what} must be a number (got "${value.length > 24 ? `${value.slice(0, 24)}…` : value}")`)
    }
    return new Decimal(text)
  }
  throw new CalcError(`${what} must be a number (got ${describe(value)})`)
}

/** Coerce an array of values. Rejects non-arrays, empty arrays when `allowEmpty` is false. */
export function toDecimalArray(value: unknown, what = 'values', opts: { allowEmpty?: boolean } = {}): Decimal[] {
  if (!Array.isArray(value)) throw new CalcError(`${what} must be a list of numbers (got ${describe(value)})`)
  if (!opts.allowEmpty && value.length === 0) throw new CalcError(`${what} cannot be empty`)
  return value.map((v, i) => toDecimalInput(v, `${what}[${i}]`))
}

/** Two arrays that must be the same length (paired data: x/y, cash flows/dates). */
export function toPairedArrays(x: unknown, y: unknown, xName = 'x', yName = 'y'): [Decimal[], Decimal[]] {
  const xs = toDecimalArray(x, xName)
  const ys = toDecimalArray(y, yName)
  if (xs.length !== ys.length) {
    throw new CalcError(`${xName} and ${yName} must have the same length (got ${xs.length} and ${ys.length})`)
  }
  return [xs, ys]
}

/** A value that must be a whole number (counts, degrees of freedom, periods). */
export function toIntegerInput(value: unknown, what: string, opts: { min?: number; max?: number } = {}): number {
  const d = toDecimalInput(value, what)
  if (!d.isInteger()) throw new CalcError(`${what} must be a whole number`)
  const n = d.toNumber()
  if (!Number.isSafeInteger(n)) throw new CalcError(`${what} is too large`)
  if (opts.min !== undefined && n < opts.min) throw new CalcError(`${what} must be at least ${opts.min}`)
  if (opts.max !== undefined && n > opts.max) throw new CalcError(`${what} must be at most ${opts.max}`)
  return n
}

/** A value that must be greater than zero (prices, quantities, exponential bases as rates). */
export function toPositiveInput(value: unknown, what: string, opts: { allowZero?: boolean } = {}): Decimal {
  const d = toDecimalInput(value, what)
  if (d.isNegative() || (!opts.allowZero && d.isZero())) {
    throw new CalcError(`${what} must be a positive number`)
  }
  return d
}

/** A value that must be zero or greater (standard deviations, variances, probabilities). */
export function toNonNegativeInput(value: unknown, what: string): Decimal {
  const d = toDecimalInput(value, what)
  if (d.isNegative()) throw new CalcError(`${what} cannot be negative`)
  return d
}

/** A probability, 0 <= p <= 1. */
export function toProbabilityInput(value: unknown, what = 'probability'): Decimal {
  const d = toDecimalInput(value, what)
  if (d.isNegative() || d.gt(1)) throw new CalcError(`${what} must be between 0 and 1`)
  return d
}

/** A non-empty string argument (names, units, date strings before they are parsed). */
export function toStringInput(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new CalcError(`${what} must be text (got ${describe(value)})`)
  if (!value.trim()) throw new CalcError(`${what} cannot be empty`)
  return value
}

/** Any value that is not null or undefined (dates, matrices). */
export function requireDefined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new CalcError(`${what} is required`)
  return value
}

/** A short, safe description of a bad argument for error messages. */
export function describe(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'number') return Number.isNaN(value) ? 'NaN' : String(value)
  if (typeof value === 'bigint') return `${value.toString()}n`
  if (typeof value === 'string') return `"${value.length > 24 ? `${value.slice(0, 24)}…` : value}"`
  if (Array.isArray(value)) return 'a list'
  if (value instanceof Decimal) return 'a Decimal'
  return typeof value
}
