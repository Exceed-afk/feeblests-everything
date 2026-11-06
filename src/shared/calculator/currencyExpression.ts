// Currency syntax in the expression bar: `100 USD to EUR` (also `100 usd in eur`).
//
// The parser turns that into a CurrencyConversion node and the evaluator runs it
// through performCurrencyConversion in rates.ts — the same code the Convert panel
// uses. This file holds the two small pure pieces around that:
//   - loadCurrencyContext: read the active rate set from a storage adapter,
//   - formatCurrencyResult: how the result is shown (`92.31 EUR`).
//
// No network access: only the rates the app already stores are used.

import { Decimal } from './numeric'
import { CalcError } from './errors'
import { validateCurrencyCode } from './rates'
import type { CurrencyContext } from './evaluator'
import type { CalcRate, CalcRateOverride, CalcRateSet, CalcSettings, StorageAdapter } from './types'
import { DEFAULT_CALC_SETTINGS } from './types'

/**
 * The active rate set and its rates, ready for the evaluator.
 * Returns null when there is no rate set at all (the evaluator then explains that
 * a conversion needs the offline rates).
 */
export async function loadCurrencyContext(adapter: StorageAdapter): Promise<CurrencyContext | null> {
  const [sets, settings] = await Promise.all([adapter.loadRateSets(), adapter.getAllSettings()])
  const active = sets.find((s) => s.isActive) ?? sets.find((s) => s.id === 'default') ?? sets[0]
  if (!active) return null
  const [rates, overrides] = await Promise.all([
    adapter.loadRates(active.id),
    adapter.listRateOverrides(active.id)
  ])
  return {
    rateSet: active,
    rates,
    overrides,
    baseCurrency: active.baseCurrency,
    staleRateDays: settings.staleRateDays ?? DEFAULT_CALC_SETTINGS.staleRateDays,
    today: new Date()
  }
}

/**
 * The result line for a conversion: the number at the display precision plus the
 * target code, e.g. `92.31 EUR`. The stored value (and Ans) stays the exact number.
 */
export function formatCurrencyResult(value: Decimal, code: string, decimals: number): string {
  const places = Number.isInteger(decimals) && decimals >= 0 ? decimals : DEFAULT_CALC_SETTINGS.currencyDisplayDecimals
  // toFixed keeps the trailing zeros, so 92 shows as `92.00 EUR` like the Convert panel.
  return `${value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places)} ${validateCurrencyCode(code)}`
}

/** True when the text looks like it contains a currency conversion (`… USD to EUR`). */
export function looksLikeCurrencyConversion(text: string): boolean {
  return /\b[A-Za-z0-9]{3,5}\s+(?:to|in)\s+[A-Za-z0-9]{3,5}\s*$/i.test(text.trim())
}

/** A clear error for a code the rate set does not know, naming the code. */
export function missingRateError(code: string, ctx: Pick<CurrencyContext, 'rateSet' | 'rates' | 'baseCurrency'>): CalcError {
  const known = new Set([ctx.baseCurrency.toUpperCase(), ...ctx.rates.map((r) => r.currencyCode.toUpperCase())])
  if (!known.has(code.toUpperCase())) {
    return new CalcError(`Unknown currency code "${code.toUpperCase()}" — it is not in the rate set "${ctx.rateSet.name}"`)
  }
  return new CalcError(`Missing rate for ${code.toUpperCase()} in the rate set "${ctx.rateSet.name}"`)
}

export type { CalcRate, CalcRateOverride, CalcRateSet, CalcSettings }
