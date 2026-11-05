// Not exposed in the expression bar: the language has no string literals. Use the Convert panel. A natural 'to' syntax could replace this later.

import { Decimal } from '../../numeric'
import { CalcError } from '../../errors'
import { toDecimalInput, toIntegerInput, toStringInput } from '../../inputs'

// ---------- Everyday Non-Engineering Unit Definitions ----------

export interface UnitDef {
  id: string
  label: string
  factor?: Decimal // Factor to base unit (where base unit factor = 1)
  // For non-proportional affine transforms (e.g. Celsius, Fahrenheit)
  toBase?: (val: Decimal) => Decimal
  fromBase?: (baseVal: Decimal) => Decimal
}

export interface UnitCategoryDef {
  id: string
  label: string
  baseUnit: string
  units: UnitDef[]
}

const dec = (n: number | string): Decimal => new Decimal(n)

export const UNIT_CATEGORIES: Record<string, UnitCategoryDef> = {
  length: {
    id: 'length',
    label: 'Length',
    baseUnit: 'm',
    units: [
      { id: 'mm', label: 'Millimeters (mm)', factor: dec('0.001') },
      { id: 'cm', label: 'Centimeters (cm)', factor: dec('0.01') },
      { id: 'm', label: 'Meters (m)', factor: dec('1') },
      { id: 'km', label: 'Kilometers (km)', factor: dec('1000') },
      { id: 'in', label: 'Inches (in)', factor: dec('0.0254') },
      { id: 'ft', label: 'Feet (ft)', factor: dec('0.3048') },
      { id: 'yd', label: 'Yards (yd)', factor: dec('0.9144') },
      { id: 'mi', label: 'Miles (mi)', factor: dec('1609.344') }
    ]
  },
  mass: {
    id: 'mass',
    label: 'Mass / Weight',
    baseUnit: 'kg',
    units: [
      { id: 'mg', label: 'Milligrams (mg)', factor: dec('0.000001') },
      { id: 'g', label: 'Grams (g)', factor: dec('0.001') },
      { id: 'kg', label: 'Kilograms (kg)', factor: dec('1') },
      { id: 'oz', label: 'Ounces (oz)', factor: dec('0.028349523125') },
      { id: 'lb', label: 'Pounds (lb)', factor: dec('0.45359237') },
      { id: 't', label: 'Metric Tonnes (t)', factor: dec('1000') }
    ]
  },
  volume: {
    id: 'volume',
    label: 'Volume',
    baseUnit: 'l',
    units: [
      { id: 'ml', label: 'Milliliters (ml)', factor: dec('0.001') },
      { id: 'l', label: 'Liters (L)', factor: dec('1') },
      { id: 'm3', label: 'Cubic meters (m³)', factor: dec('1000') },
      { id: 'tsp', label: 'Teaspoons (tsp, US)', factor: dec('0.00492892159375') },
      { id: 'tbsp', label: 'Tablespoons (tbsp, US)', factor: dec('0.01478676478125') },
      { id: 'cup', label: 'Cups (cup, US)', factor: dec('0.2365882365') },
      { id: 'pt', label: 'Pints (pt, US)', factor: dec('0.473176473') },
      { id: 'qt', label: 'Quarts (qt, US)', factor: dec('0.946352946') },
      { id: 'gal', label: 'Gallons (gal, US)', factor: dec('3.785411784') }
    ]
  },
  temperature: {
    id: 'temperature',
    label: 'Temperature',
    baseUnit: 'c',
    units: [
      {
        id: 'c',
        label: 'Celsius (°C)',
        toBase: (v) => v,
        fromBase: (v) => v
      },
      {
        id: 'f',
        label: 'Fahrenheit (°F)',
        toBase: (v) => v.minus(32).times(5).dividedBy(9),
        fromBase: (v) => v.times(9).dividedBy(5).plus(32)
      },
      {
        id: 'k',
        label: 'Kelvin (K)',
        toBase: (v) => v.minus('273.15'),
        fromBase: (v) => v.plus('273.15')
      }
    ]
  },
  speed: {
    id: 'speed',
    label: 'Speed',
    baseUnit: 'm/s',
    units: [
      { id: 'm/s', label: 'Meters/second (m/s)', factor: dec('1') },
      { id: 'km/h', label: 'Kilometers/hour (km/h)', factor: dec('1').dividedBy(dec('3.6')) },
      { id: 'mph', label: 'Miles/hour (mph)', factor: dec('0.44704') },
      { id: 'knot', label: 'Knots (kn)', factor: dec('0.514444444444') }
    ]
  },
  area: {
    id: 'area',
    label: 'Area',
    baseUnit: 'm2',
    units: [
      { id: 'cm2', label: 'Square centimeters (cm²)', factor: dec('0.0001') },
      { id: 'm2', label: 'Square meters (m²)', factor: dec('1') },
      { id: 'ha', label: 'Hectares (ha)', factor: dec('10000') },
      { id: 'km2', label: 'Square kilometers (km²)', factor: dec('1000000') },
      { id: 'sqft', label: 'Square feet (ft²)', factor: dec('0.09290304') },
      { id: 'sqyd', label: 'Square yards (yd²)', factor: dec('0.83612736') },
      { id: 'acre', label: 'Acres (ac)', factor: dec('4046.8564224') }
    ]
  },
  data: {
    id: 'data',
    label: 'Digital Data',
    baseUnit: 'b',
    units: [
      { id: 'b', label: 'Bytes (B)', factor: dec('1') },
      { id: 'kb', label: 'Kilobytes (KB, 1024)', factor: dec('1024') },
      { id: 'mb', label: 'Megabytes (MB)', factor: dec('1048576') },
      { id: 'gb', label: 'Gigabytes (GB)', factor: dec('1073741824') },
      { id: 'tb', label: 'Terabytes (TB)', factor: dec('1099511627776') }
    ]
  },
  time: {
    id: 'time',
    label: 'Time',
    baseUnit: 's',
    units: [
      { id: 'ms', label: 'Milliseconds (ms)', factor: dec('0.001') },
      { id: 's', label: 'Seconds (s)', factor: dec('1') },
      { id: 'min', label: 'Minutes (min)', factor: dec('60') },
      { id: 'h', label: 'Hours (h)', factor: dec('3600') },
      { id: 'd', label: 'Days (d)', factor: dec('86400') },
      { id: 'wk', label: 'Weeks (wk)', factor: dec('604800') }
    ]
  },
  pressure: {
    id: 'pressure',
    label: 'Pressure (Everyday)',
    baseUnit: 'pa',
    units: [
      { id: 'pa', label: 'Pascals (Pa)', factor: dec('1') },
      { id: 'kpa', label: 'Kilopascals (kPa)', factor: dec('1000') },
      { id: 'bar', label: 'Bar (bar)', factor: dec('100000') },
      { id: 'atm', label: 'Standard Atmospheres (atm)', factor: dec('101325') },
      { id: 'psi', label: 'Pounds/sq inch (psi)', factor: dec('6894.757293168') }
    ]
  }
}

