// Pure helpers for the currency UI: display formatting, list ordering and the
// shapes the panel keeps between a conversion and the history entry it writes.
//
// Kept in src/shared so it can be unit-tested without a renderer. No storage,
// React or Electron imports here.

import type { CalcHistoryItem, CalcRate, CalcRateSet } from './types'

/** History mode used by every currency conversion (Section 7: explainable history). */
export const CURRENCY_HISTORY_MODE = 'currency'

/** Default number of decimal places shown on a conversion result (thinking only, never storage). */
export const DEFAULT_DISPLAY_DECIMALS = 2

export const DISPLAY_DECIMALS_OPTIONS = [0, 2, 3, 4, 6, 8] as const

/** The piece of state a currency conversion stores alongside a history row. */
export interface CurrencyConversionRecord {
  amount: string
  from: string
  to: string
  set: string
  /** Rate used, exactly as the logic layer produced it. */
  rate: string
  /** Rate-to-base entries the conversion depended on (may be empty for overrides). */
  rates: { currencyCode: string; rateToBase: string; updatedAt: string }[]
  override: boolean
  stale: boolean
  age: number | null
  result: string
  decimals: number
}

/**
 * Serialise a conversion for calc_history.
 * `result` in the history row is always the unrounded exact value, so the row stays
 * correct if the user later changes the display-decimals setting.
 */
export function buildCurrencyHistoryItem(record: CurrencyConversionRecord): {
  mode: string
  input: string
  result: string
  resultFormat: 'decimal'
  rateSnapshot: string
} {
  const payload = {
    kind: 'currency',
    amount: record.amount,
    from: record.from,
    to: record.to,
    rateSetId: record.set,
    rate: record.rate,
    ratesUsed: record.rates,
    isDirectOverride: record.override,
    isStale: record.stale,
    oldestDaysOld: record.age
  }
  return {
    mode: CURRENCY_HISTORY_MODE,
    input: `${record.amount} ${record.from} → ${record.to}`,
    result: record.result,
    resultFormat: 'decimal',
    rateSnapshot: JSON.stringify(payload)
  }
}

/** Read a stored currency conversion back from a history row. Returns null for anything else. */
export function readCurrencyHistoryItem(item: CalcHistoryItem): CurrencyConversionRecord | null {
  if (!item.rateSnapshot) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(item.rateSnapshot)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>
  if (p.kind !== 'currency') return null
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    amount: typeof p.amount === 'string' ? p.amount : '',
    from: typeof p.from === 'string' ? p.from : '',
    to: typeof p.to === 'string' ? p.to : '',
    set: typeof p.rateSetId === 'string' ? p.rateSetId : '',
    rate: typeof p.rate === 'string' ? p.rate : '',
    rates: Array.isArray(p.ratesUsed) ? (p.ratesUsed as CurrencyConversionRecord['rates']) : [],
    override: p.isDirectOverride === true,
    stale: p.isStale === true,
    age: typeof p.oldestDaysOld === 'number' ? num(p.oldestDaysOld) : null,
    result: item.result,
    decimals: DEFAULT_DISPLAY_DECIMALS
  }
}

/** Which rate sets are always present, so the UI can refuse to delete it before asking the main process. */
export function isDefaultRateSet(set: Pick<CalcRateSet, 'id'>): boolean {
  return set.id === 'default'
}

/** Rates sorted by code, base currency first, so the list is stable and the base is easy to find. */
export function sortRatesForDisplay(rates: CalcRate[], baseCurrency: string): CalcRate[] {
  const base = baseCurrency.trim().toUpperCase()
  return [...rates].sort((a, b) => {
    if (a.currencyCode === base) return -1
    if (b.currencyCode === base) return 1
    return a.currencyCode.localeCompare(b.currencyCode)
  })
}

/** `YYYY-MM-DD` in local time (the timestamp is stored as ISO in UTC). */
export function formatRateDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'unknown'
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** "3 days" / "1 day" — used in the stale warning text. */
export function describeDays(days: number | null): string {
  if (days === null) return 'unknown age'
  return days === 1 ? '1 day old' : `${days} days old`
}

/** True when two pair overrides point the same way (either order), used to keep the list tidy. */
export function overrideKey(from: string, to: string): string {
  return `${from.trim().toUpperCase()}→${to.trim().toUpperCase()}`
}
