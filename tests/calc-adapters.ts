import assert from 'node:assert/strict'
import type {
  StorageAdapter,
  CalcHistoryItem,
  CalcProgram,
  CalcRateSet,
  CalcRate,
  CalcRateOverride,
  CalcSettings,
  RateSetImportRow
} from '../src/shared/calculator/types'
import { DEFAULT_CALC_SETTINGS } from '../src/shared/calculator/types'

// In-memory test implementation of StorageAdapter
export class MockStorageAdapter implements StorageAdapter {
  history: CalcHistoryItem[] = []
  variables: Record<string, string> = {}
  programs: CalcProgram[] = []
  rateSets: CalcRateSet[] = [
    { id: 'default', name: 'Default', baseCurrency: 'USD', isActive: true, updatedAt: new Date().toISOString() }
  ]
  rates: CalcRate[] = []
  overrides: CalcRateOverride[] = []
  settings: CalcSettings = { ...DEFAULT_CALC_SETTINGS }

  async saveHistory(item: Omit<CalcHistoryItem, 'id' | 'createdAt'>): Promise<CalcHistoryItem> {
    const newItem: CalcHistoryItem = {
      ...item,
      id: String(this.history.length + 1),
      createdAt: new Date().toISOString()
    }
    this.history.unshift(newItem)
    return newItem
  }

  async loadHistory(limit = 100): Promise<CalcHistoryItem[]> {
    return this.history.slice(0, limit)
  }

  async clearHistory(): Promise<void> {
    this.history = []
  }

  async deleteHistoryItem(id: string): Promise<void> {
    this.history = this.history.filter((h) => h.id !== id)
  }

  async togglePinHistory(id: string): Promise<void> {
    const item = this.history.find((h) => h.id === id)
    if (item) item.pinned = !item.pinned
  }

  async saveVariable(name: string, value: string): Promise<void> {
    this.variables[name.toLowerCase()] = value
  }

  async loadVariables(): Promise<Record<string, string>> {
    return { ...this.variables }
  }

  async deleteVariable(name: string): Promise<void> {
    delete this.variables[name.toLowerCase()]
  }

