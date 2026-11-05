// Currency conversion math, rate provider, validation, stale detection, and import/export.
// Section 7 of docs/calculator-build-plan.md:
// - All maths in arbitrary-precision Decimal, rates stored and returned as exact strings.
// - Direct pair overrides take precedence over cross rates computed through the base.
//   DESIGN DECISION: An override for pair (A -> B) is directed: it defines 1 A = R B.
//   If an inverse override (B -> A) is not explicitly defined in calc_rate_overrides,
//   the inverse direct rate 1 / R is used automatically for (B -> A) rather than falling
//   back to base cross rates, because a user setting an explicit direct market rate between
//   two currencies expects the reverse conversion to reflect that direct relationship.
//   If both direct and reverse overrides are explicitly provided, each explicit override takes precedence.
// - Missing rates reject conversion with a descriptive error.
// - Stale rate warnings track the oldest rate timestamp used during a conversion.

import { Decimal } from './numeric'
import { CalcError } from './errors'
import { toDecimalInput, describe } from './inputs'
import type {
  CalcRate,
  CalcRateOverride,
  CalcRateSet,
  CalcRateSnapshot,
  RateProvider,
  RateSetImportRow,
  StaleRateInfo,
  StorageAdapter
} from './types'

// ---------- 1. Currency Code Validation ----------

const CURRENCY_CODE_REGEX = /^[A-Z0-9]{3,5}$/

/**
 * Validates and normalises a currency code.
 * Rules (Section 7): 3 to 5 letters or digits, normalised to uppercase.
 * Allows fiat (USD, EUR), precious metals (XAU, XAG), and cryptocurrencies (BTC, ETH, SOL).
 */
export function validateCurrencyCode(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new CalcError('Currency code must be a non-empty string')
  }
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new CalcError('Currency code cannot be empty')
  }
  const upper = trimmed.toUpperCase()
  if (upper.length < 3 || upper.length > 5) {
    throw new CalcError(`Currency code "${upper}" must be 3 to 5 characters long (got ${upper.length})`)
  }
  if (!CURRENCY_CODE_REGEX.test(upper)) {
    throw new CalcError(`Currency code "${upper}" contains invalid characters: must contain only letters and digits (A-Z, 0-9)`)
  }
  return upper
}

// ---------- 2. Stale Rate Detection ----------

/**
 * Pure function to check if a rate's updatedAt timestamp is considered stale.
 * Given updatedAt (ISO string or ms timestamp), today's date (ISO, YYYY-MM-DD, or Date),
 * and staleRateDays threshold.
 * Returns { isStale: boolean, daysOld: number }.
 */
function parseTimestamp(value: unknown, what: string): number {
  if (value === null || value === undefined) {
    throw new CalcError(`${what} must be a valid date`)
  }
  if (typeof value === 'bigint') {
    const num = Number(value)
    if (!Number.isFinite(num)) throw new CalcError(`${what} must be a finite timestamp`)
    return num
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CalcError(`${what} must be a finite timestamp`)
    return value
  }
  if (value instanceof Date) {
    const ms = value.getTime()
    if (!Number.isFinite(ms)) throw new CalcError(`${what} is not a valid date`)
    return ms
  }
  if (typeof value === 'string') {
    const ms = new Date(value).getTime()
    if (!Number.isFinite(ms)) throw new CalcError(`${what} is not a valid date`)
    return ms
  }
  throw new CalcError(`${what} must be a date, string or timestamp (got ${describe(value)})`)
}

export function checkRateStaleness(
  updatedAt: string | Date | number,
  today: string | Date | number,
  staleRateDays: number
): StaleRateInfo {
  const updatedMs = parseTimestamp(updatedAt, 'updatedAt')
  const todayMs = parseTimestamp(today, 'today')

  const daysThresh = toDecimalInput(staleRateDays, 'staleRateDays').toNumber()
  if (!Number.isFinite(daysThresh) || daysThresh < 0) {
    throw new CalcError('staleRateDays must be a non-negative number')
  }

  const diffMs = Math.max(0, todayMs - updatedMs)
  const daysOld = Math.floor(diffMs / 86400000)
  const threshold = Math.max(0, daysThresh)

  return {
    isStale: daysOld >= threshold,
    daysOld
  }
}

