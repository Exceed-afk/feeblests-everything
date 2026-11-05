import assert from 'node:assert/strict'
import {
  convertUnit,
  UNIT_CATEGORIES,
  convertBase,
  formatBaseWithGrouping,
  convertCurrencyWithRate,
  calculateCrossRate
} from '../src/shared/calculator/modules/conversions'
import { Decimal } from '../src/shared/calculator/numeric'

const dec = (n: number | string): Decimal => new Decimal(n)
const close = (actual: Decimal | number, expected: number, tol = 1e-6, label?: string) => {
  const a = typeof actual === 'number' ? actual : actual.toNumber()
  assert.ok(
    Math.abs(a - expected) <= tol,
    `${label || ''} expected ${expected}, got ${a} (diff ${Math.abs(a - expected)})`
  )
}

let checks = 0
const ok = () => { checks++ }

// ---------- 1. Unit Conversions (Everyday Non-Engineering) ----------
// Length
// 1 km = 1000 m = 0.6213711922 mi
const mFromKm = convertUnit(dec(1), 'length', 'km', 'm')
close(mFromKm, 1000, 1e-9, '1 km to m'); ok()

const kmRoundTrip = convertUnit(mFromKm, 'length', 'm', 'km')
close(kmRoundTrip, 1, 1e-9, 'km -> m -> km roundtrip'); ok()

const miFromKm = convertUnit(dec(1), 'length', 'km', 'mi')
close(miFromKm, 0.621371192, 1e-6, '1 km to mi'); ok()

// Mass
// 1 kg = 1000 g = 2.20462262 lb
const lbFromKg = convertUnit(dec(1), 'mass', 'kg', 'lb')
close(lbFromKg, 2.20462262, 1e-6, '1 kg to lb'); ok()

const kgRoundTrip = convertUnit(lbFromKg, 'mass', 'lb', 'kg')
close(kgRoundTrip, 1, 1e-8, 'kg -> lb -> kg roundtrip'); ok()

// Volume
// 1 gal (US) = 3.785411784 L = 128 fl oz (US)
const lFromGal = convertUnit(dec(1), 'volume', 'gal', 'l')
close(lFromGal, 3.785411784, 1e-8, '1 gal to l'); ok()

// Temperature (Affine transformations: C, F, K)
// 0 C = 32 F = 273.15 K
close(convertUnit(dec(0), 'temperature', 'c', 'f'), 32, 1e-9, '0 C to F'); ok()
close(convertUnit(dec(100), 'temperature', 'c', 'f'), 212, 1e-9, '100 C to F'); ok()
close(convertUnit(dec(32), 'temperature', 'f', 'c'), 0, 1e-9, '32 F to C'); ok()
close(convertUnit(dec(-40), 'temperature', 'c', 'f'), -40, 1e-9, '-40 C = -40 F'); ok()
close(convertUnit(dec(0), 'temperature', 'c', 'k'), 273.15, 1e-9, '0 C to K'); ok()
close(convertUnit(dec(273.15), 'temperature', 'k', 'c'), 0, 1e-9, '273.15 K to C'); ok()

// Speed
// 100 km/h = 27.77777778 m/s = 62.13711922 mph
const mpsFromKph = convertUnit(dec(100), 'speed', 'km/h', 'm/s')
close(mpsFromKph, 27.77777778, 1e-6, '100 km/h to m/s'); ok()
const mphFromKph = convertUnit(dec(100), 'speed', 'km/h', 'mph')
close(mphFromKph, 62.13711922, 1e-6, '100 km/h to mph'); ok()

// Area
// 1 ha = 10,000 m2 = 2.4710538146717 acre
const m2FromHa = convertUnit(dec(1), 'area', 'ha', 'm2')
close(m2FromHa, 10000, 1e-9, '1 ha to m2'); ok()
const acreFromHa = convertUnit(dec(1), 'area', 'ha', 'acre')
close(acreFromHa, 2.471053814, 1e-6, '1 ha to acre'); ok()

// Data size
// 1 MB = 1024 KB = 1,048,576 Bytes (binary/standard) or 1000 KB (decimal)
const kbFromMb = convertUnit(dec(1), 'data', 'mb', 'kb')
close(kbFromMb, 1024, 1e-9, '1 mb to kb'); ok()
const bytesFromGb = convertUnit(dec(1), 'data', 'gb', 'b')
close(bytesFromGb, 1073741824, 1e-9, '1 gb to b'); ok()

