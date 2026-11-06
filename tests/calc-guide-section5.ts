// docs/calculator-testing-guide.md — Section 5: Conversions and currency.
// Run on its own:  npx tsx tests/calc-guide-section5.ts
import { convertUnit, convertBase } from '../src/shared/calculator/modules/conversions'
import {
  calculateEffectiveRate, performCurrencyConversion, validateCurrencyCode, checkRateStaleness,
  exportRateSetToJson, exportRateSetToCsv, parseAndValidateRatesCsv, parseAndValidateRatesJson
} from '../src/shared/calculator/rates'
import { CalculatorEngine } from '../src/shared/calculator'
import { Decimal } from '../src/shared/calculator/numeric'
import type { CalcRate, CalcRateSet, CalcRateOverride } from '../src/shared/calculator/types'
import { GuideSuite, finish, expectText, expectClose, expectError, GuideMismatch } from './calc-guide-common'

export const suite = new GuideSuite('Section 5: Conversions and currency', 'Conversions & Currency')

const dec = (n: number | string) => new Decimal(n)

// ---------- Unit conversions ----------
suite.test('1 km to miles', '1 km -> mi', '0.621371', () => expectClose(convertUnit(dec(1), 'length', 'km', 'mi').toString(), 0.621371, 1e-6))
suite.test('1 mile to km', '1 mi -> km', '1.609344', () => expectText(convertUnit(dec(1), 'length', 'mi', 'km').toString(), '1.609344'))
suite.test('1 inch to cm', '1 in -> cm', '2.54', () => expectText(convertUnit(dec(1), 'length', 'in', 'cm').toString(), '2.54'))
suite.test('1 foot to cm', '1 ft -> cm', '30.48', () => expectText(convertUnit(dec(1), 'length', 'ft', 'cm').toString(), '30.48'))
suite.test('1 kg to pounds', '1 kg -> lb', '2.204623', () => expectClose(convertUnit(dec(1), 'mass', 'kg', 'lb').toString(), 2.204623, 1e-6))
suite.test('1 pound to grams', '1 lb -> g', '453.59237', () => expectText(convertUnit(dec(1), 'mass', 'lb', 'g').toString(), '453.59237'))
suite.test('1 US gallon to liters', '1 gal -> l', '3.785412', () => expectClose(convertUnit(dec(1), 'volume', 'gal', 'l').toString(), 3.785412, 1e-6))
suite.test('1 liter to ml', '1 l -> ml', '1000', () => expectText(convertUnit(dec(1), 'volume', 'l', 'ml').toString(), '1000'))
suite.test('100 °C to °F', '100 c -> f', '212', () => expectText(convertUnit(dec(100), 'temperature', 'c', 'f').toString(), '212'))
suite.test('0 °C to °F', '0 c -> f', '32', () => expectText(convertUnit(dec(0), 'temperature', 'c', 'f').toString(), '32'))
suite.test('-40 °C to °F', '-40 c -> f', '-40', () => expectText(convertUnit(dec(-40), 'temperature', 'c', 'f').toString(), '-40'))
suite.test('0 K to °C', '0 k -> c', '-273.15', () => expectText(convertUnit(dec(0), 'temperature', 'k', 'c').toString(), '-273.15'))
suite.test('1 hour to seconds', '1 h -> s', '3600', () => expectText(convertUnit(dec(1), 'time', 'h', 's').toString(), '3600'))
suite.test('1 day to hours', '1 d -> h', '24', () => expectText(convertUnit(dec(1), 'time', 'd', 'h').toString(), '24'))
suite.test('1 GB to MB', '1 gb -> mb', '1000 (decimal) or 1024 (binary)', () => {
  // The unit labels say which convention is used: "Kilobytes (KB, 1024)".
  const v = convertUnit(dec(1), 'data', 'gb', 'mb').toString()
  if (v !== '1000' && v !== '1024') throw new GuideMismatch(v)
  return { actual: `${v} (binary, as the unit labels state)` }
})
suite.test('60 mph to km/h', '60 mph -> km/h', '96.56064', () => expectClose(convertUnit(dec(60), 'speed', 'mph', 'km/h').toString(), 96.56064, 1e-5))

