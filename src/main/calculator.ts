import type Database from 'better-sqlite3'
import type {
  CalcHistoryItem,
  CalcProgram,
  CalcRate,
  CalcRateOverride,
  CalcRateSet,
  RateSetImportRow
} from '../shared/calculator/types'
import { DEFAULT_CALC_SETTINGS, type CalcSettings } from '../shared/calculator/types'
import { validateCurrencyCode } from '../shared/calculator/rates'

export function saveCalcHistory(
  db: Database.Database,
  item: Omit<CalcHistoryItem, 'id' | 'createdAt'>
): CalcHistoryItem {
  const now = new Date().toISOString()
  const info = db
    .prepare(
      `INSERT INTO calc_history (created_at, mode, input, result, result_format, rate_snapshot, pinned)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      now,
      item.mode || 'standard',
      item.input,
      item.result,
      item.resultFormat || 'decimal',
      item.rateSnapshot ?? null,
      item.pinned ? 1 : 0
    )

  pruneHistoryToLimit(db)

  return {
    id: String(info.lastInsertRowid),
    createdAt: now,
    mode: item.mode,
    input: item.input,
    result: item.result,
    resultFormat: item.resultFormat,
    rateSnapshot: item.rateSnapshot,
    pinned: item.pinned
  }
}

/**
 * Enforce the maxHistoryItems setting: drop the oldest unpinned rows until the table
 * holds at most the limit. Pinned rows are never pruned, so the table can temporarily
 * hold more than the limit when everything is pinned.
 */
function pruneHistoryToLimit(db: Database.Database): void {
  let limit: number
  try {
    const raw = db.prepare("SELECT value FROM calc_settings WHERE key = 'maxHistoryItems'").get() as
      | { value: string | number | null }
      | undefined
    limit = Math.floor(Number(raw?.value ?? DEFAULT_CALC_SETTINGS.maxHistoryItems))
  } catch {
    limit = DEFAULT_CALC_SETTINGS.maxHistoryItems
  }
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_CALC_SETTINGS.maxHistoryItems
  db.prepare(
    `DELETE FROM calc_history
     WHERE pinned = 0 AND id NOT IN (
       SELECT id FROM calc_history WHERE pinned = 0 ORDER BY id DESC LIMIT ?
     )`
  ).run(limit)
}

export function listCalcHistory(db: Database.Database, limit = 100): CalcHistoryItem[] {
  const rows = db
    .prepare(
      `SELECT id, created_at, mode, input, result, result_format, rate_snapshot, pinned
       FROM calc_history
       ORDER BY pinned DESC, id DESC
       LIMIT ?`
    )
    .all(limit) as {
      id: number
      created_at: string
      mode: string
      input: string
      result: string
      result_format: string
      rate_snapshot: string | null
      pinned: number
    }[]

  return rows.map((r) => ({
    id: String(r.id),
    createdAt: r.created_at,
    mode: r.mode,
    input: r.input,
    result: r.result,
    resultFormat: r.result_format as any,
    rateSnapshot: r.rate_snapshot,
    pinned: r.pinned === 1
  }))
}

export function clearCalcHistory(db: Database.Database): void {
  db.prepare('DELETE FROM calc_history').run()
}

export function deleteCalcHistoryItem(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM calc_history WHERE id = ?').run(parseInt(id, 10))
}

export function togglePinCalcHistory(db: Database.Database, id: string): void {
  db.prepare('UPDATE calc_history SET pinned = 1 - pinned WHERE id = ?').run(parseInt(id, 10))
}

export function saveCalcVariable(db: Database.Database, name: string, value: string): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO calc_variables (name, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(name.toLowerCase(), value, now)
}

export function listCalcVariables(db: Database.Database): Record<string, string> {
  const rows = db.prepare('SELECT name, value FROM calc_variables').all() as {
    name: string
    value: string
  }[]
  const res: Record<string, string> = {}
  for (const r of rows) res[r.name] = r.value
  return res
}

export function deleteCalcVariable(db: Database.Database, name: string): void {
  db.prepare('DELETE FROM calc_variables WHERE name = ?').run(name.toLowerCase())
}

export function saveCalcProgram(
  db: Database.Database,
  program: Omit<CalcProgram, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): CalcProgram {
  const now = new Date().toISOString()
  if (program.id) {
    db.prepare(
      `UPDATE calc_programs SET name = ?, source = ?, updated_at = ? WHERE id = ?`
    ).run(program.name, program.source, now, parseInt(program.id, 10))
    const row = db.prepare('SELECT created_at FROM calc_programs WHERE id = ?').get(parseInt(program.id, 10)) as {
      created_at: string
    }
    return {
      id: program.id,
      name: program.name,
      source: program.source,
      createdAt: row ? row.created_at : now,
      updatedAt: now
    }
  }

  const info = db
    .prepare(`INSERT INTO calc_programs (name, source, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run(program.name, program.source, now, now)

  return {
    id: String(info.lastInsertRowid),
    name: program.name,
    source: program.source,
    createdAt: now,
    updatedAt: now
  }
}

export function listCalcPrograms(db: Database.Database): CalcProgram[] {
  const rows = db
    .prepare('SELECT id, name, source, created_at, updated_at FROM calc_programs ORDER BY name ASC')
    .all() as {
      id: number
      name: string
      source: string
      created_at: string
      updated_at: string
    }[]

  return rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }))
}