// Time
// 1 day = 24 h = 1440 min = 86400 s
close(convertUnit(dec(1), 'time', 'd', 's'), 86400, 1e-9, '1 d to s'); ok()
close(convertUnit(dec(3600), 'time', 's', 'h'), 1, 1e-9, '3600 s to h'); ok()

// Pressure
// 1 atm = 101325 Pa = 1.01325 bar = 14.6959487755 psi
close(convertUnit(dec(1), 'pressure', 'atm', 'pa'), 101325, 1e-6, '1 atm to pa'); ok()
close(convertUnit(dec(1), 'pressure', 'bar', 'pa'), 100000, 1e-6, '1 bar to pa'); ok()

// Round trips on all categories
for (const cat of Object.keys(UNIT_CATEGORIES) as (keyof typeof UNIT_CATEGORIES)[]) {
  const units = UNIT_CATEGORIES[cat].units
  if (units.length >= 2) {
    const u1 = units[0].id
    const u2 = units[1].id
    const forward = convertUnit(dec(10), cat, u1, u2)
    const back = convertUnit(forward, cat, u2, u1)
    close(back, 10, 1e-5, `Roundtrip for category ${cat}`); ok()
  }
}

// ---------- 2. Number Base Conversions ----------
// Decimal 255 -> Hex FF, Octal 377, Bin 11111111
assert.equal(convertBase('255', 10, 16), 'FF'); ok()
assert.equal(convertBase('255', 10, 8), '377'); ok()
assert.equal(convertBase('255', 10, 2), '11111111'); ok()

// Binary 101010 -> Dec 42 -> Hex 2A
assert.equal(convertBase('101010', 2, 10), '42'); ok()
assert.equal(convertBase('101010', 2, 16), '2A'); ok()
assert.equal(convertBase('2A', 16, 10), '42'); ok()

// Case-insensitivity in input
assert.equal(convertBase('ff', 16, 10), '255'); ok()
assert.equal(convertBase('1a2b', 16, 2), '1101000101011'); ok()

// Grouping formatting
assert.equal(formatBaseWithGrouping('11111111', 2), '1111 1111'); ok()
assert.equal(formatBaseWithGrouping('1A2B3C', 16), '1A 2B 3C'); ok()
assert.equal(formatBaseWithGrouping('1234567', 10), '1,234,567'); ok()

// Error checking on invalid digits
assert.throws(() => convertBase('2', 2, 10), /Invalid digit/); ok()
assert.throws(() => convertBase('G', 16, 10), /Invalid digit/); ok()

// ---------- 3. Manual Currency Conversions ----------
// Base = USD
// EUR rateToBase = 0.92 (1 USD = 0.92 EUR)
// GBP rateToBase = 0.79 (1 USD = 0.79 GBP)
// JPY rateToBase = 150.0 (1 USD = 150 JPY)

// Direct conversion from base USD to EUR: 100 USD * 0.92 = 92 EUR
const eurFromUsd = convertCurrencyWithRate(dec(100), dec(0.92))
close(eurFromUsd, 92, 1e-9, '100 USD to EUR'); ok()

// Inverse: 92 EUR to USD (rate 0.92): 92 / 0.92 = 100 USD
const usdFromEur = convertCurrencyWithRate(dec(92), dec(1).dividedBy(dec(0.92)))
close(usdFromEur, 100, 1e-9, '92 EUR to USD'); ok()

// Cross rate: EUR (0.92) to GBP (0.79)
// 1 EUR in USD = 1 / 0.92
// in GBP = (1 / 0.92) * 0.79 = 0.79 / 0.92 ~ 0.85869565
const eurToGbpCross = calculateCrossRate(dec(0.92), dec(0.79))
close(eurToGbpCross, 0.79 / 0.92, 1e-9, 'EUR to GBP cross rate'); ok()

// 100 EUR to GBP at cross rate = 85.869565 GBP
const gbpFromEur = convertCurrencyWithRate(dec(100), eurToGbpCross)
close(gbpFromEur, (100 * 0.79) / 0.92, 1e-8, '100 EUR to GBP'); ok()

console.log(`ok   ${checks} conversion & currency tests passed`)
