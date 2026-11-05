import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import {
  saveCalcHistory,
  listCalcHistory,
  clearCalcHistory,
  deleteCalcHistoryItem,
  togglePinCalcHistory,
  saveCalcVariable,
  listCalcVariables,
  deleteCalcVariable,
  saveCalcProgram,
  listCalcPrograms,
  deleteCalcProgram,
  saveCalcRateSet,
  listCalcRateSets,
  saveCalcRate,
  updateCalcRate,
  listCalcRates,
  saveCalcRateOverride,
  listCalcRateOverrides,
  deleteCalcRateOverride,
  renameCalcRateSet,
  deleteCalcRateSet,
  selectCalcRateSet,
  importCalcRateSet,
  getCalcSetting,
  setCalcSetting,
  getAllCalcSettings
} from '../src/main/calculator'

const db = openDatabase()
db.pragma('foreign_keys = ON')
applyMigrations(db)

let checks = 0
const ok = () => { checks++ }

// 1. History
const item1 = saveCalcHistory(db, {
  mode: 'standard',
  input: '2 + 2',
  result: '4',
  resultFormat: 'decimal'
})
assert.ok(item1.id); ok()
const item2 = saveCalcHistory(db, {
  mode: 'standard',
  input: '10 * 10',
  result: '100',
  resultFormat: 'decimal',
  pinned: true
})

let history = listCalcHistory(db)
assert.equal(history.length, 2); ok()
assert.equal(history[0].id, item2.id, 'Pinned item sorts first'); ok()

togglePinCalcHistory(db, item2.id)
history = listCalcHistory(db)
assert.equal(history.find((h) => h.id === item2.id)?.pinned, false); ok()

deleteCalcHistoryItem(db, item1.id)
history = listCalcHistory(db)
assert.equal(history.length, 1); ok()

clearCalcHistory(db)
assert.equal(listCalcHistory(db).length, 0); ok()

// 2. Variables
saveCalcVariable(db, 'tax', '0.15')
saveCalcVariable(db, 'vat', '0.20')
let vars = listCalcVariables(db)
assert.equal(vars['tax'], '0.15'); ok()
assert.equal(vars['vat'], '0.20'); ok()

// Overwrite
saveCalcVariable(db, 'tax', '0.18')
assert.equal(listCalcVariables(db)['tax'], '0.18'); ok()

deleteCalcVariable(db, 'tax')
assert.equal(listCalcVariables(db)['tax'], undefined); ok()

// 3. Programs
const p1 = saveCalcProgram(db, { name: 'Fibonacci', source: 'return 55' })
assert.ok(p1.id); ok()
const programs = listCalcPrograms(db)
assert.equal(programs.length, 1); ok()
assert.equal(programs[0].name, 'Fibonacci'); ok()

deleteCalcProgram(db, p1.id)
assert.equal(listCalcPrograms(db).length, 0); ok()

// 4. Rate Sets, Rates, Overrides, and Transactions
const sets = listCalcRateSets(db)
assert.ok(sets.length >= 1, 'Default rate set seeded in migration'); ok()
const defaultSet = sets[0]

const r1 = saveCalcRate(db, {
  rateSetId: defaultSet.id,
  currencyCode: 'EUR',
  rateToBase: '0.92',
  note: 'ECB'
})
assert.ok(r1.id); ok()

const rates = listCalcRates(db, defaultSet.id)
assert.equal(rates.length, 1); ok()
assert.equal(rates[0].currencyCode, 'EUR'); ok()
assert.equal(rates[0].rateToBase, '0.92'); ok()

// Update rate in place without duplicate row
const updatedR1 = updateCalcRate(db, r1.id, '0.93', 'ECB Updated')
assert.equal(updatedR1.rateToBase, '0.93')
assert.equal(updatedR1.note, 'ECB Updated')
const ratesAfterUpdate = listCalcRates(db, defaultSet.id)
assert.equal(ratesAfterUpdate.length, 1, 'No duplicate row on update'); ok()
assert.equal(ratesAfterUpdate[0].rateToBase, '0.93'); ok()

