import type {
  CalcHistoryItem,
  CalcProgram,
  CalcRate,
  CalcRateOverride,
  CalcRateSet,
  CalcSettings,
  RateSetImportRow,
  StorageAdapter
} from '../../../../../shared/calculator/types'
import { DEFAULT_CALC_SETTINGS } from '../../../../../shared/calculator/types'

// Preload/Local Storage implementation for the calculator
export class LocalStorageCalculatorAdapter implements StorageAdapter {
  private historyKey = 'calc_history_items'
  private varKey = 'calc_variables'
  private progKey = 'calc_programs'
  private rateSetsKey = 'calc_rate_sets'
  private ratesKey = 'calc_rates'
  private overridesKey = 'calc_rate_overrides'
  private settingsKey = 'calc_settings'

  private read<T>(key: string, fallback: T): T {
    try {
      const data = localStorage.getItem(key)
      return data ? JSON.parse(data) : fallback
    } catch {
      return fallback
    }
  }

  private write<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // ignore
    }
  }

  async saveHistory(item: Omit<CalcHistoryItem, 'id' | 'createdAt'>): Promise<CalcHistoryItem> {
    const list = this.read<CalcHistoryItem[]>(this.historyKey, [])
    const newItem: CalcHistoryItem = {
      ...item,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString()
    }
    list.unshift(newItem)
    // Enforce maxHistoryItems from the settings store: keep the newest rows first
    // (pinned stay pinned at the top) and drop the oldest unpinned overflow.
    const settings = this.read<CalcSettings>(this.settingsKey, DEFAULT_CALC_SETTINGS)
    const max = Math.max(1, Math.floor(settings.maxHistoryItems ?? DEFAULT_CALC_SETTINGS.maxHistoryItems))
    const kept: CalcHistoryItem[] = []
    let count = 0
    for (const row of list) {
      if (row.pinned || count < max) {
        kept.push(row)
        if (!row.pinned) count++
      }
    }
    this.write(this.historyKey, kept)
    return newItem
  }

  async loadHistory(limit = 100): Promise<CalcHistoryItem[]> {
    const list = this.read<CalcHistoryItem[]>(this.historyKey, [])
    return list.slice(0, limit)
  }

  async clearHistory(): Promise<void> {
    this.write(this.historyKey, [])
  }

  async deleteHistoryItem(id: string): Promise<void> {
    const list = this.read<CalcHistoryItem[]>(this.historyKey, [])
    this.write(this.historyKey, list.filter((item) => item.id !== id))
  }

  async togglePinHistory(id: string): Promise<void> {
    const list = this.read<CalcHistoryItem[]>(this.historyKey, [])
    const found = list.find((item) => item.id === id)
    if (found) {
      found.pinned = !found.pinned
      this.write(this.historyKey, list)
    }
  }

  async saveVariable(name: string, value: string): Promise<void> {
    const vars = this.read<Record<string, string>>(this.varKey, {})
    vars[name.toLowerCase()] = value
    this.write(this.varKey, vars)
  }

  async loadVariables(): Promise<Record<string, string>> {
    return this.read<Record<string, string>>(this.varKey, {})
  }

  async deleteVariable(name: string): Promise<void> {
    const vars = this.read<Record<string, string>>(this.varKey, {})
    delete vars[name.toLowerCase()]
    this.write(this.varKey, vars)
  }

  async saveProgram(program: Omit<CalcProgram, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<CalcProgram> {
    const list = this.read<CalcProgram[]>(this.progKey, [])
    const id = program.id || `${Date.now()}`
    const existing = list.find((p) => p.id === id)
    const now = new Date().toISOString()
    if (existing) {
      existing.name = program.name
      existing.source = program.source
      existing.updatedAt = now
      this.write(this.progKey, list)
      return existing
    }
    const newProg: CalcProgram = {
      id,
      name: program.name,
      source: program.source,
      createdAt: now,
      updatedAt: now
    }
    list.push(newProg)
    this.write(this.progKey, list)
    return newProg
  }

  async loadPrograms(): Promise<CalcProgram[]> {
    return this.read<CalcProgram[]>(this.progKey, [])
  }

  async deleteProgram(id: string): Promise<void> {
    const list = this.read<CalcProgram[]>(this.progKey, [])
    this.write(this.progKey, list.filter((p) => p.id !== id))
  }

  async saveRateSet(rateSet: Omit<CalcRateSet, 'id' | 'updatedAt'> & { id?: string }): Promise<CalcRateSet> {
    const list = this.read<CalcRateSet[]>(this.rateSetsKey, [
      { id: 'default', name: 'Default', baseCurrency: 'USD', isActive: true, updatedAt: new Date().toISOString() }
    ])
    const id = rateSet.id || `${Date.now()}`
    const now = new Date().toISOString()
    const existingIndex = list.findIndex((s) => s.id === id)
    const set: CalcRateSet = {
      id,
      name: rateSet.name,
      baseCurrency: rateSet.baseCurrency,
      isActive: rateSet.isActive,
      updatedAt: now
    }
    if (existingIndex >= 0) {
      list[existingIndex] = set
    } else {
      list.push(set)
    }
    this.write(this.rateSetsKey, list)
    return set
  }

  async renameRateSet(id: string, newName: string): Promise<CalcRateSet> {
    const list = await this.loadRateSets()
    const found = list.find((s) => s.id === id)
    if (!found) throw new Error(`Rate set "${id}" not found`)
    found.name = newName.trim()
    found.updatedAt = new Date().toISOString()
    this.write(this.rateSetsKey, list)
    return found
  }

  async deleteRateSet(id: string): Promise<void> {
    if (id === 'default') throw new Error('The default rate set cannot be deleted')
    const sets = await this.loadRateSets()
    const filtered = sets.filter((s) => s.id !== id)
    const wasActive = sets.find((s) => s.id === id)?.isActive
    if (wasActive) {
      const def = filtered.find((s) => s.id === 'default')
      if (def) def.isActive = true
    }
    this.write(this.rateSetsKey, filtered)

    // Cascade delete rates & overrides
    const rates = this.read<CalcRate[]>(this.ratesKey, [])
    this.write(this.ratesKey, rates.filter((r) => r.rateSetId !== id))
    const overrides = this.read<CalcRateOverride[]>(this.overridesKey, [])
    this.write(this.overridesKey, overrides.filter((o) => o.rateSetId !== id))
  }

  async selectRateSet(id: string): Promise<void> {
    const sets = await this.loadRateSets()
    for (const s of sets) {
      s.isActive = s.id === id
    }
    this.write(this.rateSetsKey, sets)
  }

  async loadRateSets(): Promise<CalcRateSet[]> {
    return this.read<CalcRateSet[]>(this.rateSetsKey, [
      { id: 'default', name: 'Default', baseCurrency: 'USD', isActive: true, updatedAt: new Date().toISOString() }
    ])
  }

  async saveRate(rate: Omit<CalcRate, 'id' | 'updatedAt'> & { id?: string; updatedAt?: string }): Promise<CalcRate> {
    const list = this.read<CalcRate[]>(this.ratesKey, [])
    const curr = rate.currencyCode.toUpperCase()
    const existingIndex = list.findIndex((r) => r.rateSetId === rate.rateSetId && r.currencyCode === curr)
    const now = rate.updatedAt || new Date().toISOString()
    if (existingIndex >= 0) {
      const existing = list[existingIndex]
      const updated: CalcRate = {
        ...existing,
        name: rate.name ?? existing.name,
        rateToBase: rate.rateToBase,
        note: rate.note ?? existing.note,
        updatedAt: now
      }
      list[existingIndex] = updated
      this.write(this.ratesKey, list)
      return updated
    }
    const id = rate.id || `${Date.now()}`
    const newRate: CalcRate = {
      ...rate,
      currencyCode: curr,
      id,
      updatedAt: now
    }
    list.push(newRate)
    this.write(this.ratesKey, list)
    return newRate
  }

  async updateRate(id: string, rateToBase: string, note?: string, name?: string): Promise<CalcRate> {
    const list = this.read<CalcRate[]>(this.ratesKey, [])
    const found = list.find((r) => r.id === id)
    if (!found) throw new Error(`Rate "${id}" not found`)
    found.rateToBase = rateToBase
    if (note !== undefined) found.note = note
    if (name !== undefined) found.name = name
    found.updatedAt = new Date().toISOString()
    this.write(this.ratesKey, list)
    return found
  }

  async loadRates(rateSetId: string): Promise<CalcRate[]> {
    const list = this.read<CalcRate[]>(this.ratesKey, [])
    return list.filter((r) => r.rateSetId === rateSetId)
  }

  async saveRateOverride(override: Omit<CalcRateOverride, 'id' | 'updatedAt'> & { id?: string; updatedAt?: string }): Promise<CalcRateOverride> {
    const list = this.read<CalcRateOverride[]>(this.overridesKey, [])
    const from = override.fromCode.toUpperCase()
    const to = override.toCode.toUpperCase()
    const existingIndex = list.findIndex((o) => o.rateSetId === override.rateSetId && o.fromCode === from && o.toCode === to)
    const now = override.updatedAt || new Date().toISOString()
    if (existingIndex >= 0) {
      const existing = list[existingIndex]
      existing.rate = override.rate
      existing.updatedAt = now
      this.write(this.overridesKey, list)
      return existing
    }
    const id = override.id || `${Date.now()}`
    const item: CalcRateOverride = {
      id,
      rateSetId: override.rateSetId,
      fromCode: from,
      toCode: to,
      rate: override.rate,
      updatedAt: now
    }
    list.push(item)
    this.write(this.overridesKey, list)
    return item
  }

  async listRateOverrides(rateSetId: string): Promise<CalcRateOverride[]> {
    const list = this.read<CalcRateOverride[]>(this.overridesKey, [])
    return list.filter((o) => o.rateSetId === rateSetId)
  }

  async deleteRateOverride(id: string): Promise<void> {
    const list = this.read<CalcRateOverride[]>(this.overridesKey, [])
    this.write(this.overridesKey, list.filter((o) => o.id !== id))
  }

  async importRates(rateSetId: string, rows: RateSetImportRow[], mode: 'merge' | 'replace'): Promise<{ count: number }> {
    const sets = await this.loadRateSets()
    if (!sets.some((s) => s.id === rateSetId)) {
      throw new Error(`Rate set "${rateSetId}" not found`)
    }
    let list = this.read<CalcRate[]>(this.ratesKey, [])
    if (mode === 'replace') {
      list = list.filter((r) => r.rateSetId !== rateSetId)
    }
    const now = new Date().toISOString()
    for (const row of rows) {
      const code = row.code.toUpperCase()
      const existing = list.find((r) => r.rateSetId === rateSetId && r.currencyCode === code)
      if (existing) {
        existing.rateToBase = row.rate
        if (row.name !== undefined) existing.name = row.name
        if (row.note !== undefined) existing.note = row.note
        existing.updatedAt = now
      } else {
        list.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          rateSetId,
          currencyCode: code,
          rateToBase: row.rate,
          name: row.name,
          note: row.note,
          updatedAt: now
        })
      }
    }
    this.write(this.ratesKey, list)
    return { count: rows.length }
  }

  async getSetting<K extends keyof CalcSettings>(key: K): Promise<CalcSettings[K]> {
    const current = this.read<CalcSettings>(this.settingsKey, DEFAULT_CALC_SETTINGS)
    return current[key] ?? DEFAULT_CALC_SETTINGS[key]
  }

  async setSetting<K extends keyof CalcSettings>(key: K, value: CalcSettings[K]): Promise<void> {
    const current = this.read<CalcSettings>(this.settingsKey, DEFAULT_CALC_SETTINGS)
    current[key] = value
    this.write(this.settingsKey, current)
  }

  async getAllSettings(): Promise<CalcSettings> {
    return this.read<CalcSettings>(this.settingsKey, DEFAULT_CALC_SETTINGS)
  }
}