// ---------- 3. ManualRateProvider & Core Conversion Logic ----------

export interface CurrencyConversionQuery {
  amount: string | Decimal
  from: string
  to: string
  rateSetId?: string
  today?: string | Date
  staleRateDays?: number
}

export interface CurrencyConversionOutput {
  amount: string
  from: string
  to: string
  result: string
  rate: string
  isDirectOverride: boolean
  isStale: boolean
  oldestRateAgeDays: number | null
  snapshot: CalcRateSnapshot
}

export class ManualRateProvider implements RateProvider {
  constructor(private storage: StorageAdapter) { }

  /**
   * Resolves the effective rate from `from` to `to` as an exact decimal string.
   * Priority:
   * 1. If from === to, rate is '1'.
   * 2. Direct override (from -> to).
   * 3. Inverse of direct override (to -> from) if present.
   * 4. Cross rate via base currency: (rateToBase(to) / rateToBase(from)).
   * Returns null if any required rate is missing.
   */
  async getRate(from: string, to: string, rateSetId?: string): Promise<string | null> {
    try {
      const normFrom = validateCurrencyCode(from)
      const normTo = validateCurrencyCode(to)
      if (normFrom === normTo) return '1'

      const { targetSet, rates, overrides } = await this.resolveRateSetData(rateSetId)
      const baseCode = validateCurrencyCode(targetSet.baseCurrency)

      return calculateEffectiveRate({
        from: normFrom,
        to: normTo,
        baseCurrency: baseCode,
        rates,
        overrides
      })?.rateString ?? null
    } catch {
      return null
    }
  }

  /**
   * Perform a full conversion with complete metadata snapshot suitable for calc_history.rateSnapshot.
   */
  async convert(query: CurrencyConversionQuery): Promise<CurrencyConversionOutput> {
    const normFrom = validateCurrencyCode(query.from)
    const normTo = validateCurrencyCode(query.to)

    const amountDec = query.amount instanceof Decimal ? query.amount : new Decimal(String(query.amount).trim())
    if (!amountDec.isFinite()) {
      throw new CalcError(`Invalid conversion amount "${String(query.amount)}"`)
    }

    const { targetSet, rates, overrides } = await this.resolveRateSetData(query.rateSetId)
    const baseCode = validateCurrencyCode(targetSet.baseCurrency)

    const staleDays = query.staleRateDays ?? 7
    const today = query.today ?? new Date()

    return performCurrencyConversion({
      amount: amountDec,
      from: normFrom,
      to: normTo,
      targetSet,
      rates,
      overrides,
      baseCurrency: baseCode,
      staleRateDays: staleDays,
      today
    })
  }

  private async resolveRateSetData(rateSetId?: string): Promise<{
    targetSet: CalcRateSet
    rates: CalcRate[]
    overrides: CalcRateOverride[]
  }> {
    let targetSet: CalcRateSet | undefined
    if (rateSetId) {
      const sets = await this.storage.loadRateSets()
      targetSet = sets.find((s) => s.id === rateSetId)
      if (!targetSet) {
        throw new CalcError(`Rate set "${rateSetId}" not found`)
      }
    } else {
      const sets = await this.storage.loadRateSets()
      targetSet = sets.find((s) => s.isActive) || sets[0]
      if (!targetSet) {
        throw new CalcError('No rate set available')
      }
    }

    const [rates, overrides] = await Promise.all([
      this.storage.loadRates(targetSet.id),
      this.storage.listRateOverrides ? this.storage.listRateOverrides(targetSet.id) : Promise.resolve([])
    ])

    return { targetSet, rates, overrides }
  }
}

