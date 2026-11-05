// Adapter interfaces for the calculator module.
// These contracts isolate all platform, storage, settings, and rate-provider concerns
// from the pure mathematical core and UI shell.

export interface CalcHistoryItem {
  id: string
  createdAt: string
  mode: string
  input: string
  result: string
  resultFormat: 'decimal' | 'fraction' | 'scientific' | 'engineering'
  rateSnapshot?: string | null
  pinned?: boolean
}

export interface CalcProgram {
  id: string
  name: string
  source: string
  createdAt: string
  updatedAt: string
}

export interface CalcRateSet {
  id: string
  name: string
  baseCurrency: string
  isActive: boolean
  updatedAt: string
}

export interface CalcRate {
  id: string
  rateSetId: string
  currencyCode: string
  name?: string
  rateToBase: string
  note?: string
  updatedAt: string
}

export interface CalcRateOverride {
  id: string
  rateSetId: string
  fromCode: string
  toCode: string
  rate: string
  updatedAt: string
}

export interface CalcSettings {
  precision: number
  angleMode: 'deg' | 'rad' | 'grad'
  defaultOutputFormat: 'decimal' | 'fraction' | 'scientific' | 'engineering'
  baseCurrency: string
  staleRateDays: number
  maxHistoryItems: number
  /** Decimal places shown on currency conversion results. Stored rates are never rounded. */
  currencyDisplayDecimals: number
}

export const DEFAULT_CALC_SETTINGS: CalcSettings = {
  precision: 12,
  angleMode: 'deg',
  defaultOutputFormat: 'decimal',
  baseCurrency: 'USD',
  staleRateDays: 7,
  maxHistoryItems: 100,
  currencyDisplayDecimals: 2
}

export interface CalcRateSnapshot {
  rateSetName: string
  rateSetId: string
  baseCurrency: string
  fromCurrency: string
  toCurrency: string
  rateUsed: string
  isDirectOverride: boolean
  oldestRateTimestamp: string | null
  oldestDaysOld: number | null
  isStale: boolean
  ratesUsed: Array<{
    currencyCode: string
    rateToBase: string
    updatedAt: string
  }>
}

export interface StaleRateInfo {
  isStale: boolean
  daysOld: number
}

export interface RateSetImportRow {
  code: string
  rate: string
  name?: string
  note?: string
}

export interface StorageAdapter {
  saveHistory(item: Omit<CalcHistoryItem, 'id' | 'createdAt'>): Promise<CalcHistoryItem>
  loadHistory(limit?: number): Promise<CalcHistoryItem[]>
  clearHistory(): Promise<void>
  deleteHistoryItem(id: string): Promise<void>
  togglePinHistory(id: string): Promise<void>

  saveVariable(name: string, value: string): Promise<void>
  loadVariables(): Promise<Record<string, string>>
  deleteVariable(name: string): Promise<void>

  saveProgram(program: Omit<CalcProgram, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<CalcProgram>
  loadPrograms(): Promise<CalcProgram[]>
  deleteProgram(id: string): Promise<void>

  saveRateSet(rateSet: Omit<CalcRateSet, 'id' | 'updatedAt'> & { id?: string }): Promise<CalcRateSet>
  renameRateSet(id: string, newName: string): Promise<CalcRateSet>
  deleteRateSet(id: string): Promise<void>
  selectRateSet(id: string): Promise<void>
  loadRateSets(): Promise<CalcRateSet[]>

  saveRate(rate: Omit<CalcRate, 'id' | 'updatedAt'> & { id?: string; updatedAt?: string }): Promise<CalcRate>
  updateRate(id: string, rateToBase: string, note?: string, name?: string): Promise<CalcRate>
  loadRates(rateSetId: string): Promise<CalcRate[]>

  saveRateOverride(override: Omit<CalcRateOverride, 'id' | 'updatedAt'> & { id?: string; updatedAt?: string }): Promise<CalcRateOverride>
  listRateOverrides(rateSetId: string): Promise<CalcRateOverride[]>
  deleteRateOverride(id: string): Promise<void>

  importRates(rateSetId: string, rows: RateSetImportRow[], mode: 'merge' | 'replace'): Promise<{ count: number }>

  getSetting<K extends keyof CalcSettings>(key: K): Promise<CalcSettings[K]>
  setSetting<K extends keyof CalcSettings>(key: K, value: CalcSettings[K]): Promise<void>
  getAllSettings(): Promise<CalcSettings>
}