export function deleteCalcProgram(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM calc_programs WHERE id = ?').run(parseInt(id, 10))
}

export function saveCalcRateSet(
  db: Database.Database,
  rateSet: Omit<CalcRateSet, 'id' | 'updatedAt'> & { id?: string }
): CalcRateSet {
  const now = new Date().toISOString()
  const id = rateSet.id || `set_${Date.now()}`
  db.prepare(
    `INSERT INTO calc_rate_sets (id, name, base_currency, is_active, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, base_currency = excluded.base_currency, is_active = excluded.is_active, updated_at = excluded.updated_at`
  ).run(id, rateSet.name, rateSet.baseCurrency, rateSet.isActive ? 1 : 0, now)

  return {
    id,
    name: rateSet.name,
    baseCurrency: rateSet.baseCurrency,
    isActive: rateSet.isActive,
    updatedAt: now
  }
}

export function renameCalcRateSet(
  db: Database.Database,
  id: string,
  newName: string
): CalcRateSet {
  const trimmed = newName.trim()
  if (!trimmed) {
    throw new Error('Rate set name cannot be empty')
  }
  const now = new Date().toISOString()
  const info = db
    .prepare('UPDATE calc_rate_sets SET name = ?, updated_at = ? WHERE id = ?')
    .run(trimmed, now, id)
  if (info.changes === 0) {
    throw new Error(`Rate set "${id}" not found`)
  }
  const row = db
    .prepare('SELECT id, name, base_currency, is_active, updated_at FROM calc_rate_sets WHERE id = ?')
    .get(id) as {
      id: string
      name: string
      base_currency: string
      is_active: number
      updated_at: string
    }
  return {
    id: row.id,
    name: row.name,
    baseCurrency: row.base_currency,
    isActive: row.is_active === 1,
    updatedAt: row.updated_at
  }
}

export function deleteCalcRateSet(db: Database.Database, id: string): void {
  if (id === 'default') {
    throw new Error('The default rate set cannot be deleted')
  }
  const row = db
    .prepare('SELECT id, is_active FROM calc_rate_sets WHERE id = ?')
    .get(id) as { id: string; is_active: number } | undefined

  if (!row) {
    throw new Error(`Rate set "${id}" not found`)
  }

  db.transaction(() => {
    // Delete overrides and rates belonging to this set
    db.prepare('DELETE FROM calc_rate_overrides WHERE rate_set_id = ?').run(id)
    db.prepare('DELETE FROM calc_rates WHERE rate_set_id = ?').run(id)
    db.prepare('DELETE FROM calc_rate_sets WHERE id = ?').run(id)

    // If active set was deleted, make default set active
    if (row.is_active === 1) {
      db.prepare("UPDATE calc_rate_sets SET is_active = 1 WHERE id = 'default'").run()
    }
  })()
}