export function convertUnit(
  value: Decimal | string | number,
  categoryId: string,
  fromUnitId: string,
  toUnitId: string
): Decimal {
  const v = toDecimalInput(value, 'value')
  const category = toStringInput(categoryId, 'category')
  const fromId = toStringInput(fromUnitId, 'fromUnit')
  const toId = toStringInput(toUnitId, 'toUnit')
  const cat = UNIT_CATEGORIES[category.toLowerCase()]
  if (!cat) throw new CalcError(`Unknown unit category: "${category}"`)

  const from = cat.units.find((u) => u.id.toLowerCase() === fromId.toLowerCase())
  if (!from) throw new CalcError(`Unknown unit "${fromId}" in category "${category}"`)

  const to = cat.units.find((u) => u.id.toLowerCase() === toId.toLowerCase())
  if (!to) throw new CalcError(`Unknown unit "${toId}" in category "${category}"`)

  if (from.id === to.id) return v

  // Convert to base unit
  let baseVal: Decimal
  if (from.toBase) {
    baseVal = from.toBase(v)
  } else if (from.factor) {
    baseVal = v.times(from.factor)
  } else {
    throw new CalcError(`Incomplete unit definition for "${from.id}"`)
  }

  // Convert from base unit to target
  if (to.fromBase) {
    return to.fromBase(baseVal)
  } else if (to.factor) {
    return baseVal.dividedBy(to.factor)
  } else {
    throw new CalcError(`Incomplete unit definition for "${to.id}"`)
  }
}

