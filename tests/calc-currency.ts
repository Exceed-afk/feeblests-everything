import assert from 'node:assert/strict'
import {
  calculateEffectiveRate,
  performCurrencyConversion,
  validateCurrencyCode,
  checkRateStaleness,
  exportRateSetToCsv,
  exportRateSetToJson,
  parseAndValidateRatesCsv,
  parseAndValidateRatesJson
} from '../src/shared/calculator/rates'
import { Decimal } from '../src/shared/calculator/numeric'
import type { CalcRate, CalcRateOverride, CalcRateSet } from '../src/shared/calculator/types'
import { MockStorageAdapter } from './calc-adapters'

let checks = 0
const ok = () => {
  checks++
}

// -----------------------------------------------------------------------------
// 1. Currency Code Validation (3 to 5 letters or digits, uppercase)
// -----------------------------------------------------------------------------

// Valid codes
assert.equal(validateCurrencyCode('usd'), 'USD'); ok()
assert.equal(validateCurrencyCode('EUR'), 'EUR'); ok()
assert.equal(validateCurrencyCode('  btc  '), 'BTC'); ok()
assert.equal(validateCurrencyCode('USDT'), 'USDT'); ok()
assert.equal(validateCurrencyCode('xau'), 'XAU'); ok()
assert.equal(validateCurrencyCode('100K'), '100K'); ok()
assert.equal(validateCurrencyCode('SHIB5'), 'SHIB5'); ok()

// Invalid codes: length < 3
assert.throws(() => validateCurrencyCode('US'), /3 to 5 characters/); ok()
assert.throws(() => validateCurrencyCode(''), /cannot be empty/); ok()
// Invalid codes: length > 5
assert.throws(() => validateCurrencyCode('DOLLARS'), /3 to 5 characters/); ok()
// Invalid characters
assert.throws(() => validateCurrencyCode('US$'), /letters and digits/); ok()
assert.throws(() => validateCurrencyCode('EU-R'), /letters and digits/); ok()
assert.throws(() => validateCurrencyCode(null as any), /non-empty string/); ok()

// -----------------------------------------------------------------------------
// 2. Stale Rate Detection Pure Function
// -----------------------------------------------------------------------------

// updatedAt today -> fresh (0 days old)
const freshCheck = checkRateStaleness('2026-11-04T12:00:00.000Z', '2026-11-04T18:00:00.000Z', 7)
assert.equal(freshCheck.isStale, false)
assert.equal(freshCheck.daysOld, 0); ok()

// 6 days old with threshold 7 -> fresh
const sixDaysCheck = checkRateStaleness('2026-10-29T12:00:00.000Z', '2026-11-04T12:00:00.000Z', 7)
assert.equal(sixDaysCheck.isStale, false)
assert.equal(sixDaysCheck.daysOld, 6); ok()

// Exactly 7 days old with threshold 7 -> stale
const sevenDaysCheck = checkRateStaleness('2026-10-28T12:00:00.000Z', '2026-11-04T12:00:00.000Z', 7)
assert.equal(sevenDaysCheck.isStale, true)
assert.equal(sevenDaysCheck.daysOld, 7); ok()

// 10 days old with threshold 7 -> stale
const tenDaysCheck = checkRateStaleness('2026-10-25T12:00:00.000Z', '2026-11-04T12:00:00.000Z', 7)
assert.equal(tenDaysCheck.isStale, true)
assert.equal(tenDaysCheck.daysOld, 10); ok()

// -----------------------------------------------------------------------------
// 3. Effective rates: base-relative, inverse, cross-rates, and overrides
// -----------------------------------------------------------------------------