export interface EffectiveRateResolution {
  rate: Decimal
  rateString: string
  isDirectOverride: boolean
  ratesUsed: Array<{
    currencyCode: string
    rateToBase: string
    updatedAt: string
  }>
  oldestRateTimestamp: string | null
}

/**
 * Pure calculation helper: resolves effective exchange rate between two currencies.
 * 1 A = rate B.
 */
export function calculateEffectiveRate(params: {
  from: string
  to: string
  baseCurrency: string
  rates: CalcRate[]
  overrides?: CalcRateOverride[]
}): EffectiveRateResolution | null {
  if (!params || typeof params !== 'object') {
    throw new CalcError(`params must be an object (got ${describe(params)})`)
  }
  const from = validateCurrencyCode(params.from)
  const to = validateCurrencyCode(params.to)
  const baseCurrency = validateCurrencyCode(params.baseCurrency)
  if (!Array.isArray(params.rates)) {
    throw new CalcError(`rates must be an array (got ${describe(params.rates)})`)
  }
  if (params.rates.some((r) => !r || typeof r !== 'object')) {
    throw new CalcError('Every rate in rates must be an object')
  }
  const rates = params.rates
  if (params.overrides !== undefined && !Array.isArray(params.overrides)) {
    throw new CalcError(`overrides must be an array (got ${describe(params.overrides)})`)
  }
  if (params.overrides && params.overrides.some((o) => !o || typeof o !== 'object')) {
    throw new CalcError('Every override in overrides must be an object')
  }
  const overrides = params.overrides || []

  if (from === to) {
    return {
      rate: new Decimal(1),
      rateString: '1',
      isDirectOverride: false,
      ratesUsed: [],
      oldestRateTimestamp: null
    }
  }

  // 1. Direct pair override: from -> to
  const directOverride = overrides.find((o) => o.fromCode === from && o.toCode === to)
  if (directOverride) {
    const rateDec = new Decimal(directOverride.rate)
    return {
      rate: rateDec,
      rateString: directOverride.rate,
      isDirectOverride: true,
      ratesUsed: [
        {
          currencyCode: `${from}/${to}`,
          rateToBase: directOverride.rate,
          updatedAt: directOverride.updatedAt
        }
      ],
      oldestRateTimestamp: directOverride.updatedAt
    }
  }

  // 2. Inverse of pair override: to -> from
  const inverseOverride = overrides.find((o) => o.fromCode === to && o.toCode === from)
  if (inverseOverride) {
    const directDec = new Decimal(inverseOverride.rate)
    if (directDec.isZero()) throw new CalcError(`Override rate for ${to}->${from} cannot be zero`)
    const invRate = new Decimal(1).dividedBy(directDec)
    return {
      rate: invRate,
      rateString: invRate.toString(),
      isDirectOverride: true,
      ratesUsed: [
        {
          currencyCode: `${to}/${from}`,
          rateToBase: inverseOverride.rate,
          updatedAt: inverseOverride.updatedAt
        }
      ],
      oldestRateTimestamp: inverseOverride.updatedAt
    }
  }

  // 3. Base-relative rates
  // A currency's rateToBase R means 1 Base = R Currency.
  // Therefore 1 Currency = (1 / R) Base.
  // 1 From in Base = 1 / rateToBase(From)
  // 1 From in To = (1 / rateToBase(From)) * rateToBase(To) = rateToBase(To) / rateToBase(From).
  const rateMap = new Map<string, CalcRate>()
  for (const r of rates) {
    rateMap.set(r.currencyCode, r)
  }

  const ratesUsed: Array<{ currencyCode: string; rateToBase: string; updatedAt: string }> = []
  let rateFromBase: Decimal
  let fromTimestamp: string | null = null

  if (from === baseCurrency) {
    rateFromBase = new Decimal(1)
  } else {
    const fromEntry = rateMap.get(from)
    if (!fromEntry) return null
    rateFromBase = new Decimal(fromEntry.rateToBase)
    if (rateFromBase.isZero()) throw new CalcError(`Rate for ${from} cannot be zero`)
    ratesUsed.push({
      currencyCode: fromEntry.currencyCode,
      rateToBase: fromEntry.rateToBase,
      updatedAt: fromEntry.updatedAt
    })
    fromTimestamp = fromEntry.updatedAt
  }

  let rateToBase: Decimal
  let toTimestamp: string | null = null

  if (to === baseCurrency) {
    rateToBase = new Decimal(1)
  } else {
    const toEntry = rateMap.get(to)
    if (!toEntry) return null
    rateToBase = new Decimal(toEntry.rateToBase)
    if (rateToBase.isZero()) throw new CalcError(`Rate for ${to} cannot be zero`)
    ratesUsed.push({
      currencyCode: toEntry.currencyCode,
      rateToBase: toEntry.rateToBase,
      updatedAt: toEntry.updatedAt
    })
    toTimestamp = toEntry.updatedAt
  }

  // Cross rate = rateToBase / rateFromBase
  const effectiveRate = rateToBase.dividedBy(rateFromBase)

  // Determine oldest timestamp
  let oldest: string | null = null
  if (fromTimestamp && toTimestamp) {
    oldest = new Date(fromTimestamp).getTime() <= new Date(toTimestamp).getTime() ? fromTimestamp : toTimestamp
  } else {
    oldest = fromTimestamp || toTimestamp
  }

  return {
    rate: effectiveRate,
    rateString: effectiveRate.toString(),
    isDirectOverride: false,
    ratesUsed,
    oldestRateTimestamp: oldest
  }
}