// ---------- Number Base Conversions ----------

export const BASE_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Longest number handed to the BigInt base converter: 10,000 digits of any base. */
const MAX_BASE_DIGITS = 10_000

function baseNumber(value: unknown, what: string): number {
  const n = toIntegerInput(value, what, { min: 2, max: 36 })
  return n
}

export function convertBase(input: string, fromBase: number, toBase: number): string {
  const text = toStringInput(input, 'value')
  const from = baseNumber(fromBase, 'fromBase')
  const to = baseNumber(toBase, 'toBase')

  const clean = text.trim().toUpperCase().replace(/[\s,_]/g, '')
  if (!clean) return '0'
  if (clean.length > MAX_BASE_DIGITS) {
    throw new CalcError(`Number is limited to ${MAX_BASE_DIGITS.toLocaleString('en-US')} digits (this one has ${clean.length.toLocaleString('en-US')})`)
  }

  const sign = clean.startsWith('-') ? '-' : ''
  const digits = clean.replace(/^[+-]/, '')

  // Convert to BigInt in base 10
  let decVal = 0n
  const fromBig = BigInt(from)
  for (let i = 0; i < digits.length; i++) {
    const ch = digits[i]
    const idx = BASE_CHARS.indexOf(ch)
    if (idx === -1 || idx >= from) {
      throw new CalcError(`Invalid digit "${ch}" for base ${from}`)
    }
    decVal = decVal * fromBig + BigInt(idx)
  }

  if (decVal === 0n) return '0'

  // Convert BigInt to target base
  let res = ''
  let cur = decVal
  const toBig = BigInt(to)
  while (cur > 0n) {
    const rem = Number(cur % toBig)
    res = BASE_CHARS[rem] + res
    cur = cur / toBig
  }

  return sign + res
}

export function formatBaseWithGrouping(val: unknown, base: number): string {
  const text = toStringInput(val, 'value')
  baseNumber(base, 'base')
  const clean = text.trim().toUpperCase()
  if (!clean) return text

  if (base === 2) {
    // 4-bit nibbles: 1111 1111
    return clean.replace(/\B(?=(\w{4})+(?!\w))/g, ' ')
  }
  if (base === 16) {
    // 2-char bytes: 1A 2B
    return clean.replace(/\B(?=(\w{2})+(?!\w))/g, ' ')
  }
  if (base === 10) {
    // Standard thousands separator
    return clean.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  }
  return clean
}

// ---------- Manual Currency Helpers ----------
// Re-exported from rates.ts to keep single source of truth for currency math

export {
  calculateEffectiveRate,
  performCurrencyConversion,
  validateCurrencyCode,
  checkRateStaleness,
  exportRateSetToCsv,
  exportRateSetToJson,
  parseAndValidateRatesCsv,
  parseAndValidateRatesJson
} from '../../rates'

export function convertCurrencyWithRate(amount: Decimal | string | number, rate: Decimal | string | number): Decimal {
  return toDecimalInput(amount, 'amount').times(toDecimalInput(rate, 'rate'))
}

export function calculateCrossRate(rateToBaseA: Decimal | string | number, rateToBaseB: Decimal | string | number): Decimal {
  const a = toDecimalInput(rateToBaseA, 'rateToBaseA')
  const b = toDecimalInput(rateToBaseB, 'rateToBaseB')
  if (a.isZero()) throw new CalcError('Source currency rate to base cannot be zero')
  // 1 Base = A units of currencyA => 1 currencyA = (1 / A) Base = (B / A) currencyB
  return b.dividedBy(a)
}