export class ElectronIpcCalculatorAdapter implements StorageAdapter {
  private fallback = new LocalStorageCalculatorAdapter()

  private get api() {
    return (window as any).api?.calculator
  }

  async saveHistory(item: Omit<CalcHistoryItem, 'id' | 'createdAt'>): Promise<CalcHistoryItem> {
    if (this.api) return this.api.saveHistory(item)
    return this.fallback.saveHistory(item)
  }

  async loadHistory(limit?: number): Promise<CalcHistoryItem[]> {
    if (this.api) return this.api.listHistory(limit)
    return this.fallback.loadHistory(limit)
  }

  async clearHistory(): Promise<void> {
    if (this.api) return this.api.clearHistory()
    return this.fallback.clearHistory()
  }

  async deleteHistoryItem(id: string): Promise<void> {
    if (this.api) return this.api.deleteHistoryItem(id)
    return this.fallback.deleteHistoryItem(id)
  }

  async togglePinHistory(id: string): Promise<void> {
    if (this.api) return this.api.togglePinHistory(id)
    return this.fallback.togglePinHistory(id)
  }

  async saveVariable(name: string, value: string): Promise<void> {
    if (this.api) return this.api.saveVariable(name, value)
    return this.fallback.saveVariable(name, value)
  }

  async loadVariables(): Promise<Record<string, string>> {
    if (this.api) return this.api.listVariables()
    return this.fallback.loadVariables()
  }