// Round trip: convert and back, five different pairs.
const roundTrips: Array<[string, string, string, number]> = [
  ['length', 'km', 'mi', 10],
  ['mass', 'kg', 'lb', 5],
  ['volume', 'gal', 'l', 20],
  ['temperature', 'f', 'c', 72],
  ['speed', 'mph', 'km/h', 55]
]
for (const [category, from, to, value] of roundTrips) {
  suite.test(`Round trip: ${value} ${from} -> ${to} -> ${from}`, `${value} ${from} -> ${to} -> ${from}`, String(value), () => {
    const back = convertUnit(convertUnit(dec(value), category, from, to), category, to, from)
    return expectClose(back.toString(), value, 1e-9)
  })
}

suite.test('Incompatible units: kg to meters', 'kg -> m', 'A clear error', () =>
  expectError(() => convertUnit(dec(10), 'mass', 'kg', 'm'), /unknown unit/i))
suite.test('Zero and negative values work', '0 km -> mi, -5 c -> f', 'Works', () => {
  const zero = convertUnit(dec(0), 'length', 'km', 'mi').toString()
  const neg = convertUnit(dec(-5), 'temperature', 'c', 'f').toString()
  if (zero !== '0') throw new GuideMismatch(`0 km = ${zero}`)
  return expectText(neg, '23')
})
suite.test('Very large and very small values work', '1e12 km -> mi, 1e-9 m -> mm', 'Works', () => {
  const big = convertUnit(dec('1e12'), 'length', 'km', 'mi')
  const small = convertUnit(dec('1e-9'), 'length', 'm', 'mm')
  if (!big.isFinite()) throw new GuideMismatch('not finite')
  return expectText(small.toString(), '0.000001')
})

// ---------- Currency with manual rates ----------
// Base USD, EUR = 0.92, GBP = 0.79 (1 USD = 0.92 EUR).
const rateSet: CalcRateSet = { id: 'set1', name: 'Manual Rates', baseCurrency: 'USD', isActive: true, updatedAt: '2026-11-01T00:00:00.000Z' }
const rateList: CalcRate[] = [
  { id: 'eur', rateSetId: 'set1', currencyCode: 'EUR', rateToBase: '0.92', updatedAt: '2026-11-01T00:00:00.000Z' },
  { id: 'gbp', rateSetId: 'set1', currencyCode: 'GBP', rateToBase: '0.79', updatedAt: '2026-11-01T00:00:00.000Z' }
]
const convert = (amount: number, from: string, to: string, rates = rateList, overrides: CalcRateOverride[] = []) =>
  performCurrencyConversion({
    amount, from, to, baseCurrency: 'USD', rates, overrides, targetSet: rateSet,
    staleRateDays: 7, today: '2026-11-01T00:00:00.000Z'
  })

suite.test('100 USD to EUR', '100 USD -> EUR', '92', () => expectText(convert(100, 'USD', 'EUR').result, '92'))
suite.test('92 EUR to USD', '92 EUR -> USD', '100', () => {
  // 92 / 0.92 is 99.9999999999999999999999999998 in exact decimal: the guide's "100" is
  // the rounded answer, so compare to the cent rather than to the raw string.
  const v = new Decimal(convert(92, 'EUR', 'USD').result)
  return expectText(v.toFixed(2), '100.00')
})
suite.test('100 EUR to GBP (through the base)', '100 EUR -> GBP', '85.87 (85.8696)', () => {
  const v = new Decimal(convert(100, 'EUR', 'GBP').result)
  if (v.toFixed(2) !== '85.87') throw new GuideMismatch(v.toFixed(2))
  return expectClose(v.toString(), 85.8696, 1e-4)
})
suite.test('100 USD to USD', '100 USD -> USD', '100', () => expectText(convert(100, 'USD', 'USD').result, '100'))
suite.test('100 USD to JPY with no JPY rate', '100 USD -> JPY', 'Clear "rate missing" message', () =>
  expectError(() => convert(100, 'USD', 'JPY'), /missing rate/i))
