import assert from 'node:assert/strict'
import {
  DEFAULT_ASSISTANT, assistantQuestionError, assistantSettingsPatchError, keyStateLabel, normalizeAssistantPatch
} from '../src/shared/assistant'
import { collectBackup, restoreBackup } from '../src/main/backup'
import { migrateSettingsKeys } from '../src/main/db'
import { applyMigrations, MIGRATIONS } from '../src/main/migrations'
import { parseBackup } from '../src/shared/backup'
import { openDatabase } from './sqlite'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

test('unsupported provider values are ignored and unknown settings are dropped', () => {
  const unsupported = normalizeAssistantPatch(DEFAULT_ASSISTANT, { provider: 'remote' })
  assert.deepEqual(unsupported, DEFAULT_ASSISTANT)

  const patched = normalizeAssistantPatch(DEFAULT_ASSISTANT, {
    model: 'local-model',
    ignored: 'not an assistant setting'
  })
  assert.equal(patched.model, 'local-model')
  assert.deepEqual(Object.keys(patched).sort(), ['cloudConfirmed', 'cloudUrl', 'localUrl', 'model', 'provider'])
})

test('known assistant settings and supported provider values are retained', () => {
  assert.deepEqual(normalizeAssistantPatch(DEFAULT_ASSISTANT, {
    provider: 'local',
    localUrl: 'http://localhost:11434/v1',
    model: 'local-model'
  }), {
    provider: 'local',
    localUrl: 'http://localhost:11434/v1',
    cloudUrl: DEFAULT_ASSISTANT.cloudUrl,
    model: 'local-model',
    cloudConfirmed: false
  })
})

test('changing the cloud address clears confirmation but a trailing slash does not', () => {
  const current = { ...DEFAULT_ASSISTANT, cloudUrl: 'https://example.test/v1', cloudConfirmed: true }
  const changed = normalizeAssistantPatch(current, {
    cloudUrl: 'https://other.example/v1',
    cloudConfirmed: true
  })
  assert.equal(changed.cloudUrl, 'https://other.example/v1')
  assert.equal(changed.cloudConfirmed, false)

  const same = normalizeAssistantPatch(current, { cloudUrl: 'https://example.test/v1/' })
  assert.equal(same.cloudConfirmed, true)
})

test('over-long URLs and model names are rejected', () => {
  const current = { ...DEFAULT_ASSISTANT, cloudConfirmed: true }
  const normalized = normalizeAssistantPatch(current, {
    localUrl: `http://localhost/${'x'.repeat(300)}`,
    cloudUrl: `https://${'x'.repeat(300)}`,
    model: 'm'.repeat(101)
  })
  assert.equal(normalized.localUrl, DEFAULT_ASSISTANT.localUrl)
  assert.equal(normalized.cloudUrl, DEFAULT_ASSISTANT.cloudUrl)
  assert.equal(normalized.cloudConfirmed, true)
  assert.equal(normalized.model, DEFAULT_ASSISTANT.model)
  assert.equal(assistantSettingsPatchError({ cloudUrl: 'x'.repeat(301) }), 'Provider addresses must be 300 characters or fewer.')
  assert.equal(assistantSettingsPatchError({ model: 'x'.repeat(101) }), 'Model names must be 100 characters or fewer.')
})

test('assistant questions are limited to 500 characters', () => {
  assert.equal(assistantQuestionError('q'.repeat(500)), null)
  assert.equal(assistantQuestionError('q'.repeat(501)), 'A question must be 500 characters or fewer.')
})

test('restoring a backup disables the assistant and drops legacy provider selection', () => {
  const db = openDatabase()
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  try {
    const backup = collectBackup(db)
    backup.settings.assistant = {
      ...DEFAULT_ASSISTANT,
      provider: 'cloud',
      localUrl: 'http://127.0.0.1:1234/v1',
      cloudUrl: 'https://attacker.example/v1',
      model: 'restored-model',
      cloudConfirmed: true
    }
    backup.settings.intelligence = { features: {}, aiProvider: 'cloud' }
    backup.settings.assistantKeyBlob = 'must not be restored'

    restoreBackup(db, parseBackup(JSON.stringify(backup), MIGRATIONS.length))
    migrateSettingsKeys(db)
    const savedAssistant = JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'assistant'").get() as { value: string }).value)
    const savedIntelligence = JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'intelligence'").get() as { value: string }).value)

    assert.equal(db.prepare("SELECT 1 FROM settings WHERE key = 'assistantKeyBlob'").get(), undefined)
    assert.equal(savedAssistant.provider, 'off')
    assert.equal(savedAssistant.cloudUrl, DEFAULT_ASSISTANT.cloudUrl)
    assert.equal(savedAssistant.cloudConfirmed, false)
    assert.equal(savedAssistant.localUrl, 'http://127.0.0.1:1234/v1')
    assert.equal(savedAssistant.model, 'restored-model')
    assert.equal('aiProvider' in savedIntelligence, false)
  } finally {
    db.close()
  }
})

test('key state labels distinguish missing, readable and unreadable keys', () => {
  assert.equal(keyStateLabel({ saved: false, readable: false, encryptionOk: true }), 'none')
  assert.equal(keyStateLabel({ saved: true, readable: true, encryptionOk: true }), 'ok')
  assert.equal(keyStateLabel({ saved: true, readable: false, encryptionOk: false }), 'unreadable')
})

console.log(`\n${n} assistant settings checks passed`)
