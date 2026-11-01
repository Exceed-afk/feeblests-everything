import assert from 'node:assert/strict'
import { migrateSettingsKeys } from '../src/main/db'
import { applyMigrations } from '../src/main/migrations'
import { mergeFeatures } from '../src/shared/intelligence'
import { DEFAULT_INTELLIGENCE } from '../src/shared/types'
import { openDatabase } from './sqlite'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

test('merging a partial feature patch preserves saved toggles and defaults missing toggles', () => {
  assert.deepEqual(mergeFeatures(
    { insights: true, dailyBriefing: false },
    { automations: true }
  ), {
    ...DEFAULT_INTELLIGENCE.features,
    insights: true,
    dailyBriefing: false,
    automations: true
  })
})

test('legacy automation and insight settings move once and preserve other intelligence values', () => {
  const db = openDatabase()
  applyMigrations(db)
  const schemaVersion = db.pragma('user_version', { simple: true })
  db.prepare("INSERT INTO settings (key, value) VALUES ('intelligence', ?)").run(JSON.stringify({
    features: { insights: true },
    aiProvider: 'local',
    automations: { lossReflection: true, lossThreshold: 80 },
    dismissedInsights: ['mood-by-tasks']
  }))

  migrateSettingsKeys(db)

  assert.deepEqual(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'automations'").get() as { value: string }).value), {
    lossReflection: true, lossThreshold: 80
  })
  assert.deepEqual(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'insightDismissals'").get() as { value: string }).value), ['mood-by-tasks'])
  assert.deepEqual(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'intelligence'").get() as { value: string }).value), {
    features: { insights: true }, aiProvider: 'local'
  })

  const before = db.prepare('SELECT key, value FROM settings ORDER BY key').all()
  migrateSettingsKeys(db)
  assert.deepEqual(db.prepare('SELECT key, value FROM settings ORDER BY key').all(), before)
  assert.equal(db.pragma('user_version', { simple: true }), schemaVersion)
  db.close()
})

test('legacy settings do not overwrite keys that already exist in the split layout', () => {
  const db = openDatabase()
  applyMigrations(db)
  db.prepare("INSERT INTO settings (key, value) VALUES ('automations', ?)").run(JSON.stringify({ lossReflection: false }))
  db.prepare("INSERT INTO settings (key, value) VALUES ('insightDismissals', ?)").run(JSON.stringify(['mood-vs-tasks']))
  db.prepare("INSERT INTO settings (key, value) VALUES ('intelligence', ?)").run(JSON.stringify({
    automations: { lossReflection: true },
    dismissedInsights: ['mood-by-tasks']
  }))

  migrateSettingsKeys(db)

  assert.deepEqual(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'automations'").get() as { value: string }).value), {
    lossReflection: false
  })
  assert.deepEqual(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'insightDismissals'").get() as { value: string }).value), ['mood-vs-tasks'])
  assert.deepEqual(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'intelligence'").get() as { value: string }).value), {})
  db.close()
})

console.log(`\n${n} intelligence settings checks passed`)