export function selectCalcRateSet(db: Database.Database, id: string): void {
  const row = db.prepare('SELECT id FROM calc_rate_sets WHERE id = ?').get(id)
  if (!row) {
    throw new Error(`Rate set "${id}" not found`)
  }
  db.transaction(() => {
    db.prepare('UPDATE calc_rate_sets SET is_active = 0').run()
    db.prepare('UPDATE calc_rate_sets SET is_active = 1 WHERE id = ?').run(id)
  })()
}

export function listCalcRateSets(db: Database.Database): CalcRateSet[] {
  const rows = db
    .prepare('SELECT id, name, base_currency, is_active, updated_at FROM calc_rate_sets ORDER BY id ASC')
    .all() as {
      id: string
      name: string
      base_currency: string
      is_active: number
      updated_at: string
    }[]

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    baseCurrency: r.base_currency,
    isActive: r.is_active === 1,
    updatedAt: r.updated_at
  }))
}

export function saveCalcRate(
  db: Database.Database,
  rate: Omit<CalcRate, 'id' | 'updatedAt'> & { id?: string }
): CalcRate {
  const now = new Date().toISOString()
  const currCode = rate.currencyCode.toUpperCase()
  const info = db
    .prepare(
      `INSERT INTO calc_rates (rate_set_id, currency_code, name, rate_to_base, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(rate_set_id, currency_code) DO UPDATE SET
         name = excluded.name, rate_to_base = excluded.rate_to_base, note = excluded.note, updated_at = excluded.updated_at`
    )
    .run(rate.rateSetId, currCode, rate.name || '', rate.rateToBase, rate.note || '', now)

  return {
    id: String(info.lastInsertRowid),
    rateSetId: rate.rateSetId,
    currencyCode: currCode,
    name: rate.name,
    rateToBase: rate.rateToBase,
    note: rate.note,
    updatedAt: now
  }
}

export function listCalcRates(db: Database.Database, rateSetId: string): CalcRate[] {
  const rows = db
    .prepare(
      'SELECT id, rate_set_id, currency_code, name, rate_to_base, note, updated_at FROM calc_rates WHERE rate_set_id = ? ORDER BY currency_code ASC'
    )
    .all(rateSetId) as {
      id: number
      rate_set_id: string
      currency_code: string
      name: string
      rate_to_base: string
      note: string
      updated_at: string
    }[]

  return rows.map((r) => ({
    id: String(r.id),
    rateSetId: r.rate_set_id,
    currencyCode: r.currency_code,
    name: r.name,
    rateToBase: r.rate_to_base,
    note: r.note,
    updatedAt: r.updated_at
  }))
}

export function updateCalcRate(
  db: Database.Database,
  id: string,
  rateToBase: string,
  note?: string,
  name?: string
): CalcRate {
  const row = db
    .prepare('SELECT id, rate_set_id, currency_code, name, rate_to_base, note FROM calc_rates WHERE id = ?')
    .get(parseInt(id, 10)) as {
      id: number
      rate_set_id: string
      currency_code: string
      name: string
      rate_to_base: string
      note: string
    } | undefined

  if (!row) {
    throw new Error(`Rate "${id}" not found`)
  }

  const now = new Date().toISOString()
  const updatedName = name !== undefined ? name : row.name
  const updatedNote = note !== undefined ? note : row.note

  db.prepare(
    'UPDATE calc_rates SET rate_to_base = ?, name = ?, note = ?, updated_at = ? WHERE id = ?'
  ).run(rateToBase, updatedName, updatedNote, now, parseInt(id, 10))

  return {
    id: String(row.id),
    rateSetId: row.rate_set_id,
    currencyCode: row.currency_code,
    name: updatedName,
    rateToBase,
    note: updatedNote,
    updatedAt: now
  }
}