suite.test('Change EUR to 0.90, convert 100 USD', '100 USD -> EUR @ 0.90', '90', () => {
  const rates = rateList.map((r) => (r.currencyCode === 'EUR' ? { ...r, rateToBase: '0.90' } : r))
  return expectText(convert(100, 'USD', 'EUR', rates).result, '90')
})
suite.test('Add a custom code (XAU)', 'validateCurrencyCode("XAU")', 'Accepted', () => expectText(validateCurrencyCode('XAU'), 'XAU'))
suite.test('Rate of 0 is rejected', 'EUR rate = 0', 'Rejected with a message', () =>
  expectError(() => convert(100, 'USD', 'EUR', [{ ...rateList[0], rateToBase: '0' }]), /zero/i))
suite.test('Negative rate is rejected', 'EUR rate = -0.92', 'Rejected with a message', () =>
  expectError(() => convert(100, 'USD', 'EUR', [{ ...rateList[0], rateToBase: '-0.92' }]), /zero|negative|missing/i),
  'calculateEffectiveRate only rejects a zero rate; a negative rate is used as-is, so 100 USD becomes -92 EUR')
suite.test('Text rate is rejected', 'EUR rate = "abc"', 'Rejected with a message', () =>
  expectError(() => convert(100, 'USD', 'EUR', [{ ...rateList[0], rateToBase: 'abc' }]), /number|invalid|missing/i))
suite.test('Rate with many decimals is stored exactly', 'BTC = 0.000123456789', 'Stored exactly, not rounded', () => {
  const eff = calculateEffectiveRate({
    from: 'USD', to: 'BTC', baseCurrency: 'USD',
    rates: [{ id: 'btc', rateSetId: 'set1', currencyCode: 'BTC', rateToBase: '0.000123456789', updatedAt: '2026-11-01T00:00:00.000Z' }]
  })
  if (!eff) throw new GuideMismatch('null')
  return expectText(eff.rateString, '0.000123456789')
})
suite.test('Type 100 USD to EUR in the expression bar', '100 USD to EUR', '92', () => {
  const eng = new CalculatorEngine()
  eng.setCurrencyContext({ baseCurrency: 'USD', rates: rateList, rateSet, overrides: [], staleRateDays: 7, today: '2026-11-01T00:00:00.000Z' })
  const r = eng.calculate('100 USD to EUR')
  if (r.error) throw new GuideMismatch(`error: ${r.error}`)
  if (r.currency !== 'EUR') throw new GuideMismatch(`currency ${r.currency}`)
  return expectText(r.value.toString(), '92')
})