/**
 * Performs complete conversion and constructs the rate snapshot.
 */
export function performCurrencyConversion(params: {
  amount: Decimal | string | number
  from: string
  to: string
  targetSet: CalcRateSet
  rates: CalcRate[]
  overrides?: CalcRateOverride[]
  baseCurrency: string
  staleRateDays: number
  today: string | Date
}): CurrencyConversionOutput {
  if (!params || typeof params !== 'object') {
    throw new CalcError(`params must be an object (got ${describe(params)})`)
  }
  const amount = toDecimalInput(params.amount, 'amount')
  const from = validateCurrencyCode(params.from)
  const to = validateCurrencyCode(params.to)
  const baseCurrency = validateCurrencyCode(params.baseCurrency)
  if (!params.targetSet || typeof params.targetSet !== 'object') {
    throw new CalcError(`targetSet must be an object (got ${describe(params.targetSet)})`)
  }
  if (!Array.isArray(params.rates)) {
    throw new CalcError(`rates must be an array (got ${describe(params.rates)})`)
  }
  if (params.overrides !== undefined && !Array.isArray(params.overrides)) {
    throw new CalcError(`overrides must be an array (got ${describe(params.overrides)})`)
  }
  const { targetSet, rates, overrides, staleRateDays, today } = params

  const resolved = calculateEffectiveRate({
    from,
    to,
    baseCurrency,
    rates,
    overrides
  })

  if (!resolved) {
    throw new CalcError(`Missing rate for conversion between ${from} and ${to}`)
  }

  const convertedDec = amount.times(resolved.rate)

  let isStale = false
  let oldestDaysOld: number | null = null

  if (resolved.oldestRateTimestamp) {
    const staleness = checkRateStaleness(resolved.oldestRateTimestamp, today, staleRateDays)
    isStale = staleness.isStale
    oldestDaysOld = staleness.daysOld
  }

  const snapshot: CalcRateSnapshot = {
    rateSetName: targetSet.name,
    rateSetId: targetSet.id,
    baseCurrency,
    fromCurrency: from,
    toCurrency: to,
    rateUsed: resolved.rateString,
    isDirectOverride: resolved.isDirectOverride,
    oldestRateTimestamp: resolved.oldestRateTimestamp,
    oldestDaysOld,
    isStale,
    ratesUsed: resolved.ratesUsed
  }

  return {
    amount: amount.toString(),
    from,
    to,
    result: convertedDec.toString(),
    rate: resolved.rateString,
    isDirectOverride: resolved.isDirectOverride,
    isStale,
    oldestRateAgeDays: oldestDaysOld,
    snapshot
  }
}