// Create, rename, select, and delete rate sets
const travelSet = saveCalcRateSet(db, {
  name: 'Travel 2026',
  baseCurrency: 'EUR',
  isActive: false
})
assert.ok(travelSet.id); ok()

const renamedTravel = renameCalcRateSet(db, travelSet.id, 'Vacation 2026')
assert.equal(renamedTravel.name, 'Vacation 2026'); ok()

selectCalcRateSet(db, travelSet.id)
const activeSets = listCalcRateSets(db)
assert.equal(activeSets.find((s) => s.id === travelSet.id)?.isActive, true)
assert.equal(activeSets.find((s) => s.id === defaultSet.id)?.isActive, false); ok()

// Overrides
const ov1 = saveCalcRateOverride(db, {
  rateSetId: travelSet.id,
  fromCode: 'USD',
  toCode: 'JPY',
  rate: '155.5'
})
assert.ok(ov1.id); ok()
const overridesList = listCalcRateOverrides(db, travelSet.id)
assert.equal(overridesList.length, 1)
assert.equal(overridesList[0].rate, '155.5'); ok()

// Save rate in travelSet
saveCalcRate(db, {
  rateSetId: travelSet.id,
  currencyCode: 'JPY',
  rateToBase: '160.0'
})

// Rate-set delete cascade: deleting travelSet deletes its rates and overrides in transaction
deleteCalcRateSet(db, travelSet.id)
assert.equal(listCalcRates(db, travelSet.id).length, 0, 'Rates cascade deleted')
assert.equal(listCalcRateOverrides(db, travelSet.id).length, 0, 'Overrides cascade deleted')
assert.equal(listCalcRateSets(db).find((s) => s.id === defaultSet.id)?.isActive, true, 'Default set activated when active set deleted'); ok()

// Default set cannot be deleted
assert.throws(() => deleteCalcRateSet(db, 'default'), /default rate set cannot be deleted/); ok()

// Import rate set: merge and replace modes
importCalcRateSet(db, defaultSet.id, [
  { code: 'GBP', rate: '0.79', name: 'Pound', note: 'Bank' },
  { code: 'CHF', rate: '0.88', name: 'Swiss Franc', note: 'Spot' }
], 'merge')
const ratesAfterMerge = listCalcRates(db, defaultSet.id)
assert.equal(ratesAfterMerge.length, 3, 'Merged with existing EUR'); ok()

importCalcRateSet(db, defaultSet.id, [
  { code: 'CAD', rate: '1.38', name: 'Canadian Dollar', note: 'Spot' }
], 'replace')
const ratesAfterReplace = listCalcRates(db, defaultSet.id)
assert.equal(ratesAfterReplace.length, 1, 'Replace wiped previous rates')
assert.equal(ratesAfterReplace[0].currencyCode, 'CAD'); ok()

// 5. Settings
assert.equal(getCalcSetting(db, 'precision'), 12); ok()
setCalcSetting(db, 'precision', 16)
assert.equal(getCalcSetting(db, 'precision'), 16); ok()

const allSettings = getAllCalcSettings(db)
assert.equal(allSettings.precision, 16); ok()

db.close()

// 6. Backup export, wipe, restore round-trip & backward compatibility
import { collectBackup, restoreBackup } from '../src/main/backup'
import { parseBackup } from '../src/shared/backup'
import { MIGRATIONS } from '../src/main/migrations'

const db2 = openDatabase()
db2.pragma('foreign_keys = ON')
applyMigrations(db2)

// Populate calculator tables with rich data
saveCalcHistory(db2, { mode: 'scientific', input: 'sin(π/2)', result: '1', resultFormat: 'decimal', pinned: true })
saveCalcVariable(db2, 'alpha', '0.05')
saveCalcProgram(db2, { name: 'Square', source: 'return x * x' })
const customSet = saveCalcRateSet(db2, { id: 'market', name: 'Market Rates', baseCurrency: 'EUR', isActive: true })
saveCalcRate(db2, { rateSetId: customSet.id, currencyCode: 'USD', name: 'Dollar', rateToBase: '1.08', note: 'Spot' })
db2.prepare("INSERT INTO calc_rate_overrides (rate_set_id, from_code, to_code, rate, updated_at) VALUES (?, ?, ?, ?, ?)")
  .run(customSet.id, 'USD', 'JPY', '155.2', new Date().toISOString())