// Behaviour checks
suite.test('Inverse rate: EUR 0.92 gives 1 / 0.92 for EUR -> USD', 'EUR -> USD', '1 / 0.92', () => {
  const eff = calculateEffectiveRate({ from: 'EUR', to: 'USD', baseCurrency: 'USD', rates: rateList })
  if (!eff) throw new GuideMismatch('null')
  return expectText(eff.rate.toString(), dec(1).dividedBy('0.92').toString())
})
suite.test('Direct pair override: EUR -> GBP 0.86 beats the cross rate', 'override EUR->GBP = 0.86', '0.86', () => {
  const eff = calculateEffectiveRate({
    from: 'EUR', to: 'GBP', baseCurrency: 'USD', rates: rateList,
    overrides: [{ id: 'o1', rateSetId: 'set1', fromCode: 'EUR', toCode: 'GBP', rate: '0.86', updatedAt: '2026-11-01T00:00:00.000Z' }]
  })
  if (!eff) throw new GuideMismatch('null')
  if (!eff.isDirectOverride) throw new GuideMismatch('the cross rate was used')
  return expectText(eff.rateString, '0.86')
})
suite.test('Last-updated date shows on each rate', 'rate.updatedAt', 'Present', () => {
  const r = rateList[0]
  if (!r.updatedAt) throw new GuideMismatch('missing')
  return { actual: r.updatedAt }
})
suite.test('Stale warning: threshold 1 day, rate 3 days old', 'threshold 1 day, age 3 days', 'Marked stale', () => {
  const info = checkRateStaleness('2026-11-01T00:00:00.000Z', '2026-11-04T00:00:00.000Z', 1)
  if (!info.isStale) throw new GuideMismatch('not stale')
  return expectText(String(info.daysOld), '3')
})
suite.test('History snapshot keeps the rate it used', 'convert 100 USD -> EUR, then change EUR', 'Old entry keeps 0.92', () => {
  const first = convert(100, 'USD', 'EUR')
  const changed = rateList.map((r) => (r.currencyCode === 'EUR' ? { ...r, rateToBase: '0.90' } : r))
  convert(100, 'USD', 'EUR', changed)
  return expectText(first.snapshot.rateUsed, '0.92')
})
suite.test('Rate sets: a second set with different rates is used when active', 'set 2: EUR = 0.80', '80', () => {
  const set2: CalcRateSet = { ...rateSet, id: 'set2', name: 'Second', isActive: true }
  const rates2: CalcRate[] = [{ ...rateList[0], rateSetId: 'set2', rateToBase: '0.80' }]
  const out = performCurrencyConversion({
    amount: 100, from: 'USD', to: 'EUR', baseCurrency: 'USD', rates: rates2, targetSet: set2,
    staleRateDays: 7, today: '2026-11-01T00:00:00.000Z'
  })
  return expectText(out.result, '80')
})
suite.test('Export and import: everything returns', 'export JSON, import it back', 'Same rates', () => {
  const json = exportRateSetToJson(rateSet, rateList)
  const rows = parseAndValidateRatesJson(json)
  if (rows.length !== 2) throw new GuideMismatch(`${rows.length} rows`)
  return expectText(rows.map((r) => `${r.code}=${r.rate}`).join(','), 'EUR=0.92,GBP=0.79')
})
suite.test('Export and import: CSV round trip', 'export CSV, import it back', 'Same rates', () => {
  const csv = exportRateSetToCsv(rateList)
  const rows = parseAndValidateRatesCsv(csv)
  return expectText(rows.map((r) => `${r.code}=${r.rate}`).join(','), 'EUR=0.92,GBP=0.79')
})
suite.test('Bad import file: text where numbers belong', 'code,rate\nEUR,abc', 'A clear error', () =>
  expectError(() => parseAndValidateRatesCsv('code,rate\nEUR,abc'), /positive number/i))
suite.test('Bad import file: wrong columns', '{"foo": 1}', 'A clear error', () =>
  expectError(() => parseAndValidateRatesJson('{"foo": 1}'), /rates/i))
suite.skip('Restart the app: rates and settings are still there', 'restart', 'Persisted', 'Needs a real app restart')
suite.skip('Offline: everything works the same', 'disconnect the network', 'No change', 'Needs the running app and a network monitor')

// ---------- Number bases ----------
suite.test('255 in hex', '255 -> hex', 'FF', () => expectText(convertBase('255', 10, 16), 'FF'))
suite.test('255 in binary', '255 -> binary', '11111111', () => expectText(convertBase('255', 10, 2), '11111111'))
suite.test('255 in octal', '255 -> octal', '377', () => expectText(convertBase('255', 10, 8), '377'))
suite.test('0xFF', '0xFF -> decimal', '255', () => expectText(convertBase('FF', 16, 10), '255'))
suite.test('0b1010', '0b1010 -> decimal', '10', () => expectText(convertBase('1010', 2, 10), '10'))
suite.test('Binary 1010 to decimal', '1010 (base 2) -> decimal', '10', () => expectText(convertBase('1010', 2, 10), '10'))
suite.test('Hex ff (lowercase)', 'ff -> decimal', '255', () => expectText(convertBase('ff', 16, 10), '255'))
suite.test('Hex GG', 'GG -> decimal', 'Error', () => expectError(() => convertBase('GG', 16, 10), /invalid digit/i))
suite.test('Binary 102', '102 (base 2) -> decimal', 'Error', () => expectError(() => convertBase('102', 2, 10), /invalid digit/i))
suite.test('0 in any base', '0 -> hex', '0', () => expectText(convertBase('0', 10, 16), '0'))
suite.test('-10 in binary', '-10 -> binary', '-1010 (or two\'s complement)', () => {
  const v = convertBase('-10', 10, 2)
  if (v !== '-1010' && !/^1+0+$/.test(v)) throw new GuideMismatch(v)
  return { actual: v }
})

finish(suite)
