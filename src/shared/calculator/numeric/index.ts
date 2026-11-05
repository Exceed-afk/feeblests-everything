import Decimal from 'decimal.js'

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP })

export { Decimal }

export type OutputFormat = 'decimal' | 'fraction' | 'scientific' | 'engineering'

export interface NumericFormatOptions {
  precision?: number
  format?: OutputFormat
  maxFractionDenominator?: number
}

export function parseNumber(input: string | number | Decimal): Decimal {
  if (input instanceof Decimal) return input
  try {
    return new Decimal(input)
  } catch (err) {
    throw new Error(`Invalid numeric input: "${input}"`)
  }
}

export function toDecimalString(d: Decimal, precision = 12): string {
  if (!d.isFinite()) return d.toString()
  // Trim trailing zeroes for cleaner display while respecting max precision
  const rounded = d.toDecimalPlaces(precision)
  return rounded.toString()
}

export function toScientificString(d: Decimal, precision = 6): string {
  const raw = d.toExponential(precision)
  // Strip trailing zeros from mantissa e.g. 1.000000e+6 -> 1e+6
  return raw.replace(/\.?0+e/, 'e')
}

export function toEngineeringString(d: Decimal, precision = 6): string {
  if (d.isZero()) return '0'
  const exp = d.e
  const rem = ((exp % 3) + 3) % 3
  const engExp = exp - rem
  const mantissa = d.dividedBy(new Decimal(10).pow(engExp))
  const mantissaStr = mantissa.toDecimalPlaces(precision).toString()
  return `${mantissaStr}e${engExp >= 0 ? '+' : ''}${engExp}`
}

export function toFractionString(d: Decimal, maxDenominator = 10000): string {
  if (!d.isFinite()) return d.toString()
  if (d.isInteger()) return d.toString()

  const sign = d.isNegative() ? '-' : ''
  const abs = d.abs()
  const whole = abs.floor()
  const fraction = abs.minus(whole)

  if (fraction.isZero()) return d.toString()

  // Continued fraction expansion
  let h1 = 1, h2 = 0
  let k1 = 0, k2 = 1
  let b = fraction.toNumber()

  do {
    const a = Math.floor(b)
    let aux = h1
    h1 = a * h1 + h2
    h2 = aux
    aux = k1
    k1 = a * k1 + k2
    k2 = aux
    b = 1 / (b - a)
  } while (Math.abs(fraction.toNumber() - h1 / k1) > 1e-9 && k1 <= maxDenominator && Number.isFinite(b))

  if (k1 > maxDenominator || k1 === 0) return toDecimalString(d)

  const num = whole.isZero() ? h1 : whole.times(k1).plus(h1).toNumber()
  return `${sign}${num}/${k1}`
}

export function formatResult(d: Decimal, options: NumericFormatOptions = {}): string {
  const fmt = options.format || 'decimal'
  const prec = options.precision ?? 12

  switch (fmt) {
    case 'scientific':
      return toScientificString(d, Math.min(prec, 12))
    case 'engineering':
      return toEngineeringString(d, Math.min(prec, 12))
    case 'fraction':
      return toFractionString(d, options.maxFractionDenominator ?? 10000)
    case 'decimal':
    default:
      return toDecimalString(d, prec)
  }
}

export function toLatexResult(resultStr: string): string {
  const trimmed = resultStr.trim()
  // Check if fraction e.g. -3/4 or 5/2
  const fracMatch = trimmed.match(/^(-?\d+)\/(\d+)$/)
  if (fracMatch) {
    const sign = fracMatch[1].startsWith('-') ? '-' : ''
    const num = fracMatch[1].replace('-', '')
    const den = fracMatch[2]
    return `${sign}\\frac{${num}}{${den}}`
  }

  // Check if scientific e.g. 1.234e+6 or 1e-5
  const expMatch = trimmed.match(/^([+-]?\d+(?:\.\d+)?)e([+-]?\d+)$/i)
  if (expMatch) {
    const mantissa = expMatch[1]
    const exponent = parseInt(expMatch[2], 10)
    return `${mantissa} \\times 10^{${exponent}}`
  }

  return trimmed
}