export function saveCalcRateOverride(
  db: Database.Database,
  override: Omit<CalcRateOverride, 'id' | 'updatedAt'> & { id?: string }
): CalcRateOverride {
  const from = validateCurrencyCode(override.fromCode)
  const to = validateCurrencyCode(override.toCode)
  if (from === to) {
    throw new Error('From and To currency codes cannot be identical in rate override')
  }

  const now = new Date().toISOString()
  const info = db
    .prepare(
      `INSERT INTO calc_rate_overrides (rate_set_id, from_code, to_code, rate, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(rate_set_id, from_code, to_code) DO UPDATE SET
         rate = excluded.rate, updated_at = excluded.updated_at`
    )
    .run(override.rateSetId, from, to, override.rate, now)

  const id = override.id || String(info.lastInsertRowid)
  return {
    id,
    rateSetId: override.rateSetId,
    fromCode: from,
    toCode: to,
    rate: override.rate,
    updatedAt: now
  }
}

export function listCalcRateOverrides(db: Database.Database, rateSetId: string): CalcRateOverride[] {
  const rows = db
    .prepare(
      'SELECT id, rate_set_id, from_code, to_code, rate, updated_at FROM calc_rate_overrides WHERE rate_set_id = ? ORDER BY from_code ASC, to_code ASC'
    )
    .all(rateSetId) as {
      id: number
      rate_set_id: string
      from_code: string
      to_code: string
      rate: string
      updated_at: string
    }[]

  return rows.map((r) => ({
    id: String(r.id),
    rateSetId: r.rate_set_id,
    fromCode: r.from_code,
    toCode: r.to_code,
    rate: r.rate,
    updatedAt: r.updated_at
  }))
}

export function deleteCalcRateOverride(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM calc_rate_overrides WHERE id = ?').run(parseInt(id, 10))
}

export function importCalcRateSet(
  db: Database.Database,
  rateSetId: string,
  rows: RateSetImportRow[],
  mode: 'merge' | 'replace'
): { count: number } {
  // Verify target rate set exists
  const setRow = db.prepare('SELECT id FROM calc_rate_sets WHERE id = ?').get(rateSetId)
  if (!setRow) {
    throw new Error(`Rate set "${rateSetId}" not found`)
  }

  const now = new Date().toISOString()

  db.transaction(() => {
    if (mode === 'replace') {
      db.prepare('DELETE FROM calc_rates WHERE rate_set_id = ?').run(rateSetId)
    }

    const insertStmt = db.prepare(
      `INSERT INTO calc_rates (rate_set_id, currency_code, name, rate_to_base, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(rate_set_id, currency_code) DO UPDATE SET
         name = excluded.name,
         rate_to_base = excluded.rate_to_base,
         note = excluded.note,
         updated_at = excluded.updated_at`
    )

    for (const row of rows) {
      insertStmt.run(
        rateSetId,
        row.code,
        row.name || '',
        row.rate,
        row.note || '',
        now
      )
    }
  })()

  return { count: rows.length }
}

export function getCalcSetting<K extends keyof CalcSettings>(
  db: Database.Database,
  key: K
): CalcSettings[K] {
  const row = db.prepare('SELECT value FROM calc_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  if (!row) return DEFAULT_CALC_SETTINGS[key]
  try {
    return JSON.parse(row.value)
  } catch {
    return DEFAULT_CALC_SETTINGS[key]
  }
}

export function setCalcSetting<K extends keyof CalcSettings>(
  db: Database.Database,
  key: K,
  value: CalcSettings[K]
): void {
  db.prepare(
    `INSERT INTO calc_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, JSON.stringify(value))
}

export function getAllCalcSettings(db: Database.Database): CalcSettings {
  const rows = db.prepare('SELECT key, value FROM calc_settings').all() as {
    key: string
    value: string
  }[]
  const result = { ...DEFAULT_CALC_SETTINGS }
  for (const r of rows) {
    try {
      ; (result as any)[r.key] = JSON.parse(r.value)
    } catch {
      // ignore
    }
  }
  return result
}