// ---------- 4. Rate Set CSV and JSON Export / Import ----------

export function exportRateSetToJson(rateSet: CalcRateSet, rates: CalcRate[], overrides: CalcRateOverride[] = []): string {
  if (!rateSet || typeof rateSet !== 'object') {
    throw new CalcError(`rateSet must be an object (got ${describe(rateSet)})`)
  }
  if (!Array.isArray(rates)) {
    throw new CalcError(`rates must be an array (got ${describe(rates)})`)
  }
  if (rates.some((r) => !r || typeof r !== 'object')) {
    throw new CalcError('Every rate in rates must be an object')
  }
  if (overrides !== undefined && !Array.isArray(overrides)) {
    throw new CalcError(`overrides must be an array (got ${describe(overrides)})`)
  }
  if (overrides && overrides.some((o) => !o || typeof o !== 'object')) {
    throw new CalcError('Every override in overrides must be an object')
  }
  const payload = {
    id: rateSet.id,
    name: rateSet.name,
    baseCurrency: rateSet.baseCurrency,
    updatedAt: rateSet.updatedAt,
    rates: rates.map((r) => ({
      code: r.currencyCode,
      name: r.name || '',
      rate: r.rateToBase,
      note: r.note || '',
      updatedAt: r.updatedAt
    })),
    overrides: overrides.map((o) => ({
      from: o.fromCode,
      to: o.toCode,
      rate: o.rate,
      updatedAt: o.updatedAt
    }))
  }
  return JSON.stringify(payload, null, 2)
}

function csvEscape(field: unknown): string {
  const s = String(field ?? '')
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function exportRateSetToCsv(rates: CalcRate[]): string {
  if (!Array.isArray(rates)) {
    throw new CalcError(`rates must be an array (got ${describe(rates)})`)
  }
  if (rates.some((r) => !r || typeof r !== 'object')) {
    throw new CalcError('Every rate in rates must be an object')
  }
  const headers = ['code', 'rate', 'name', 'note']
  const rows = rates.map((r) => [
    csvEscape(r.currencyCode),
    csvEscape(r.rateToBase),
    csvEscape(r.name || ''),
    csvEscape(r.note || '')
  ].join(','))
  return [headers.join(','), ...rows].join('\r\n') + '\r\n'
}

/**
 * Robust CSV line tokenizer supporting RFC 4180 quotes, commas, and line endings.
 */
function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false

  let i = 0
  while (i < csv.length) {
    const char = csv[i]
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < csv.length && csv[i + 1] === '"') {
          currentField += '"'
          i += 2
          continue
        } else {
          inQuotes = false
          i++
          continue
        }
      } else {
        currentField += char
        i++
        continue
      }
    } else {
      if (char === '"') {
        inQuotes = true
        i++
        continue
      } else if (char === ',') {
        currentRow.push(currentField)
        currentField = ''
        i++
        continue
      } else if (char === '\r') {
        if (i + 1 < csv.length && csv[i + 1] === '\n') {
          i++
        }
        currentRow.push(currentField)
        currentField = ''
        rows.push(currentRow)
        currentRow = []
        i++
        continue
      } else if (char === '\n') {
        currentRow.push(currentField)
        currentField = ''
        rows.push(currentRow)
        currentRow = []
        i++
        continue
      } else {
        currentField += char
        i++
        continue
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField)
    rows.push(currentRow)
  }

  return rows
}

/**
 * Validates a single import row:
 * - Currency code: 3-5 alphanumeric, uppercase.
 * - Rate: positive numeric decimal string.
 * - Duplicate codes reported.
 */
