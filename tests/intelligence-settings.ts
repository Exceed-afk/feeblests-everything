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
  assert.deepEqual(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'insightDismissals'").get() as { value: string }).value), [{ id: 'mood-by-tasks', until: null }])
  assert.deepEqual(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'intelligence'").get() as { value: string }).value), {
    features: { insights: true }
  })
  assert.deepEqual(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'assistant'").get() as { value: string }).value), {
    provider: 'local'
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
  db.prepare("INSERT INTO settings (key, value) VALUES ('assistant', ?)").run(JSON.stringify({
    provider: 'cloud', cloudUrl: 'https://local.example'
  }))
  db.prepare("INSERT INTO settings (key, value) VALUES ('intelligence', ?)").run(JSON.stringify({
    automations: { lossReflection: true },
    dismissedInsights: ['mood-by-tasks'],
    aiProvider: 'local'
  }))

  migrateSettingsKeys(db)

  assert.deepEqual(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'automations'").get() as { value: string }).value), {
    lossReflection: false
  })
  assert.deepEqual(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'insightDismissals'").get() as { value: string }).value), ['mood-vs-tasks'])
  assert.deepEqual(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'assistant'").get() as { value: string }).value), {
    provider: 'cloud', cloudUrl: 'https://local.example'
  })
  assert.deepEqual(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'intelligence'").get() as { value: string }).value), {})
  db.close()
})

test('a legacy provider replaces an assistant setting that is still off', () => {
  const db = openDatabase()
  applyMigrations(db)
  db.prepare("INSERT INTO settings (key, value) VALUES ('assistant', ?)").run(JSON.stringify({
    provider: 'off', localUrl: 'http://localhost:9000/v1'
  }))
  db.prepare("INSERT INTO settings (key, value) VALUES ('intelligence', ?)").run(JSON.stringify({
    aiProvider: 'local'
  }))

  migrateSettingsKeys(db)

  assert.deepEqual(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'assistant'").get() as { value: string }).value), {
    provider: 'local', localUrl: 'http://localhost:9000/v1'
  })
  db.close()
})

console.log(`\n${n} intelligence settings checks passed`)

// ---------- I3: snooze / hide dismissals ----------

import { migrateInsightDismissalShape } from '../src/main/db'
import { getInsights, setInsightDismissed, isDismissedOn } from '../src/main/insights'
import { createHabit } from '../src/main/habits'

const TODAY = '2026-11-02'

test('I3: an old string[] dismissals list migrates to { id, until: null }[] once and is idempotent', () => {
  const db = openDatabase()
  applyMigrations(db)
  db.prepare("INSERT INTO settings (key, value) VALUES ('insightDismissals', ?)").run(JSON.stringify(['mood-by-tasks', 'savings-by-habits']))
  migrateInsightDismissalShape(db)
  assert.deepEqual(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'insightDismissals'").get() as { value: string }).value), [
    { id: 'mood-by-tasks', until: null }, { id: 'savings-by-habits', until: null }
  ])
  migrateInsightDismissalShape(db) // second run: no change
  assert.deepEqual(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'insightDismissals'").get() as { value: string }).value), [
    { id: 'mood-by-tasks', until: null }, { id: 'savings-by-habits', until: null }
  ])
  db.close()
})

test('I3: snooze sets until 4 weeks out and expires on the right date', () => {
  const db = openDatabase()
  applyMigrations(db)
  const after = setInsightDismissed(db, 'mood-by-tasks', true, 'snooze', TODAY)
  assert.deepEqual(after, [{ id: 'mood-by-tasks', until: '2026-11-30' }]) // 4 weeks after 2026-11-02
  const d = after[0]
  // Active THROUGH the expiry day, gone the day after (snooze covers its until day).
  assert.equal(isDismissedOn(d, '2026-11-30'), true)
  assert.equal(isDismissedOn(d, '2026-12-01'), false)
  db.close()
})

test('I3: hide keeps it until restored; restore removes it', () => {
  const db = openDatabase()
  applyMigrations(db)
  setInsightDismissed(db, 'mood-by-tasks', true, 'hide', TODAY)
  assert.deepEqual(setInsightDismissed(db, 'mood-by-tasks', false, 'restore', TODAY), [])
  db.close()
})

test('I3: getInsights filters expired snoozes out of the active list', () => {
  const db = openDatabase()
  applyMigrations(db)
  const h = createHabit(db, { name: 'Read', notes: '', days: [0, 1, 2, 3, 4, 5, 6], archived: false, autoCompleteOn: '' })
  void h
  setInsightDismissed(db, 'mood-vs-tasks', true, 'snooze', '2026-09-28') // expires 2026-10-26, long past
  const result = getInsights(db, TODAY)
  assert.equal(result.dismissed.some((d) => d.id === 'mood-vs-tasks'), false) // expired snoozes do not come back
  assert.equal(result.snoozeWeeks, 4)
  db.close()
})