setCalcSetting(db2, 'angleMode', 'rad')

// Verify data exists before export
const historyBefore = listCalcHistory(db2)
const varsBefore = listCalcVariables(db2)
const progsBefore = listCalcPrograms(db2)
const rateSetsBefore = listCalcRateSets(db2)
const ratesBefore = listCalcRates(db2, customSet.id)
const settingsBefore = getAllCalcSettings(db2)
const overridesBefore = db2.prepare('SELECT rate_set_id, from_code, to_code, rate FROM calc_rate_overrides').all()
assert.equal(settingsBefore.angleMode, 'rad'); ok()

// Export backup
const exported = collectBackup(db2)
assert.ok(exported.calculator, 'Exported backup must include calculator section'); ok()

// Wipe database completely
for (const t of ['calc_history', 'calc_variables', 'calc_programs', 'calc_rate_overrides', 'calc_rates', 'calc_rate_sets', 'calc_settings']) {
  db2.exec(`DELETE FROM ${t}`)
}
assert.equal(listCalcHistory(db2).length, 0); ok()
assert.equal(Object.keys(listCalcVariables(db2)).length, 0); ok()
assert.equal(listCalcPrograms(db2).length, 0); ok()
assert.equal(listCalcRateSets(db2).length, 0); ok()

// Restore backup
const parsed = parseBackup(JSON.stringify(exported), MIGRATIONS.length)
restoreBackup(db2, parsed)

// Verify round-trip: identical data restored
const historyAfter = listCalcHistory(db2)
assert.equal(historyAfter.length, historyBefore.length); ok()
assert.equal(historyAfter[0].input, historyBefore[0].input); ok()
assert.equal(historyAfter[0].pinned, true); ok()

const varsAfter = listCalcVariables(db2)
assert.deepEqual(varsAfter, varsBefore); ok()

const progsAfter = listCalcPrograms(db2)
assert.equal(progsAfter.length, progsBefore.length); ok()
assert.equal(progsAfter[0].name, progsBefore[0].name); ok()

const rateSetsAfter = listCalcRateSets(db2)
assert.equal(rateSetsAfter.length, rateSetsBefore.length); ok()

const ratesAfter = listCalcRates(db2, customSet.id)
assert.equal(ratesAfter.length, ratesBefore.length); ok()
assert.equal(ratesAfter[0].rateToBase, '1.08'); ok()

const overridesAfter = db2.prepare('SELECT rate_set_id, from_code, to_code, rate FROM calc_rate_overrides').all()
assert.deepEqual(overridesAfter, overridesBefore); ok()

const settingsAfter = getAllCalcSettings(db2)
assert.equal(settingsAfter.angleMode, 'rad'); ok()

// 7. Backward compatibility: old backup without calculator section preserves existing calc tables
const oldBackup = { ...exported }
delete oldBackup.calculator
const parsedOld = parseBackup(JSON.stringify(oldBackup), MIGRATIONS.length)
assert.equal(parsedOld.calculator, undefined); ok()

restoreBackup(db2, parsedOld)
assert.equal(listCalcHistory(db2).length, historyBefore.length, 'Old backup restore must not wipe calculator history'); ok()
assert.equal(listCalcVariables(db2)['alpha'], '0.05', 'Old backup restore must not wipe calculator variables'); ok()
assert.equal(listCalcPrograms(db2).length, progsBefore.length, 'Old backup restore must not wipe calculator programs'); ok()

// 8. Malformed calculator section: rejected and leaves existing tables untouched
const malformedBackup = {
  ...exported,
  calculator: {
    ...exported.calculator,
    history: 'not-an-array'
  }
}
assert.throws(() => parseBackup(JSON.stringify(malformedBackup), MIGRATIONS.length), /missing its "history" list/); ok()

// Verify nothing in db2 was modified
assert.equal(listCalcHistory(db2).length, historyBefore.length); ok()
assert.equal(listCalcVariables(db2)['alpha'], '0.05'); ok()

db2.close()
console.log(`ok   ${checks} SQLite calculator persistence and backup tests passed`)