function validateImportRow(
  rawCode: unknown,
  rawRate: unknown,
  rawName: unknown,
  rawNote: unknown,
  rowIndex: number,
  seenCodes: Set<string>
): RateSetImportRow {
  let code: string
  try {
    code = validateCurrencyCode(rawCode)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new CalcError(`Row ${rowIndex}: invalid currency code (${msg})`)
  }

  if (seenCodes.has(code)) {
    throw new CalcError(`Row ${rowIndex}: duplicate currency code "${code}"`)
  }
  seenCodes.add(code)

  if (rawRate === null || rawRate === undefined || String(rawRate).trim() === '') {
    throw new CalcError(`Row ${rowIndex} (${code}): rate is missing`)
  }

  const rateStr = String(rawRate).trim()
  try {
    const d = new Decimal(rateStr)
    if (!d.isFinite() || d.isNegative() || d.isZero()) {
      throw new CalcError(`Row ${rowIndex} (${code}): rate must be a positive number (got "${rateStr}")`)
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Row ')) throw err
    throw new CalcError(`Row ${rowIndex} (${code}): rate must be a valid positive number (got "${rateStr}")`)
  }

  return {
    code,
    rate: rateStr,
    name: typeof rawName === 'string' ? rawName.trim() : undefined,
    note: typeof rawNote === 'string' ? rawNote.trim() : undefined
  }
}

/**
 * Parse and validate a CSV rate set import.
 * One bad row rejects the whole import with a message naming the row.
 */
export function parseAndValidateRatesCsv(csvText: string): RateSetImportRow[] {
  if (typeof csvText !== 'string') {
    throw new CalcError(`CSV content must be text (got ${describe(csvText)})`)
  }
  const trimmed = csvText.trim()
  if (!trimmed) {
    throw new CalcError('CSV content is empty')
  }

  const rawRows = parseCsvRows(trimmed).filter((r) => r.some((c) => c.trim().length > 0))
  if (rawRows.length === 0) {
    throw new CalcError('CSV contains no data rows')
  }

  // Check header
  let startIdx = 0
  const firstCol0 = rawRows[0][0]?.trim().toLowerCase()
  const firstCol1 = rawRows[0][1]?.trim().toLowerCase()
  if (firstCol0 === 'code' || firstCol0 === 'currency' || firstCol1 === 'rate') {
    startIdx = 1
  }

  const validated: RateSetImportRow[] = []
  const seenCodes = new Set<string>()

  for (let i = startIdx; i < rawRows.length; i++) {
    const row = rawRows[i]
    const rowNum = i + 1
    const code = row[0]
    const rate = row[1]
    const name = row[2]
    const note = row[3]

    validated.push(validateImportRow(code, rate, name, note, rowNum, seenCodes))
  }

  if (validated.length === 0) {
    throw new CalcError('No valid rate rows found in CSV')
  }

  return validated
}

/**
 * Parse and validate a JSON rate set import.
 * Supports either:
 * - An array of { code, rate, name?, note? } objects
 * - A rate set bundle object: { rates: [...] }
 */
export function parseAndValidateRatesJson(jsonText: string): RateSetImportRow[] {
  if (typeof jsonText !== 'string') {
    throw new CalcError(`JSON content must be text (got ${describe(jsonText)})`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new CalcError('Invalid JSON format')
  }

  let rows: unknown[]
  if (Array.isArray(parsed)) {
    rows = parsed
  } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).rates)) {
    rows = (parsed as any).rates
  } else {
    throw new CalcError('JSON rate set must be an array of rate objects or an object with a "rates" array')
  }

  if (rows.length === 0) {
    throw new CalcError('JSON contains no rate rows')
  }

  const validated: RateSetImportRow[] = []
  const seenCodes = new Set<string>()

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const rowNum = i + 1
    if (!r || typeof r !== 'object') {
      throw new CalcError(`Row ${rowNum}: item must be an object`)
    }
    const item = r as Record<string, unknown>
    const code = item.code ?? item.currencyCode ?? item.currency
    const rate = item.rate ?? item.rateToBase
    const name = item.name
    const note = item.note

    validated.push(validateImportRow(code, rate, name, note, rowNum, seenCodes))
  }

  return validated
}