  async saveProgram(program: Omit<CalcProgram, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<CalcProgram> {
    const id = program.id || String(this.programs.length + 1)
    const existing = this.programs.find((p) => p.id === id)
    const now = new Date().toISOString()
    if (existing) {
      existing.name = program.name
      existing.source = program.source
      existing.updatedAt = now
      return existing
    }
    const newProg: CalcProgram = {
      id,
      name: program.name,
      source: program.source,
      createdAt: now,
      updatedAt: now
    }
    this.programs.push(newProg)
    return newProg
  }

  async loadPrograms(): Promise<CalcProgram[]> {
    return [...this.programs]
  }

  async deleteProgram(id: string): Promise<void> {
    this.programs = this.programs.filter((p) => p.id !== id)
  }

  async saveRateSet(rateSet: Omit<CalcRateSet, 'id' | 'updatedAt'> & { id?: string }): Promise<CalcRateSet> {
    const id = rateSet.id || String(this.rateSets.length + 1)
    const now = new Date().toISOString()
    const set: CalcRateSet = {
      id,
      name: rateSet.name,
      baseCurrency: rateSet.baseCurrency,
      isActive: rateSet.isActive,
      updatedAt: now
    }
    const existingIndex = this.rateSets.findIndex((s) => s.id === id)
    if (existingIndex >= 0) {
      this.rateSets[existingIndex] = set
    } else {
      this.rateSets.push(set)
    }
    return set
  }

  async renameRateSet(id: string, newName: string): Promise<CalcRateSet> {
    const found = this.rateSets.find((s) => s.id === id)
    if (!found) throw new Error(`Rate set "${id}" not found`)
    found.name = newName.trim()
    found.updatedAt = new Date().toISOString()
    return found
  }

  async deleteRateSet(id: string): Promise<void> {
    if (id === 'default') throw new Error('The default rate set cannot be deleted')
    const wasActive = this.rateSets.find((s) => s.id === id)?.isActive
    this.rateSets = this.rateSets.filter((s) => s.id !== id)
    if (wasActive) {
      const def = this.rateSets.find((s) => s.id === 'default')
      if (def) def.isActive = true
    }
    this.rates = this.rates.filter((r) => r.rateSetId !== id)
    this.overrides = this.overrides.filter((o) => o.rateSetId !== id)
  }

  async selectRateSet(id: string): Promise<void> {
    for (const s of this.rateSets) {
      s.isActive = s.id === id
    }
  }

  async loadRateSets(): Promise<CalcRateSet[]> {
    return [...this.rateSets]
  }

  async saveRate(rate: Omit<CalcRate, 'id' | 'updatedAt'> & { id?: string; updatedAt?: string }): Promise<CalcRate> {
    const curr = rate.currencyCode.toUpperCase()
    const existingIndex = this.rates.findIndex((r) => r.rateSetId === rate.rateSetId && r.currencyCode === curr)
    const now = rate.updatedAt || new Date().toISOString()
    if (existingIndex >= 0) {
      const existing = this.rates[existingIndex]
      const updated: CalcRate = {
        ...existing,
        name: rate.name ?? existing.name,
        rateToBase: rate.rateToBase,
        note: rate.note ?? existing.note,
        updatedAt: now
      }
      this.rates[existingIndex] = updated
      return updated
    }
    const id = rate.id || String(this.rates.length + 1)
    const newRate: CalcRate = {
      ...rate,
      currencyCode: curr,
      id,
      updatedAt: now
    }
    this.rates.push(newRate)
    return newRate
  }

  async updateRate(id: string, rateToBase: string, note?: string, name?: string): Promise<CalcRate> {
    const found = this.rates.find((r) => r.id === id)
    if (!found) throw new Error(`Rate "${id}" not found`)
    found.rateToBase = rateToBase
    if (note !== undefined) found.note = note
    if (name !== undefined) found.name = name
    found.updatedAt = new Date().toISOString()
    return found
  }

  async loadRates(rateSetId: string): Promise<CalcRate[]> {
    return this.rates.filter((r) => r.rateSetId === rateSetId)
  }

  async saveRateOverride(override: Omit<CalcRateOverride, 'id' | 'updatedAt'> & { id?: string; updatedAt?: string }): Promise<CalcRateOverride> {
    const from = override.fromCode.toUpperCase()
    const to = override.toCode.toUpperCase()
    const existingIndex = this.overrides.findIndex((o) => o.rateSetId === override.rateSetId && o.fromCode === from && o.toCode === to)
    const now = override.updatedAt || new Date().toISOString()
    if (existingIndex >= 0) {
      const existing = this.overrides[existingIndex]
      existing.rate = override.rate
      existing.updatedAt = now
      return existing
    }
    const id = override.id || String(this.overrides.length + 1)
    const item: CalcRateOverride = {
      id,
      rateSetId: override.rateSetId,
      fromCode: from,
      toCode: to,
      rate: override.rate,
      updatedAt: now
    }
    this.overrides.push(item)
    return item
  }

  async listRateOverrides(rateSetId: string): Promise<CalcRateOverride[]> {
    return this.overrides.filter((o) => o.rateSetId === rateSetId)
  }

  async deleteRateOverride(id: string): Promise<void> {
    this.overrides = this.overrides.filter((o) => o.id !== id)
  }

  async importRates(rateSetId: string, rows: RateSetImportRow[], mode: 'merge' | 'replace'): Promise<{ count: number }> {
    if (mode === 'replace') {
      this.rates = this.rates.filter((r) => r.rateSetId !== rateSetId)
    }
    const now = new Date().toISOString()
    for (const row of rows) {
      const code = row.code.toUpperCase()
      const existing = this.rates.find((r) => r.rateSetId === rateSetId && r.currencyCode === code)
      if (existing) {
        existing.rateToBase = row.rate
        if (row.name !== undefined) existing.name = row.name
        if (row.note !== undefined) existing.note = row.note
        existing.updatedAt = now
      } else {
        this.rates.push({
          id: String(this.rates.length + 1),
          rateSetId,
          currencyCode: code,
          rateToBase: row.rate,
          name: row.name,
          note: row.note,
          updatedAt: now
        })
      }
    }
    return { count: rows.length }
  }

  async getSetting<K extends keyof CalcSettings>(key: K): Promise<CalcSettings[K]> {
    return this.settings[key]
  }

  async setSetting<K extends keyof CalcSettings>(key: K, value: CalcSettings[K]): Promise<void> {
    this.settings[key] = value
  }

  async getAllSettings(): Promise<CalcSettings> {
    return { ...this.settings }
  }
}

async function runAdapterContractTests() {
  const adapter = new MockStorageAdapter()

  // History contract
  const saved = await adapter.saveHistory({
    mode: 'basic',
    input: '2+2',
    result: '4',
    resultFormat: 'decimal'
  })
  assert.equal(saved.result, '4')
  assert.equal(saved.id, '1')

  const history = await adapter.loadHistory()
  assert.equal(history.length, 1)

  await adapter.togglePinHistory(saved.id)
  assert.equal((await adapter.loadHistory())[0].pinned, true)

  await adapter.deleteHistoryItem(saved.id)
  assert.equal((await adapter.loadHistory()).length, 0)

  // Variables contract
  await adapter.saveVariable('tax', '0.15')
  const vars = await adapter.loadVariables()
  assert.equal(vars['tax'], '0.15')

  await adapter.deleteVariable('tax')
  assert.equal((await adapter.loadVariables())['tax'], undefined)

  // Settings contract
  assert.equal(await adapter.getSetting('precision'), 12)
  await adapter.setSetting('precision', 8)
  assert.equal(await adapter.getSetting('precision'), 8)

  console.log('ok   storage adapter contract tests passed')
}

void runAdapterContractTests()