async function runAsyncCurrencyTests() {
  const mockStorage = new MockStorageAdapter()

  // Base = USD
  const testSet: CalcRateSet = {
    id: 'set-test',
    name: 'Test Set',
    baseCurrency: 'USD',
    isActive: true,
    updatedAt: '2026-11-04T00:00:00.000Z'
  }
  await mockStorage.saveRateSet(testSet)

  // Add rates:
  // 1 USD = 0.92 EUR (updated 2 days ago)
  // 1 USD = 0.79 GBP (updated 8 days ago - stale)
  // 1 USD = 150.0 JPY (updated 1 day ago)
  await mockStorage.saveRate({
    rateSetId: testSet.id,
    currencyCode: 'EUR',
    rateToBase: '0.92',
    updatedAt: '2026-11-02T00:00:00.000Z'
  })
  await mockStorage.saveRate({
    rateSetId: testSet.id,
    currencyCode: 'GBP',
    rateToBase: '0.79',
    updatedAt: '2026-10-27T00:00:00.000Z' // 8 days before Nov 4
  })
  await mockStorage.saveRate({
    rateSetId: testSet.id,
    currencyCode: 'JPY',
    rateToBase: '150.0',
    updatedAt: '2026-11-03T00:00:00.000Z'
  })

  // Effective rates through calculateEffectiveRate (the pure helper the conversion runs on).
  const eff = async (from: string, to: string) =>
    calculateEffectiveRate({
      from,
      to,
      baseCurrency: 'USD',
      rates: await mockStorage.loadRates(testSet.id),
      overrides: await mockStorage.listRateOverrides(testSet.id)
    })?.rateString ?? null

  // Same currency -> 1
  assert.equal(await eff('USD', 'USD'), '1'); ok()

  // Base to currency: USD to EUR -> 0.92
  assert.equal(await eff('USD', 'EUR'), '0.92'); ok()

  // Inverse: EUR to USD -> 1 / 0.92
  const eurToUsd = await eff('EUR', 'USD')
  const expectedEurToUsd = new Decimal(1).dividedBy(new Decimal('0.92')).toString()
  assert.equal(eurToUsd, expectedEurToUsd); ok()

  // Cross-rate: EUR to GBP -> rateToBase(GBP) / rateToBase(EUR) = 0.79 / 0.92
  const eurToGbp = await eff('EUR', 'GBP')
  const expectedEurToGbp = new Decimal('0.79').dividedBy(new Decimal('0.92')).toString()
  assert.equal(eurToGbp, expectedEurToGbp); ok()

  // Cross-rate: GBP to JPY -> 150 / 0.79
  const gbpToJpy = await eff('GBP', 'JPY')
  const expectedGbpToJpy = new Decimal('150.0').dividedBy(new Decimal('0.79')).toString()
  assert.equal(gbpToJpy, expectedGbpToJpy); ok()

  // Missing rate -> null
  assert.equal(await eff('USD', 'CAD'), null); ok()

  // Override precedence:
  // Add direct pair override for EUR -> GBP = 0.88 (instead of computed 0.79/0.92 ~ 0.8587)
  await mockStorage.saveRateOverride({
    rateSetId: testSet.id,
    fromCode: 'EUR',
    toCode: 'GBP',
    rate: '0.88',
    updatedAt: '2026-11-04T00:00:00.000Z'
  })

  assert.equal(await eff('EUR', 'GBP'), '0.88', 'Direct override takes precedence over computed cross rate'); ok()

  // Inverse of override: GBP -> EUR should use inverse 1 / 0.88
  const gbpToEurInvOverride = await eff('GBP', 'EUR')
  const expectedInvOverride = new Decimal(1).dividedBy(new Decimal('0.88')).toString()
  assert.equal(gbpToEurInvOverride, expectedInvOverride, 'Inverse of pair override automatically used'); ok()

  // -----------------------------------------------------------------------------
  // 4. Conversion Execution & Snapshot Details (performCurrencyConversion)
  // -----------------------------------------------------------------------------
  const convert = async (amount: string, from: string, to: string, opts: { staleRateDays?: number } = {}) =>
    performCurrencyConversion({
      amount: new Decimal(amount),
      from,
      to,
      targetSet: testSet,
      rates: await mockStorage.loadRates(testSet.id),
      overrides: await mockStorage.listRateOverrides(testSet.id),
      baseCurrency: 'USD',
      staleRateDays: opts.staleRateDays ?? 7,
      today: '2026-11-04T12:00:00.000Z'
    })

  // Base currency entries in the conversion are implicit 1 to base
  // USD -> EUR (ratesUsed has EUR)
  const convResultFresh = await convert('100', 'USD', 'EUR')
  assert.equal(convResultFresh.result, '92')
  assert.equal(convResultFresh.isStale, false)
  assert.equal(convResultFresh.isDirectOverride, false)
  assert.equal(convResultFresh.snapshot.rateSetName, 'Test Set')
  assert.equal(convResultFresh.snapshot.baseCurrency, 'USD')
  assert.equal(convResultFresh.snapshot.fromCurrency, 'USD')
  assert.equal(convResultFresh.snapshot.toCurrency, 'EUR')
  assert.equal(convResultFresh.snapshot.rateUsed, '0.92')
  assert.equal(convResultFresh.snapshot.ratesUsed.length, 1)
  assert.equal(convResultFresh.snapshot.ratesUsed[0].currencyCode, 'EUR'); ok()

  // Stale conversion (GBP is 8 days old: Oct 27 to Nov 4; threshold 7)
  const convResultStale = await convert('100', 'USD', 'GBP')
  assert.equal(convResultStale.isStale, true)
  assert.equal(convResultStale.snapshot.oldestDaysOld, 8)
  assert.equal(convResultStale.snapshot.isStale, true); ok()

  // Cross conversion between EUR (2d old) and GBP (8d old) reports oldest rate (8d old)
  const crossStale = await convert('100', 'EUR', 'GBP')
  // Note: an override for EUR->GBP was registered above with today's date, so override timestamp applies!
  assert.equal(crossStale.isDirectOverride, true)
  assert.equal(crossStale.isStale, false); ok()

  // Cross conversion EUR to JPY (without override): oldest rate is EUR (2d old) vs JPY (1d old) -> 2d old
  const crossEurJpy = await convert('10', 'EUR', 'JPY')
  assert.equal(crossEurJpy.snapshot.oldestDaysOld, 2)
  assert.equal(crossEurJpy.snapshot.ratesUsed.length, 2); ok()

  // Cross-rate conversion with override snapshot: EUR to GBP
  const convOverride = await convert('50', 'EUR', 'GBP')
  assert.equal(convOverride.result, '44') // 50 * 0.88 = 44
  assert.equal(convOverride.isDirectOverride, true)
  assert.equal(convOverride.snapshot.isDirectOverride, true)
  assert.equal(convOverride.snapshot.rateUsed, '0.88'); ok()

  // Missing rate throws informative error
  await assert.rejects(
    async () => {
      await convert('100', 'EUR', 'XYZ')
    },
    /Missing rate/
  ); ok()

  // -----------------------------------------------------------------------------
  // 5. Rate Set CSV and JSON Export / Import Round-trip & Validation
  // -----------------------------------------------------------------------------

  const ratesForExport: CalcRate[] = [
    { id: '1', rateSetId: testSet.id, currencyCode: 'EUR', name: 'Euro', rateToBase: '0.92', note: 'Spot ECB', updatedAt: '2026-11-02T00:00:00Z' },
    { id: '2', rateSetId: testSet.id, currencyCode: 'GBP', name: 'British Pound', rateToBase: '0.79', note: 'Bank', updatedAt: '2026-10-27T00:00:00Z' },
    { id: '3', rateSetId: testSet.id, currencyCode: 'JPY', name: 'Japanese Yen', rateToBase: '150.005', note: '', updatedAt: '2026-11-03T00:00:00Z' }
  ]

  // CSV Export and Import
  const csvOutput = exportRateSetToCsv(ratesForExport)
  assert.ok(csvOutput.includes('EUR,0.92,Euro,Spot ECB'))
  const importedFromCsv = parseAndValidateRatesCsv(csvOutput)
  assert.equal(importedFromCsv.length, 3)
  assert.equal(importedFromCsv[0].code, 'EUR')
  assert.equal(importedFromCsv[0].rate, '0.92')
  assert.equal(importedFromCsv[0].name, 'Euro')
  assert.equal(importedFromCsv[0].note, 'Spot ECB')
  assert.equal(importedFromCsv[2].code, 'JPY')
  assert.equal(importedFromCsv[2].rate, '150.005'); ok()

  // JSON Export and Import
  const jsonOutput = exportRateSetToJson(testSet, ratesForExport)
  const importedFromJson = parseAndValidateRatesJson(jsonOutput)
  assert.equal(importedFromJson.length, 3)
  assert.equal(importedFromJson[1].code, 'GBP')
  assert.equal(importedFromJson[1].rate, '0.79')
  assert.equal(importedFromJson[1].name, 'British Pound'); ok()

  // Import rejection tests:
  // Bad currency code rejects with row number
  const badCodeCsv = `code,rate\nEUR,0.92\nTOOLONGCODE,1.2`
  assert.throws(() => parseAndValidateRatesCsv(badCodeCsv), /Row 3.*invalid currency code/); ok()

  // Non-positive or invalid numeric rate rejects with row number and code
  const badRateCsv = `code,rate\nEUR,0.92\nGBP,-0.5`
  assert.throws(() => parseAndValidateRatesCsv(badRateCsv), /Row 3 \(GBP\).*positive number/); ok()

  const zeroRateCsv = `code,rate\nEUR,0.92\nJPY,0`
  assert.throws(() => parseAndValidateRatesCsv(zeroRateCsv), /Row 3 \(JPY\).*positive number/); ok()

  const nonNumericCsv = `code,rate\nEUR,not_a_number`
  assert.throws(() => parseAndValidateRatesCsv(nonNumericCsv), /Row 2 \(EUR\).*valid positive number/); ok()

  // Duplicate code in import rejects with duplicate message
  const duplicateCodeCsv = `code,rate\nEUR,0.92\nGBP,0.79\nEUR,0.95`
  assert.throws(() => parseAndValidateRatesCsv(duplicateCodeCsv), /Row 4: duplicate currency code "EUR"/); ok()

  // Rejected import leaving data untouched
  const initialRatesBeforeRejection = await mockStorage.loadRates(testSet.id)
  assert.throws(() => {
    const badImport = parseAndValidateRatesCsv(`code,rate\nCHF,0.89\nINVALID_LONG,1.0`)
    // Not called because parse throws beforehand
    void badImport
  })
  const ratesAfterRejection = await mockStorage.loadRates(testSet.id)
  assert.equal(ratesAfterRejection.length, initialRatesBeforeRejection.length, 'Data untouched after failed validation'); ok()

  // Transactional import merge vs replace
  const newRows = [
    { code: 'CHF', rate: '0.89', name: 'Swiss Franc', note: 'Zurich' },
    { code: 'EUR', rate: '0.94', name: 'Euro updated', note: 'New' }
  ]

  // Merge
  await mockStorage.importRates(testSet.id, newRows, 'merge')
  const mergedRates = await mockStorage.loadRates(testSet.id)
  assert.equal(mergedRates.find((r) => r.currencyCode === 'CHF')?.rateToBase, '0.89')
  assert.equal(mergedRates.find((r) => r.currencyCode === 'EUR')?.rateToBase, '0.94')
  assert.ok(mergedRates.some((r) => r.currencyCode === 'JPY'), 'Merge kept JPY'); ok()

  // Replace
  await mockStorage.importRates(testSet.id, newRows, 'replace')
  const replacedRates = await mockStorage.loadRates(testSet.id)
  assert.equal(replacedRates.length, 2)
  assert.equal(replacedRates.find((r) => r.currencyCode === 'CHF')?.rateToBase, '0.89')
  assert.equal(replacedRates.find((r) => r.currencyCode === 'JPY'), undefined, 'Replace wiped previous rates'); ok()

  console.log(`ok   ${checks} currency logic, conversion, validation & import/export tests passed`)
}

void runAsyncCurrencyTests()