  async deleteVariable(name: string): Promise<void> {
    if (this.api) return this.api.deleteVariable(name)
    return this.fallback.deleteVariable(name)
  }

  async saveProgram(program: Omit<CalcProgram, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<CalcProgram> {
    if (this.api) return this.api.saveProgram(program)
    return this.fallback.saveProgram(program)
  }

  async loadPrograms(): Promise<CalcProgram[]> {
    if (this.api) return this.api.listPrograms()
    return this.fallback.loadPrograms()
  }

  async deleteProgram(id: string): Promise<void> {
    if (this.api) return this.api.deleteProgram(id)
    return this.fallback.deleteProgram(id)
  }

  async saveRateSet(rateSet: Omit<CalcRateSet, 'id' | 'updatedAt'> & { id?: string }): Promise<CalcRateSet> {
    if (this.api) return this.api.saveRateSet(rateSet)
    return this.fallback.saveRateSet(rateSet)
  }

  async renameRateSet(id: string, newName: string): Promise<CalcRateSet> {
    if (this.api) return this.api.renameRateSet(id, newName)
    return this.fallback.renameRateSet(id, newName)
  }

  async deleteRateSet(id: string): Promise<void> {
    if (this.api) return this.api.deleteRateSet(id)
    return this.fallback.deleteRateSet(id)
  }

  async selectRateSet(id: string): Promise<void> {
    if (this.api) return this.api.selectRateSet(id)
    return this.fallback.selectRateSet(id)
  }

  async loadRateSets(): Promise<CalcRateSet[]> {
    if (this.api) return this.api.listRateSets()
    return this.fallback.loadRateSets()
  }

  async saveRate(rate: Omit<CalcRate, 'id' | 'updatedAt'> & { id?: string; updatedAt?: string }): Promise<CalcRate> {
    if (this.api) return this.api.saveRate(rate)
    return this.fallback.saveRate(rate)
  }

  async updateRate(id: string, rateToBase: string, note?: string, name?: string): Promise<CalcRate> {
    if (this.api) return this.api.updateRate(id, rateToBase, note, name)
    return this.fallback.updateRate(id, rateToBase, note, name)
  }

  async loadRates(rateSetId: string): Promise<CalcRate[]> {
    if (this.api) return this.api.listRates(rateSetId)
    return this.fallback.loadRates(rateSetId)
  }

  async saveRateOverride(override: Omit<CalcRateOverride, 'id' | 'updatedAt'> & { id?: string; updatedAt?: string }): Promise<CalcRateOverride> {
    if (this.api) return this.api.saveRateOverride(override)
    return this.fallback.saveRateOverride(override)
  }

  async listRateOverrides(rateSetId: string): Promise<CalcRateOverride[]> {
    if (this.api) return this.api.listRateOverrides(rateSetId)
    return this.fallback.listRateOverrides(rateSetId)
  }

  async deleteRateOverride(id: string): Promise<void> {
    if (this.api) return this.api.deleteRateOverride(id)
    return this.fallback.deleteRateOverride(id)
  }

  async importRates(rateSetId: string, rows: RateSetImportRow[], mode: 'merge' | 'replace'): Promise<{ count: number }> {
    if (this.api) return this.api.importRateSet(rateSetId, rows, mode)
    return this.fallback.importRates(rateSetId, rows, mode)
  }

  async getSetting<K extends keyof CalcSettings>(key: K): Promise<CalcSettings[K]> {
    if (this.api) return this.api.getSetting(key)
    return this.fallback.getSetting(key)
  }

  async setSetting<K extends keyof CalcSettings>(key: K, value: CalcSettings[K]): Promise<void> {
    if (this.api) return this.api.setSetting(key, value)
    return this.fallback.setSetting(key, value)
  }

  async getAllSettings(): Promise<CalcSettings> {
    if (this.api) return this.api.getAllSettings()
    return this.fallback.getAllSettings()
  }
}

export const defaultStorageAdapter = new ElectronIpcCalculatorAdapter()
